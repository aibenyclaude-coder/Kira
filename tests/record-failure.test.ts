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

describe("near-duplicate recurrence folding", () => {
  it("merges a paraphrased recurrence into the existing scar", async () => {
    const { recordPersonalScar } = await fresh();
    const first = await recordPersonalScar({
      title: "build gate bypassed by pipe",
      mistake:
        "gated the merge on npm run build piped to tail; exit code came from tail",
    });
    const second = await recordPersonalScar({
      title: "pipe swallowed build exit code",
      mistake:
        "npm run build piped to tail returned 0 despite tsc failure and the merge gate passed",
      instead: "set -o pipefail or run the build bare",
      severity: "critical",
    });
    expect(second.id).toBe(first.id);
    expect(second.hit_count).toBe(2);
    expect(second.created_at).toBe(first.created_at);
    expect(second.severity).toBe("critical"); // escalated by the recurrence
    expect(second.instead).toContain("pipefail"); // newest fix wins
    expect(readdirSync(join(tmp, "personal-scars"))).toHaveLength(1);
  });

  it("keeps genuinely different failures separate", async () => {
    const { recordPersonalScar } = await fresh();
    await recordPersonalScar({
      title: "vercel env missing",
      mistake: "forgot to add the database url to vercel project settings",
    });
    await recordPersonalScar({
      title: "prisma generate forgotten",
      mistake: "deployed without running prisma generate after a schema change",
    });
    expect(readdirSync(join(tmp, "personal-scars"))).toHaveLength(2);
  });

  it("merges a recurrence whose mistake bodies are worded differently", async () => {
    // Regression: pooling title+mistake into one token set let the long,
    // freely-worded mistake body outvote a strong title match, so this pair
    // (a real recurrence recorded twice on the author's machine) forked into
    // two scars, each stuck at hit_count 1 — the exact fragmentation the
    // recurrence check exists to prevent.
    const { recordPersonalScar } = await fresh();
    const first = await recordPersonalScar({
      title: "patrol: read state file and composed measurement in parallel",
      mistake:
        "read the patrol state file and composed the measurement command in the same turn, so the documented Glama parse note could not inform the command that was already sent",
    });
    const second = await recordPersonalScar({
      title: "Patrol read state-file and composed measurement command in parallel",
      mistake:
        "composed the measurement command in parallel with reading the state file; the parse note documented in that state file arrived too late to be applied",
    });
    expect(second.id).toBe(first.id);
    expect(second.hit_count).toBe(2);
    expect(readdirSync(join(tmp, "personal-scars"))).toHaveLength(1);
  });

  it("does not merge on a short title swallowed by a longer one", async () => {
    // Overlap saturates on tiny token sets, so a 2-token title fully contained
    // in a longer one would score 1.0 on the title term. Distinct failures.
    const { recordPersonalScar } = await fresh();
    await recordPersonalScar({
      title: "build failed",
      mistake: "the npm run build step failed because tsc could not resolve a path alias",
    });
    await recordPersonalScar({
      title: "build failed on ci after a cache restore",
      mistake:
        "github actions restored a stale node_modules cache and the install step was skipped",
    });
    expect(readdirSync(join(tmp, "personal-scars"))).toHaveLength(2);
  });

  it("folds a recurrence recorded in Japanese into the same scar recorded in English", async () => {
    // tokenize() emits CJK character bigrams alongside latin word tokens, so a
    // scar written in Japanese carries a large bigram set that an English scar
    // cannot match by construction. Those tokens are dead weight in every
    // denominator: this pair — the same trap, hit twice on the author's machine
    // and written up once in each language — scored 0.37 against the 0.45
    // threshold and forked into two scars, each stuck at hit_count 1, so the
    // store claimed the wall was hit once and once instead of twice.
    const { recordPersonalScar } = await fresh();
    const first = await recordPersonalScar({
      title:
        "gh pr merge --delete-branch silently leaves BOTH branches behind when a worktree still holds the head branch",
      mistake:
        "Merged a PR with gh pr merge --squash --delete-branch while the feature branch was still checked out in a git worktree. The command exited 0 and deleted nothing: the remote branch survived and so did the local one.",
    });
    const second = await recordPersonalScar({
      title:
        "worktree を先に remove しても gh pr merge --delete-branch はローカルブランチを消さない (squash merge 時)",
      mistake:
        "git worktree remove を先に実行し、その後 gh pr merge --squash --delete-branch を実行した。merge は成功しリモートブランチも削除されたが、ローカルブランチだけが残った。コマンドはエラーも非ゼロ終了も出さない。",
    });
    expect(second.id).toBe(first.id);
    expect(second.hit_count).toBe(2);
    expect(readdirSync(join(tmp, "personal-scars"))).toHaveLength(1);
  });

  it("keeps two distinct Japanese failures separate — CJK still carries the signal", async () => {
    // Guard on the fix above. Ignoring CJK outright would make these two score
    // 0.68 on their shared latin tokens alone and collapse two unrelated
    // failures into one; the bigrams are what tells them apart (0.09). Only a
    // script the OTHER side never uses may be dropped.
    const { recordPersonalScar } = await fresh();
    await recordPersonalScar({
      title: "AI の「送りました」という行動完了報告が虚偽だった",
      mistake:
        "実行はタグ経由のみなのに、AI が自然文で宣言した完了報告をそのまま信じた。実際には何も送信されていない。",
    });
    await recordPersonalScar({
      title: "AI 自身の応答を会話履歴に書き戻さない設計",
      mistake:
        "自分の発言を履歴に残さないため毎回作り直しが起き、成果物が失われて完了の幻覚が生まれる。",
    });
    expect(readdirSync(join(tmp, "personal-scars"))).toHaveLength(2);
  });

  it("does not fold a mixed-script recording into an unrelated latin-only scar on generic shared tokens", async () => {
    // 2026-07-20 incident on the author's store: sharedScripts() drops CJK
    // bigrams when the other side is latin-only, so a 35-token Japanese title
    // shrank to 4 latin tokens — and two of them (continuous + integration)
    // were the expansion of the single word "CI". Two generic tokens over a
    // collapsed divisor scored 0.491 >= 0.45 and the recording folded into a
    // completely unrelated scar, overwriting its `instead`.
    const { recordPersonalScar } = await fresh();
    const first = await recordPersonalScar({
      title:
        "Adding a scar via PR without regenerating docs/stats.json + docs/corpus.json turns CI red",
      mistake:
        "A /harvest opened PR #172 adding 3 new scar JSONs under skills/scars/ but did not regenerate the committed feed/badge artifacts. The client CI job runs `node scripts/gen-stats.mjs --check` and `node scripts/gen-corpus.mjs --check`, both fail-closed when docs/stats.json or docs/corpus.json are stale — so the PR sat UNSTABLE (client exit 1) even though build/test/demo/schema were green.",
      instead: "Regenerate docs/stats.json and docs/corpus.json in the same commit.",
    });
    const second = await recordPersonalScar({
      title:
        "メジャー bump は CI が実行しない script を黙って壊す — 同梱ツールの消失は全ゲートが緑のままでは検知できず、列挙して手で走らせるまで見えない",
      mistake:
        "npm audit を 0 にするため vitest を 2.1.9 → 4.1.10 にメジャー bump した。テスト 362 件全通過、build / demo / gen-stats --check / gen-corpus --check も全部 green で出荷可能に見えた。しかし vitest 4 は vite-node を同梱しなくなる。vite-node は package.json の stats と bench の TS ランナーで、両者は src/ の外にあるため tsc がビルドせず CI も一切実行しない。つまり全ゲート green のまま壊れたスクリプト 2 本を出荷する寸前だった。",
    });
    expect(second.id).not.toBe(first.id);
    expect(second.hit_count).toBe(1);
    expect(readdirSync(join(tmp, "personal-scars"))).toHaveLength(2);
    const onDisk = JSON.parse(
      readFileSync(join(tmp, "personal-scars", `${first.id}.json`), "utf-8")
    );
    expect(onDisk.instead).toBe(
      "Regenerate docs/stats.json and docs/corpus.json in the same commit."
    );
  });

  it("keeps the superseded instead below the newest one when a recurrence folds", async () => {
    // The store has no history: before this guard, a fold silently replaced
    // `instead`, destroying the only copy of the earlier fix — even on a
    // correct fold.
    const { recordPersonalScar } = await fresh();
    await recordPersonalScar({
      title: "build gate bypassed by pipe",
      mistake: "gated the merge on npm run build piped to tail; exit code came from tail",
      instead: "run the build bare so the gate sees the real exit code",
    });
    const merged = await recordPersonalScar({
      title: "pipe swallowed build exit code",
      mistake:
        "npm run build piped to tail returned 0 despite tsc failure and the merge gate passed",
      instead: "set -o pipefail before any piped gate command",
    });
    expect(merged.hit_count).toBe(2);
    expect(merged.instead).toMatch(/^set -o pipefail/); // newest fix stays first
    expect(merged.instead).toContain("[previous instead]");
    expect(merged.instead).toContain("run the build bare");
  });

  it("unions keywords across merged recordings", async () => {
    const { recordPersonalScar } = await fresh();
    await recordPersonalScar({
      title: "push race",
      mistake:
        "two sessions pushed the same repo and the push was rejected non fast forward",
      keywords: ["push race"],
    });
    const merged = await recordPersonalScar({
      title: "push rejected non-ff",
      mistake:
        "parallel session pushed the same repo first; push rejected as non fast forward",
      keywords: ["non-fast-forward"],
    });
    expect(merged.hit_count).toBe(2);
    expect(merged.keywords).toEqual(
      expect.arrayContaining(["push race", "non-fast-forward"])
    );
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
