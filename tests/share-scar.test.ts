import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// share-scar reads personal scars whose dir binds KIRA_HOME at module load —
// same fresh-import pattern as the record-failure suite.
let tmp: string;

async function fresh() {
  vi.resetModules();
  const ps = await import("../src/personal-scars.ts");
  const tool = await import("../src/tools/share-scar.ts");
  return { ...ps, ...tool };
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "kira-share-"));
  process.env.KIRA_HOME = tmp;
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  delete process.env.KIRA_HOME;
});

describe("handleShareScar", () => {
  it("prepares a community candidate + prefilled URL from a personal scar", async () => {
    const { recordPersonalScar, handleShareScar } = await fresh();
    const scar = await recordPersonalScar({
      title: "build gate bypassed by pipe",
      mistake:
        "gated the merge on a piped build command; the pipeline exit code came from the formatter, not the compiler",
      instead: "run the gating command bare, or set -o pipefail first",
      keywords: ["pipefail", "build gate", "pipe exit code"],
      contexts: ["shell", "ci"],
    });

    const res = await handleShareScar({ scar_id: scar.id });

    expect(res.shared).toContain("nothing");
    expect(res.candidate.id).toMatch(/^scar\.[a-z0-9-]+\.v1$/);
    expect(res.candidate.id).not.toContain("personal");
    expect(res.candidate.hit_count).toBe(1);
    expect(res.candidate.severity).toBe("warning");
    expect(res.issue_title).toContain("[scar]");
    expect(res.issue_body).toContain("```json");
    expect(res.submit_url).toContain(
      "https://github.com/aibenyclaude-coder/Kira/issues/new"
    );
    expect(res.submit_url).toContain("labels=scar-submission");
    expect(res.gh_command).toContain("--label scar-submission");
  });

  it("rejects non-personal scar ids", async () => {
    const { handleShareScar } = await fresh();
    await expect(
      handleShareScar({ scar_id: "scar.vercel-env-vars-missing.v1" })
    ).rejects.toThrow(/Only PERSONAL scars/);
  });

  it("throws a helpful error for an unknown personal id", async () => {
    const { handleShareScar } = await fresh();
    await expect(
      handleShareScar({ scar_id: "scar.personal.nope.12345678.v1" })
    ).rejects.toThrow(/No personal scar/);
  });

  it("falls back to gh_command (submit_url null) when the body exceeds the URL budget", async () => {
    const { recordPersonalScar, handleShareScar } = await fresh();
    const long = "a very long mistake description ".repeat(80); // ~2.5k chars → URL-encoded well past the budget
    const scar = await recordPersonalScar({
      title: "gigantic failure narrative",
      mistake: long,
      instead: long,
    });
    const res = await handleShareScar({ scar_id: scar.id });
    expect(res.submit_url).toBeNull();
    expect(res.gh_command).toContain("gh issue create");
  });

  it("keeps sanitized content stable (double sanitization is a no-op)", async () => {
    const { recordPersonalScar, handleShareScar } = await fresh();
    const scar = await recordPersonalScar({
      title: "leaked path during deploy",
      mistake: "used /home/alice/secret from alice@example.com in the deploy script and it failed",
      instead: "keep credentials in the environment, not in the script",
    });
    const res = await handleShareScar({ scar_id: scar.id });
    // Record-time sanitization already redacted; share-time pass must not mangle further.
    expect(res.candidate.mistake).toBe(scar.mistake);
    expect(String(res.candidate.mistake)).not.toContain("alice@example.com");
    expect(String(res.candidate.mistake)).not.toContain("/home/alice");
  });

  it("ignores an invalid repo argument and uses the default", async () => {
    const { recordPersonalScar, handleShareScar } = await fresh();
    const scar = await recordPersonalScar({
      title: "small failure",
      mistake: "did the wrong thing in a way that is long enough to validate",
    });
    const res = await handleShareScar({ scar_id: scar.id, repo: "not a repo!!" });
    expect(res.gh_command).toContain("aibenyclaude-coder/Kira");
  });
});

describe("KIRA_SHARE_SCAR_TOOL descriptor", () => {
  it("is read-only and closed-world (submission is the human's act)", async () => {
    const { KIRA_SHARE_SCAR_TOOL } = await fresh();
    expect(KIRA_SHARE_SCAR_TOOL.name).toBe("kira_share_scar");
    expect(KIRA_SHARE_SCAR_TOOL.annotations.readOnlyHint).toBe(true);
    expect(KIRA_SHARE_SCAR_TOOL.annotations.openWorldHint).toBe(false);
    expect(KIRA_SHARE_SCAR_TOOL.inputSchema.required).toEqual(["scar_id"]);
  });
});
