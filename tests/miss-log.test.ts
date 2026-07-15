import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// report.ts binds KIRA_HOME (via consent.ts) at module load, so point the env
// at a fresh temp dir and re-import per test — same pattern as the
// record-failure suite.
let tmp: string;

async function freshLogMiss() {
  vi.resetModules();
  const { logMiss } = await import("../src/report.ts");
  return logMiss;
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "kira-miss-log-"));
  process.env.KIRA_HOME = tmp;
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  delete process.env.KIRA_HOME;
});

describe("logMiss", () => {
  it("sanitizes the keyword AND the context tags before writing", async () => {
    const logMiss = await freshLogMiss();
    await logMiss(
      "deploy /home/alice/proj",
      ["ctx alice@example.com", "nextjs"],
      []
    );
    const raw = readFileSync(join(tmp, "misses.log"), "utf-8");
    expect(raw).not.toContain("/home/alice");
    expect(raw).not.toContain("alice@example.com");
    expect(raw).toContain("nextjs");
  });

  it("drops empty context entries and caps the list at 8", async () => {
    const logMiss = await freshLogMiss();
    await logMiss(
      "some keyword",
      ["", ...Array.from({ length: 12 }, (_, i) => `tag${i}`)],
      []
    );
    const entry = JSON.parse(
      readFileSync(join(tmp, "misses.log"), "utf-8").trim()
    );
    // The leading "" is inside the first 8 slots and gets dropped after
    // sanitizing, so 7 real tags remain.
    expect(entry.context).toEqual(
      Array.from({ length: 7 }, (_, i) => `tag${i}`)
    );
  });

  it("records near info as given (id + score pairs, capped at 6)", async () => {
    const logMiss = await freshLogMiss();
    await logMiss(
      "unmatched keyword",
      [],
      Array.from({ length: 9 }, (_, i) => ({ id: `s${i}`, score: 0.5 }))
    );
    const entry = JSON.parse(
      readFileSync(join(tmp, "misses.log"), "utf-8").trim()
    );
    expect(entry.near).toHaveLength(6);
    expect(entry.near[0]).toEqual({ id: "s0", score: 0.5 });
  });

  // A miss carries which recall path produced it. lookup is the default; the
  // route path tags "route" so the flywheel can count route gaps (author a
  // whole route) apart from lookup gaps (author a skill/alias) instead of
  // clustering the two into one polluted demand signal.
  it("tags the entry kind 'lookup' by default", async () => {
    const logMiss = await freshLogMiss();
    await logMiss("some keyword", [], []);
    const entry = JSON.parse(
      readFileSync(join(tmp, "misses.log"), "utf-8").trim()
    );
    expect(entry.kind).toBe("lookup");
  });

  it("tags the entry kind 'route' when a route miss is logged", async () => {
    const logMiss = await freshLogMiss();
    await logMiss("build a discord bot", [], [], "route");
    const entry = JSON.parse(
      readFileSync(join(tmp, "misses.log"), "utf-8").trim()
    );
    expect(entry.kind).toBe("route");
  });
});
