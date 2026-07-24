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

  // A fold keeps the superseded fix under a marker so the local store never
  // loses it (personal-scars.ts:mergeInstead). That history is an artifact of
  // ONE machine's edit log; a corpus entry that carries it tells every future
  // agent to do two different things, the second of which the submitter
  // already abandoned. Repeated scars are exactly the ones worth sharing —
  // the issue body brags about hit_count — so the marker rides along on the
  // best submissions, not the rare ones.
  it("shares only the current fix, not the superseded one a fold kept", async () => {
    const { recordPersonalScar, handleShareScar } = await fresh();
    const first = await recordPersonalScar({
      title: "vite-node vanished after the major bump",
      mistake:
        "assumed the runner survived the major upgrade and kept calling it from the npm scripts",
      instead: "OLD FIX: pin the previous major until the runner is replaced",
    });
    const folded = await recordPersonalScar({
      title: "vite-node vanished after the major bump",
      mistake:
        "assumed the runner survived the major upgrade and kept calling it from the npm scripts again",
      instead: "NEW FIX: diff node_modules/.bin across the bump and swap in tsx",
    });
    expect(folded.id).toBe(first.id); // folded, not a second scar
    expect(folded.hit_count).toBe(2);
    expect(folded.instead).toContain("OLD FIX"); // local store keeps history

    const res = await handleShareScar({ scar_id: folded.id });
    expect(String(res.candidate.instead)).toBe(
      "NEW FIX: diff node_modules/.bin across the bump and swap in tsx"
    );
    expect(String(res.candidate.instead)).not.toContain("previous instead");
    expect(String(res.candidate.instead)).not.toContain("OLD FIX");
    expect(res.issue_body).not.toContain("previous instead");
  });

  it("leaves an unfolded instead exactly as recorded", async () => {
    const { recordPersonalScar, handleShareScar } = await fresh();
    const scar = await recordPersonalScar({
      title: "forgot to regenerate the committed feed artifacts",
      mistake: "opened a scar PR without rerunning the generators, so the check job failed",
      instead: "regenerate docs/stats.json and docs/corpus.json in the same commit",
    });
    const res = await handleShareScar({ scar_id: scar.id });
    expect(res.candidate.instead).toBe(scar.instead);
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

// The candidate id IS the corpus filename the intake bot tells the maintainer
// to commit (scripts/scar-intake.mjs derives skills/scars/<slug>.json from it),
// so a collision is a silent overwrite of somebody else's scar, not a cosmetic
// clash. Measured on the 135-scar store this patrol runs against, 18 of them
// collided before the content hash was added.
describe("buildCandidate id uniqueness", () => {
  const SCAR_ID = /^scar\.[a-z0-9][a-z0-9-]*\.v\d+$/;

  /** Mirrors scripts/scar-intake.mjs — what the maintainer is told to commit. */
  const suggestedFile = (id: string) =>
    `skills/scars/${id.replace(/^scar\./, "").replace(/\.v\d+$/, "")}.json`;

  const scarOf = (title: string, mistake: string): any => ({
    id: "scar.personal.x.00000000.v1",
    keywords: [],
    contexts: [],
    title,
    summary: title,
    severity: "warning",
    mistake,
    instead: "",
    hit_count: 1,
    source: "personal",
    version: "1.0.0",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  });

  it("keeps titles with no latin characters distinct", async () => {
    const { buildCandidate } = await fresh();
    // Real shapes from the store: these all slugified to "" and landed on the
    // single constant id scar.scar.v1 → skills/scars/scar.json.
    const titles = [
      "冪等な置換でマッチ数を書き換え件数として報告した",
      "リードの射程を測るために入力そのものを捏造した",
      "並走セッション間で成果物の存在確認が直後に陳腐化した",
      "古い進捗表を根拠に残タスクを未着手と誤判断した",
    ];
    const ids = titles.map((t) => String(buildCandidate(scarOf(t, `${t} の詳細`)).id));

    expect(new Set(ids).size).toBe(titles.length);
    expect(new Set(ids.map(suggestedFile)).size).toBe(titles.length);
    for (const id of ids) expect(id).toMatch(SCAR_ID);
  });

  it("keeps titles that differ only past the slug truncation distinct", async () => {
    const { buildCandidate } = await fresh();
    const stem = "patrol read state file and composed measurement command";
    const a = buildCandidate(scarOf(`${stem} in parallel`, "raced the read"));
    const b = buildCandidate(scarOf(`${stem} in one shell`, "raced the read"));

    expect(a.id).not.toBe(b.id);
    expect(String(a.id)).toMatch(SCAR_ID);
    expect(String(b.id)).toMatch(SCAR_ID);
  });

  it("keeps titles whose only latin content is incidental debris distinct", async () => {
    const { buildCandidate } = await fresh();
    // Both slugified to "ai" before the fix.
    const a = buildCandidate(scarOf("AIの完了報告が虚偽だった", "報告を信じた"));
    const b = buildCandidate(scarOf("AI自身の応答を履歴に書き戻さない", "毎回作り直した"));

    expect(a.id).not.toBe(b.id);
  });

  it("stays stable for the same content and readable for a latin title", async () => {
    const { buildCandidate } = await fresh();
    const scar = scarOf("prisma generate forgotten", "shipped without regenerating the client");

    expect(buildCandidate(scar).id).toBe(buildCandidate(scar).id);
    expect(String(buildCandidate(scar).id)).toMatch(/^scar\.prisma-generate-forgotten-[0-9a-f]{8}\.v1$/);
  });

  it("distinguishes scars that share a title but not a mistake", async () => {
    const { buildCandidate } = await fresh();
    const a = buildCandidate(scarOf("build gate bypassed", "the pipe swallowed the exit code"));
    const b = buildCandidate(scarOf("build gate bypassed", "the gate ran on a stale artifact"));

    expect(a.id).not.toBe(b.id);
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
