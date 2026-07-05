import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// personal-scars.ts reads KIRA_HOME (via consent.ts) at module load, so we set
// it to a fresh temp dir and re-import the module registry for each test.
let tmp: string;

async function fresh() {
  vi.resetModules();
  const ps = await import("../src/personal-scars.ts");
  const tool = await import("../src/tools/record-failure.ts");
  return { ...ps, ...tool };
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "kira-scars-test-"));
  process.env.KIRA_HOME = tmp;
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  delete process.env.KIRA_HOME;
  vi.restoreAllMocks();
});

describe("recordPersonalScar", () => {
  it("writes a personal scar to ~/.kira/personal-scars/<id>.json", async () => {
    const { recordPersonalScar, PERSONAL_SCARS_DIR } = await fresh();
    expect(PERSONAL_SCARS_DIR).toBe(join(tmp, "personal-scars"));

    const scar = await recordPersonalScar({
      title: "npm install broke expo native module",
      mistake: "ran npm install expo-camera instead of npx expo install",
      instead: "always use npx expo install for Expo SDK packages",
    });

    const file = join(PERSONAL_SCARS_DIR, `${scar.id}.json`);
    expect(existsSync(file)).toBe(true);

    const onDisk = JSON.parse(readFileSync(file, "utf-8"));
    expect(onDisk.id).toBe(scar.id);
    expect(onDisk.source).toBe("personal");
    expect(onDisk.title).toContain("expo");
    expect(onDisk.instead).toContain("npx expo install");
    expect(onDisk.hit_count).toBe(1);
  });

  it("derives a stable id of the form scar.personal.<slug>.<hash>.v1", async () => {
    const { recordPersonalScar } = await fresh();
    const scar = await recordPersonalScar({
      title: "Deploy failed on Vercel",
      mistake: "missing env var",
    });
    expect(scar.id).toMatch(/^scar\.personal\.[a-z0-9-]+\.[0-9a-f]{8}\.v1$/);
  });

  it("sanitizes secrets, paths and emails before writing to disk", async () => {
    const { recordPersonalScar } = await fresh();
    const secret = "sk-NOTREALNOTREALNOTREALNOTREALNOT";
    const scar = await recordPersonalScar({
      title: "leaked key during build",
      mistake: `used ${secret} from /home/alice/proj with alice@example.com`,
      instead: "rotate the key",
    });

    const raw = readFileSync(join(tmp, "personal-scars", `${scar.id}.json`), "utf-8");
    // Raw secrets must never survive to disk.
    expect(raw).not.toContain(secret);
    expect(raw).not.toContain("/home/alice");
    expect(raw).not.toContain("alice@example.com");
    // ...replaced by the sanitizer's redaction markers.
    expect(scar.mistake).toContain("[REDACTED]");
    expect(scar.mistake).toContain("/[USER]");
    expect(scar.mistake).toContain("[EMAIL]");
  });

  it("bumps hit_count and preserves created_at when the same failure recurs", async () => {
    const { recordPersonalScar } = await fresh();
    const input = { title: "flaky test", mistake: "assumed deterministic ordering" };

    const first = await recordPersonalScar(input);
    expect(first.hit_count).toBe(1);

    const second = await recordPersonalScar(input);
    expect(second.id).toBe(first.id);
    expect(second.hit_count).toBe(2);
    expect(second.created_at).toBe(first.created_at);

    // A recurring failure collapses onto a single file, not one per occurrence.
    const files = readdirSync(join(tmp, "personal-scars"));
    expect(files).toEqual([`${first.id}.json`]);
  });

  it("defaults severity to warning and honors critical", async () => {
    const { recordPersonalScar } = await fresh();
    const warn = await recordPersonalScar({ title: "minor slip", mistake: "typo" });
    expect(warn.severity).toBe("warning");

    const crit = await recordPersonalScar({
      title: "data loss",
      mistake: "dropped the table",
      severity: "critical",
    });
    expect(crit.severity).toBe("critical");
  });

  it("keeps sanitized keywords/contexts and drops non-strings", async () => {
    const { recordPersonalScar } = await fresh();
    const scar = await recordPersonalScar({
      title: "t",
      mistake: "m",
      // @ts-expect-error — exercise runtime filtering of non-string entries.
      keywords: ["deploy", "  vercel  ", 42, ""],
      contexts: ["nextjs"],
    });
    expect(scar.keywords).toEqual(["deploy", "vercel"]);
    expect(scar.contexts).toEqual(["nextjs"]);
  });

  it("never touches the network", async () => {
    const { recordPersonalScar } = await fresh();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await recordPersonalScar({ title: "t", mistake: "m" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("never writes to stdout (stdout is the MCP transport)", async () => {
    const { recordPersonalScar } = await fresh();
    const stdoutSpy = vi.spyOn(process.stdout, "write");
    await recordPersonalScar({ title: "t", mistake: "m" });
    expect(stdoutSpy).not.toHaveBeenCalled();
  });
});

describe("loadPersonalScars", () => {
  it("returns [] when no scar has been recorded yet", async () => {
    const { loadPersonalScars } = await fresh();
    expect(await loadPersonalScars()).toEqual([]);
  });

  it("loads recorded scars with source=personal and skips junk files", async () => {
    const { recordPersonalScar, loadPersonalScars, PERSONAL_SCARS_DIR } =
      await fresh();
    await recordPersonalScar({ title: "deploy failed", mistake: "missing env var" });
    writeFileSync(join(PERSONAL_SCARS_DIR, "broken.json"), "{ nope");
    writeFileSync(join(PERSONAL_SCARS_DIR, "notes.txt"), "not a scar");
    writeFileSync(
      join(PERSONAL_SCARS_DIR, "missing-core.json"),
      JSON.stringify({ id: "scar.personal.x.v1", title: "no mistake field" })
    );

    const loaded = await loadPersonalScars();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.source).toBe("personal");
    expect(loaded[0]!.title).toContain("deploy");
  });

  it("normalizes missing optional fields to safe defaults", async () => {
    const { loadPersonalScars, PERSONAL_SCARS_DIR } = await fresh();
    mkdirSync(PERSONAL_SCARS_DIR, { recursive: true });
    writeFileSync(
      join(PERSONAL_SCARS_DIR, "bare.json"),
      JSON.stringify({ id: "scar.personal.bare.v1", title: "bare", mistake: "m" })
    );

    const [scar] = await loadPersonalScars();
    expect(scar!.summary).toBe("bare");
    expect(scar!.severity).toBe("warning");
    expect(scar!.hit_count).toBe(1);
    expect(scar!.keywords).toEqual([]);
    expect(scar!.instead).toBe("");
  });
});

describe("handleRecordFailure", () => {
  it("throws when title is missing", async () => {
    const { handleRecordFailure } = await fresh();
    await expect(handleRecordFailure({ mistake: "m" })).rejects.toThrow(/title/);
  });

  it("throws when mistake is missing", async () => {
    const { handleRecordFailure } = await fresh();
    await expect(handleRecordFailure({ title: "t" })).rejects.toThrow(/mistake/);
  });

  it("throws on an invalid severity", async () => {
    const { handleRecordFailure } = await fresh();
    await expect(
      handleRecordFailure({ title: "t", mistake: "m", severity: "fatal" })
    ).rejects.toThrow(/severity/);
  });

  it("throws when keywords is not an array", async () => {
    const { handleRecordFailure } = await fresh();
    await expect(
      handleRecordFailure({ title: "t", mistake: "m", keywords: "deploy" })
    ).rejects.toThrow(/keywords/);
  });

  it("acks with a local-only path and persists the scar", async () => {
    const { handleRecordFailure } = await fresh();
    const res = await handleRecordFailure({
      title: "deploy failed",
      mistake: "missing env var",
    });
    expect(res.ack).toBe(true);
    expect(res.stored).toBe("local-only");
    expect(res.path).toBe(join(tmp, "personal-scars", `${res.scar.id}.json`));
    expect(existsSync(res.path)).toBe(true);
  });
});

describe("KIRA_RECORD_FAILURE_TOOL descriptor", () => {
  it("is a well-formed, local-only MCP tool", async () => {
    const { KIRA_RECORD_FAILURE_TOOL } = await fresh();
    expect(KIRA_RECORD_FAILURE_TOOL.name).toBe("kira_record_failure");
    expect(KIRA_RECORD_FAILURE_TOOL.inputSchema.required).toEqual(["title", "mistake"]);
    // Local-only: the tool must not advertise open-world (network) reach.
    expect(KIRA_RECORD_FAILURE_TOOL.annotations.openWorldHint).toBe(false);
    expect(KIRA_RECORD_FAILURE_TOOL.annotations.readOnlyHint).toBe(false);
  });
});
