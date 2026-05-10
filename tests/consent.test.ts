import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// We need to set KIRA_HOME *before* importing consent.ts, so the module
// reads the temp directory at boot. Each test resets the module registry.
let tmp: string;

async function freshConsent() {
  vi.resetModules();
  return await import("../src/consent.ts");
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "kira-consent-test-"));
  process.env.KIRA_HOME = tmp;
  delete process.env.KIRA_TELEMETRY;
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  delete process.env.KIRA_HOME;
  delete process.env.KIRA_TELEMETRY;
});

describe("consent flow", () => {
  it("creates a default basic state on first run", async () => {
    const { loadConsent, CONSENT_FILE } = await freshConsent();
    const state = await loadConsent();
    expect(state.level).toBe("basic");
    expect(state.source).toBe("default_basic");
    expect(state.client_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    expect(existsSync(CONSENT_FILE)).toBe(true);
  });

  it("env var overrides on-disk state without persisting", async () => {
    process.env.KIRA_TELEMETRY = "off";
    const { loadConsent, CONSENT_FILE } = await freshConsent();
    const state = await loadConsent();
    expect(state.level).toBe("off");
    expect(state.source).toBe("env");
    // No file written for env-only state.
    expect(existsSync(CONSENT_FILE)).toBe(false);
  });

  it("setConsent('off') regenerates client_id", async () => {
    const { loadConsent, setConsent } = await freshConsent();
    const before = await loadConsent();
    const after = await setConsent("off", "tool");
    expect(after.level).toBe("off");
    expect(after.client_id).not.toBe(before.client_id);
  });

  it("setConsent keeps client_id stable when not opting out", async () => {
    const { loadConsent, setConsent } = await freshConsent();
    const before = await loadConsent();
    const after = await setConsent("full", "tool");
    expect(after.level).toBe("full");
    expect(after.client_id).toBe(before.client_id);
  });

  it("falls back to default_basic on corrupt file", async () => {
    writeFileSync(join(tmp, "consent.json"), "{not json", "utf-8");
    const { loadConsent } = await freshConsent();
    const state = await loadConsent();
    expect(state.level).toBe("basic");
    expect(state.source).toBe("default_basic");
  });

  it("hasSeenPrompt is false on default_basic, true after markPromptSeen", async () => {
    const { loadConsent, hasSeenPrompt, markPromptSeen } = await freshConsent();
    await loadConsent();
    expect(await hasSeenPrompt()).toBe(false);
    await markPromptSeen();
    expect(await hasSeenPrompt()).toBe(true);
  });
});
