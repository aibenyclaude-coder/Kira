import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tmp: string;

async function freshTelemetry() {
  vi.resetModules();
  const tel = await import("../src/telemetry.ts");
  tel._setVersionForTests("0.5.0-test");
  return tel;
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "kira-tele-test-"));
  process.env.KIRA_HOME = tmp;
  process.env.KIRA_TELEMETRY = "full";
  process.env.KIRA_TELEMETRY_URL = "http://localhost:1/v1/reports";
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  delete process.env.KIRA_HOME;
  delete process.env.KIRA_TELEMETRY;
  delete process.env.KIRA_TELEMETRY_URL;
  vi.restoreAllMocks();
});

describe("telemetry buildPayload + enqueue", () => {
  it("appends locally even when consent=off", async () => {
    process.env.KIRA_TELEMETRY = "off";
    const tel = await freshTelemetry();
    await tel.enqueue(
      { skill_id: "community.x.v1", status: "success", note: "ok" },
      "free"
    );
    expect(tel._queueLength()).toBe(0);
    const log = readFileSync(join(tmp, "reports.log"), "utf-8").trim();
    const entry = JSON.parse(log);
    expect(entry.skill_id).toBe("community.x.v1");
    expect(entry.sent).toBe(false);
    // detail dropped at level=off
    expect(entry.detail).toBeUndefined();
  });

  it("queues for upload at level=basic without detail", async () => {
    process.env.KIRA_TELEMETRY = "basic";
    const tel = await freshTelemetry();
    await tel.enqueue(
      { skill_id: "community.x.v1", status: "success", note: "should-be-dropped" },
      "free"
    );
    expect(tel._queueLength()).toBe(1);
    const log = readFileSync(join(tmp, "reports.log"), "utf-8").trim();
    const entry = JSON.parse(log);
    expect(entry.detail).toBeUndefined();
  });

  it("queues with sanitized detail at level=full", async () => {
    const tel = await freshTelemetry();
    await tel.enqueue(
      {
        skill_id: "community.x.v1",
        status: "retry",
        note: "leaked sk-NOTREALNOTREALNOTREALNOTREALNOT",
      },
      "free"
    );
    expect(tel._queueLength()).toBe(1);
    const log = readFileSync(join(tmp, "reports.log"), "utf-8").trim();
    const entry = JSON.parse(log);
    expect(entry.detail.note).toContain("[REDACTED]");
    expect(entry.detail.note).not.toContain("sk-NOTREAL");
  });

  it("flush retries on 5xx and drops on 4xx", async () => {
    const tel = await freshTelemetry();
    let calls = 0;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      calls += 1;
      const status = calls === 1 ? 503 : 400;
      return new Response("", { status });
    });
    await tel.enqueue({ skill_id: "community.x.v1", status: "success" }, "free");
    await tel.flush(); // 503 → retry kept
    expect(tel._queueLength()).toBe(1);
    await tel.flush(); // 400 → drop
    expect(tel._queueLength()).toBe(0);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
