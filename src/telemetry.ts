/**
 * Telemetry pipeline.
 *
 * - Local-first: every report appends NDJSON to ~/.kira/reports.log.
 * - Anonymous core (skill_id, status, anonymous client_id, kira_version, env)
 *   is sent at consent level "basic" or "full".
 * - Sanitized note/context is included only at consent level "full".
 * - Batches flush every BATCH_SIZE entries OR FLUSH_INTERVAL_MS, whichever first.
 * - 4xx → drop (bad payload). 5xx / network → exponential backoff up to MAX_ATTEMPTS.
 *
 * The Worker URL is a placeholder until a custom domain is provisioned;
 * see PRIVACY.md for the production address.
 */
import { appendFile, readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { loadConsent } from "./consent.js";
import { sanitizePayload } from "./sanitize.js";
import { KIRA_HOME } from "./consent.js";
import type { KiraTier } from "./license.js";
import type {
  ConsentLevel,
  OsFamily,
  ReportLogEntry,
  ReportPayloadV1,
  ReportRequest,
} from "./types.js";

export const REPORTS_LOG = join(KIRA_HOME, "reports.log");
export const TELEMETRY_URL =
  process.env.KIRA_TELEMETRY_URL ?? "https://kira-telemetry.workers.dev/v1/reports";

const BATCH_SIZE = 20;
const FLUSH_INTERVAL_MS = 5 * 60_000;
const MAX_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 5_000;
const GZIP_THRESHOLD_BYTES = 1024;

// ── Version detection (build-time bake via package.json read at boot) ──

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_JSON = join(__dirname, "..", "package.json");

let cachedVersion: string | null = null;
function readVersion(): string {
  if (cachedVersion !== null) return cachedVersion;
  try {
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON, "utf-8")) as {
      version?: string;
    };
    cachedVersion = pkg.version ?? "0.0.0";
  } catch {
    cachedVersion = "0.0.0";
  }
  return cachedVersion;
}

function osFamily(): OsFamily {
  const p = process.platform;
  if (p === "linux") return "linux";
  if (p === "darwin") return "darwin";
  if (p === "win32") return "win32";
  return "other";
}

function nodeMajor(): number {
  const m = process.versions.node.match(/^(\d+)/);
  return m ? Number(m[1]) : 0;
}

// ── Build payload ──────────────────────────────────────────────────────

interface BuildArgs {
  request: ReportRequest;
  level: ConsentLevel;
  client_id: string;
  tier: KiraTier;
}

export function buildPayload(args: BuildArgs): ReportPayloadV1 {
  const { request, level, client_id, tier } = args;
  const base: ReportPayloadV1 = {
    v: 1,
    skill_id: request.skill_id,
    status: request.status,
    client_id,
    kira_version: readVersion(),
    ts: new Date().toISOString(),
    // Wire format v1 knows free|pro only; contributor reports as free —
    // earned status is a distribution entitlement, not a telemetry class.
    env: { os: osFamily(), node_major: nodeMajor(), tier: tier === "pro" ? "pro" : "free" },
  };
  if (level === "full") {
    const note = request.note;
    const context = request.context;
    if (note !== undefined || context !== undefined) {
      base.detail = {
        ...(note !== undefined && { note }),
        ...(context !== undefined && { context }),
      };
    }
  }
  return sanitizePayload(base);
}

// ── In-memory queue + flush loop ───────────────────────────────────────

interface QueueItem {
  payload: ReportPayloadV1;
  attempts: number;
}

let queue: QueueItem[] = [];
let flushTimer: NodeJS.Timeout | null = null;
let flushing = false;

async function appendLog(payload: ReportPayloadV1, sent: boolean): Promise<void> {
  await mkdir(KIRA_HOME, { recursive: true });
  const entry: ReportLogEntry = { ...payload, sent, send_attempts: 0 };
  await appendFile(REPORTS_LOG, JSON.stringify(entry) + "\n", "utf-8");
}

/**
 * Append the report locally and (if consent allows) enqueue for upload.
 * Returns immediately — network work is deferred to the flush loop.
 */
export async function enqueue(request: ReportRequest, tier: KiraTier): Promise<void> {
  const consent = await loadConsent();
  // Always append the locally-sanitized payload, even if consent is "off",
  // so users can audit what would have been sent.
  const level = consent.level;
  const payload = buildPayload({ request, level, client_id: consent.client_id, tier });

  await appendLog(payload, false);

  if (level === "off") return;

  queue.push({ payload, attempts: 0 });
  if (queue.length >= BATCH_SIZE) {
    void flush();
  }
}

export function startFlusher(): void {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    void flush();
  }, FLUSH_INTERVAL_MS);
  // Don't keep the event loop alive solely for the flusher.
  flushTimer.unref?.();
}

export function stopFlusher(): void {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
}

/** Best-effort flush on shutdown. Caller decides timeout budget. */
export async function shutdownFlush(timeoutMs = 2_000): Promise<void> {
  stopFlusher();
  await Promise.race([
    flush(),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs).unref?.()),
  ]);
}

async function postBatch(items: QueueItem[]): Promise<{ ok: boolean; status: number }> {
  const body = JSON.stringify({ v: 1, batch: items.map((i) => i.payload) });
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  let payloadBuf: Buffer | string = body;
  if (Buffer.byteLength(body) > GZIP_THRESHOLD_BYTES) {
    payloadBuf = gzipSync(body);
    headers["Content-Encoding"] = "gzip";
  }
  try {
    const res = await fetch(TELEMETRY_URL, {
      method: "POST",
      headers,
      body: payloadBuf as BodyInit,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: false, status: 0 }; // network error
  }
}

/**
 * Drain the in-memory queue. Re-queues 5xx/network failures up to MAX_ATTEMPTS.
 * 4xx responses indicate client-side bugs (bad payload) — drop immediately.
 */
export async function flush(): Promise<void> {
  if (flushing) return;
  if (queue.length === 0) return;
  flushing = true;
  try {
    const batch = queue.splice(0, BATCH_SIZE);
    const { ok, status } = await postBatch(batch);
    if (ok) return;

    if (status >= 400 && status < 500) return; // drop bad payloads

    // Retry-eligible: 5xx, 0 (network), 408, 429
    const retried: QueueItem[] = [];
    for (const item of batch) {
      const next = item.attempts + 1;
      if (next < MAX_ATTEMPTS) retried.push({ ...item, attempts: next });
    }
    queue.unshift(...retried);
  } finally {
    flushing = false;
  }
}

// ── Test helpers (not part of public API) ──────────────────────────────

export function _resetForTests(): void {
  queue = [];
  flushing = false;
  cachedVersion = null;
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
}

export function _queueLength(): number {
  return queue.length;
}

export function _setVersionForTests(v: string | null): void {
  cachedVersion = v;
}

// ── Legacy log migration (one-shot) ────────────────────────────────────

const LEGACY_REPORTS_DIR = join(__dirname, "..", "reports");
const LEGACY_LOG = join(LEGACY_REPORTS_DIR, "reports.log");

/**
 * On first launch with the new pipeline, surface a deprecation notice if
 * the legacy log exists. We do NOT upload historical entries — provenance
 * is unclear and they predate consent.
 */
export function legacyLogPath(): string | null {
  return existsSync(LEGACY_LOG) ? LEGACY_LOG : null;
}

// Re-export for tests / scripts that want raw access.
export { readFile, writeFile };
