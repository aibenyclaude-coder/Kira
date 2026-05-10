/**
 * Kira telemetry Worker.
 *
 * Routes:
 *   POST /v1/reports         — ingest batch of ReportPayloadV1
 *   GET  /v1/stats/:skill_id — public 30-day aggregate counts only
 *
 * Phase A scope: ingest + aggregate only. Skill/scar distribution and
 * rate limiting / signing land in later phases.
 */
import { z } from "zod";
import { sanitize } from "./sanitize.js";

const NOTE_MAX = 500;
const CONTEXT_MAX = 2000;
const MAX_BATCH = 100;
const MAX_BODY_BYTES = 64 * 1024;

const PayloadSchema = z.object({
  v: z.literal(1),
  skill_id: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-z0-9][a-z0-9._-]*$/),
  status: z.enum(["success", "retry", "failure"]),
  client_id: z.string().uuid(),
  kira_version: z.string().min(1).max(32),
  ts: z.string().datetime({ offset: true }),
  env: z.object({
    os: z.enum(["linux", "darwin", "win32", "other"]),
    node_major: z.number().int().min(0).max(99),
    tier: z.enum(["free", "pro"]),
  }),
  detail: z
    .object({
      note: z.string().max(NOTE_MAX).optional(),
      context: z.string().max(CONTEXT_MAX).optional(),
    })
    .optional(),
});

const BatchSchema = z.object({
  v: z.literal(1),
  batch: z.array(PayloadSchema).min(1).max(MAX_BATCH),
});

export interface Env {
  DB: D1Database;
  DAILY_SALT: string;
}

function jsonResponse(body: unknown, status: number, extra: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...extra },
  });
}

function errorResponse(code: string, message: string, status: number): Response {
  return jsonResponse({ error: { code, message } }, status);
}

async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

async function ingest(req: Request, env: Env): Promise<Response> {
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > MAX_BODY_BYTES) {
    return errorResponse("too_large", "Request body exceeds 64 KiB.", 413);
  }
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return errorResponse("invalid_payload", "Body is not valid JSON.", 400);
  }
  const parsed = BatchSchema.safeParse(json);
  if (!parsed.success) {
    return errorResponse("invalid_payload", parsed.error.message, 400);
  }

  const ip = req.headers.get("CF-Connecting-IP") ?? "0.0.0.0";
  const ipHash = await sha256Hex(`${ip}|${env.DAILY_SALT}|${todayUtc()}`);

  const stmt = env.DB.prepare(
    "INSERT INTO events (skill_id, status, client_id, kira_version, os, node_major, tier, note, context, ts, ip_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );

  const rows = parsed.data.batch.map((e) => {
    const note = sanitize(e.detail?.note, NOTE_MAX) ?? null;
    const context = sanitize(e.detail?.context, CONTEXT_MAX) ?? null;
    return stmt.bind(
      e.skill_id,
      e.status,
      e.client_id,
      e.kira_version,
      e.env.os,
      e.env.node_major,
      e.env.tier,
      note,
      context,
      e.ts,
      ipHash
    );
  });

  await env.DB.batch(rows);
  return jsonResponse({ accepted: rows.length }, 202);
}

interface StatsRow {
  total: number;
  success: number;
  retry: number;
  failure: number;
}

async function stats(skillId: string, env: Env): Promise<Response> {
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(skillId)) {
    return errorResponse("invalid_payload", "skill_id has invalid format.", 400);
  }
  const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const result = await env.DB.prepare(
    "SELECT " +
      "  COUNT(*) AS total, " +
      "  SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) AS success, " +
      "  SUM(CASE WHEN status='retry'   THEN 1 ELSE 0 END) AS retry, " +
      "  SUM(CASE WHEN status='failure' THEN 1 ELSE 0 END) AS failure " +
      "FROM events WHERE skill_id = ? AND ts >= ?"
  )
    .bind(skillId, cutoff)
    .first<StatsRow>();

  const body = {
    skill_id: skillId,
    total: result?.total ?? 0,
    success: result?.success ?? 0,
    retry: result?.retry ?? 0,
    failure: result?.failure ?? 0,
    window_days: 30,
  };
  return jsonResponse(body, 200, { "Cache-Control": "public, max-age=300" });
}

async function purge(env: Env): Promise<void> {
  const eventsCutoff = new Date(Date.now() - 180 * 24 * 3600 * 1000).toISOString();
  await env.DB.prepare("DELETE FROM events WHERE ts < ?").bind(eventsCutoff).run();
  // Drop ip_hash for events older than 24h — kept only for short-window abuse triage.
  const ipHashCutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  await env.DB.prepare(
    "UPDATE events SET ip_hash = NULL WHERE ip_hash IS NOT NULL AND ts < ?"
  )
    .bind(ipHashCutoff)
    .run();
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "POST" && url.pathname === "/v1/reports") {
      return ingest(req, env);
    }
    if (req.method === "GET" && url.pathname.startsWith("/v1/stats/")) {
      const skillId = decodeURIComponent(url.pathname.slice("/v1/stats/".length));
      return stats(skillId, env);
    }
    if (req.method === "GET" && url.pathname === "/v1/health") {
      return jsonResponse({ ok: true }, 200);
    }
    return errorResponse("not_found", `No route for ${req.method} ${url.pathname}`, 404);
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(purge(env));
  },
};
