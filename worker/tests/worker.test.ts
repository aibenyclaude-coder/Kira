import { describe, it, expect, beforeAll } from "vitest";
import { env, SELF } from "cloudflare:test";

const validPayload = {
  v: 1 as const,
  skill_id: "community.deploy-vercel-nextjs.v1",
  status: "success" as const,
  client_id: "00000000-0000-4000-8000-000000000001",
  kira_version: "0.5.0-test",
  ts: "2026-05-10T00:00:00.000Z",
  env: { os: "linux" as const, node_major: 20, tier: "free" as const },
};

beforeAll(async () => {
  await env.DB.exec(
    "CREATE TABLE IF NOT EXISTS events (" +
      "id INTEGER PRIMARY KEY AUTOINCREMENT," +
      "skill_id TEXT NOT NULL," +
      "status TEXT NOT NULL," +
      "client_id TEXT NOT NULL," +
      "kira_version TEXT NOT NULL," +
      "os TEXT NOT NULL," +
      "node_major INTEGER NOT NULL," +
      "tier TEXT NOT NULL," +
      "note TEXT," +
      "context TEXT," +
      "ts TEXT NOT NULL," +
      "received_at TEXT NOT NULL DEFAULT (datetime('now'))," +
      "ip_hash TEXT" +
      ")"
  );
});

describe("worker routes", () => {
  it("ingests a valid batch and returns 202", async () => {
    const res = await SELF.fetch("https://w/v1/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ v: 1, batch: [validPayload] }),
    });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ accepted: 1 });
  });

  it("rejects unknown route with 404", async () => {
    const res = await SELF.fetch("https://w/nope");
    expect(res.status).toBe(404);
  });

  it("rejects malformed JSON with 400", async () => {
    const res = await SELF.fetch("https://w/v1/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });
    expect(res.status).toBe(400);
  });

  it("rejects oversize batch with 400", async () => {
    const big = { v: 1, batch: Array.from({ length: 101 }, () => validPayload) };
    const res = await SELF.fetch("https://w/v1/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(big),
    });
    expect(res.status).toBe(400);
  });

  it("re-sanitizes server-side", async () => {
    const dirty = {
      ...validPayload,
      detail: {
        note: "leaked sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ012345 here",
      },
    };
    const res = await SELF.fetch("https://w/v1/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ v: 1, batch: [dirty] }),
    });
    expect(res.status).toBe(202);
    const row = await env.DB.prepare(
      "SELECT note FROM events ORDER BY id DESC LIMIT 1"
    ).first<{ note: string }>();
    expect(row?.note).toContain("[REDACTED]");
    expect(row?.note).not.toContain("sk-ABCDEFG");
  });

  it("returns aggregate stats", async () => {
    // Self-contained: each Worker isolate may have a fresh DB, so seed
    // exactly the row we want to read.
    const skill_id = "community.stats-test.v1";
    const seed = { ...validPayload, skill_id, ts: new Date().toISOString() };
    const ing = await SELF.fetch("https://w/v1/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ v: 1, batch: [seed] }),
    });
    expect(ing.status).toBe(202);

    const res = await SELF.fetch(
      `https://w/v1/stats/${encodeURIComponent(skill_id)}`
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      skill_id: string;
      total: number;
      success: number;
    };
    expect(body.skill_id).toBe(skill_id);
    expect(body.total).toBe(1);
    expect(body.success).toBe(1);
  });
});
