/**
 * kira_status exists to answer "where does my install keep its state". Every
 * path it reports is imported from the module that owns it — except
 * `consent_file`, which used to re-derive the data dir as
 * `process.env.KIRA_HOME ?? \`${process.env.HOME}/.kira\``.
 *
 * consent.ts resolves it with homedir(), which falls back to the passwd entry
 * when $HOME is unset. That is the normal state on Windows outside git-bash,
 * and package.json puts no `os` restriction on the install. With HOME unset the
 * two disagreed: consent.ts wrote to <homedir>/.kira/consent.json while
 * kira_status told the agent the file lived at the literal path
 * "undefined/.kira/consent.json".
 *
 * NEGATIVE CONTROL: restore the re-derived expression in kira_status.ts and the
 * first case below fails with exactly that string. A test that only asserts the
 * two agree under a normal POSIX env passes either way and guards nothing.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tmp: string;
let savedHome: string | undefined;
let savedKiraHome: string | undefined;

/**
 * Load consent.ts + kira_status.ts fresh with homedir() pinned at `tmp`, so the
 * assertion never depends on — or writes to — the real ~/.kira.
 */
async function freshStatus() {
  vi.resetModules();
  const actualOs = await vi.importActual<typeof import("node:os")>("node:os");
  const mocked = { ...actualOs, homedir: () => tmp };
  vi.doMock("node:os", () => ({ ...mocked, default: mocked }));

  const consent = await import("../src/consent.ts");
  const status = await import("../src/tools/kira_status.ts");
  return { consent, status };
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "kira-status-paths-"));
  savedHome = process.env.HOME;
  savedKiraHome = process.env.KIRA_HOME;
  delete process.env.KIRA_TELEMETRY;
});

afterEach(() => {
  vi.doUnmock("node:os");
  vi.resetModules();
  rmSync(tmp, { recursive: true, force: true });
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
  if (savedKiraHome === undefined) delete process.env.KIRA_HOME;
  else process.env.KIRA_HOME = savedKiraHome;
});

const BUILD_ARGS = { tier: "free" as const, skills: [], scars: [], routesCount: 0 };

describe("kira_status reports the consent path consent.ts actually uses", () => {
  it("agrees when $HOME is unset (Windows cmd/powershell, cron, systemd)", async () => {
    delete process.env.HOME;
    delete process.env.KIRA_HOME;

    const { consent, status } = await freshStatus();
    const result = await status.buildStatus(BUILD_ARGS);

    expect(result.paths.consent_file).toBe(consent.CONSENT_FILE);
    expect(result.paths.consent_file).toBe(join(tmp, ".kira", "consent.json"));
    expect(result.paths.consent_file).not.toContain("undefined");
  });

  it("agrees when $HOME is set", async () => {
    process.env.HOME = tmp;
    delete process.env.KIRA_HOME;

    const { consent, status } = await freshStatus();
    const result = await status.buildStatus(BUILD_ARGS);

    expect(result.paths.consent_file).toBe(consent.CONSENT_FILE);
  });

  it("agrees when KIRA_HOME overrides the data dir", async () => {
    const override = mkdtempSync(join(tmpdir(), "kira-status-override-"));
    try {
      delete process.env.HOME;
      process.env.KIRA_HOME = override;

      const { consent, status } = await freshStatus();
      const result = await status.buildStatus(BUILD_ARGS);

      expect(result.paths.consent_file).toBe(consent.CONSENT_FILE);
      expect(result.paths.consent_file).toBe(join(override, "consent.json"));
    } finally {
      rmSync(override, { recursive: true, force: true });
    }
  });

  it("keeps every reported path segment-joined, never string-concatenated", async () => {
    delete process.env.HOME;
    delete process.env.KIRA_HOME;

    const { consent, status } = await freshStatus();
    const result = await status.buildStatus(BUILD_ARGS);

    // join() is what produces the platform separator; "a" + "/" + "b" does not.
    expect(result.paths.consent_file).toBe(
      join(consent.KIRA_HOME, "consent.json")
    );
    expect(result.paths.personal_scars_dir).toBe(
      join(consent.KIRA_HOME, "personal-scars")
    );
    expect(result.paths.reports_log).toBe(join(consent.KIRA_HOME, "reports.log"));
  });
});
