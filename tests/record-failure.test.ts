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

describe("redaction reporting", () => {
  it("omits the redactions field when nothing was rewritten", async () => {
    const { handleRecordFailure } = await fresh();
    const res = await handleRecordFailure({
      title: "deploy failed on a cold cache",
      mistake: "assumed the build step warmed it",
    });
    expect(res.redactions).toBeUndefined();
  });

  it("reports which rule ate the text and in which field", async () => {
    const { handleRecordFailure } = await fresh();
    const res = await handleRecordFailure({
      title: "escalation went to the wrong inbox",
      // This test is about the REPORTING path, so its vehicle has to be a span
      // the sanitizer genuinely rewrites. It used to be a systemd unit, which
      // the email rule no longer touches — an address keeps it honest.
      mistake: "the log said oncall@example.com and I trusted it",
      instead: "verify with MAX_TRIES=3 against systemctl",
    });
    expect(res.redactions?.count).toBe(2);
    expect(res.redactions?.fields).toEqual(["mistake", "instead"]);
    expect(res.redactions?.patterns).toEqual(["email", "env-assignment"]);
    expect(res.scar.mistake).toContain("[EMAIL]");
    expect(res.redactions?.note).toContain("differs from what you sent");
  });

  it("reports truncation even when no rule fired", async () => {
    const { handleRecordFailure } = await fresh();
    const res = await handleRecordFailure({
      title: "short title",
      mistake: "X".repeat(2500),
    });
    expect(res.redactions?.count).toBe(0);
    expect(res.redactions?.truncated).toEqual(["mistake"]);
    expect(res.redactions?.note).toContain("tail dropped");
  });

  it("describes the rewrite even when the scar folds into an existing one", async () => {
    const { handleRecordFailure } = await fresh();
    const input = {
      title: "escalation reported a stale inbox",
      mistake: "the log said oncall@example.com and I trusted it",
    };
    await handleRecordFailure(input);
    const again = await handleRecordFailure(input);
    expect(again.scar.hit_count).toBe(2);
    expect(again.redactions?.patterns).toEqual(["email"]);
  });
});

describe("glued-parameter reporting", () => {
  // The exact shape measured on 10 of 117 real kira_record_failure calls:
  // the next parameter's opening tag lands inside `mistake` and that
  // parameter never arrives.
  const GLUED_MISTAKE =
    "the suite stayed green because no fixture used that shape." +
    '</mistake>\n<parameter name="instead">When you narrow ANY rule in an ' +
    "ordered pipeline, enumerate the inputs that must keep their old output.";

  it("omits the malformed field for an intact call", async () => {
    const { handleRecordFailure } = await fresh();
    const res = await handleRecordFailure({
      title: "the gate passed for the wrong reason",
      mistake: "trusted a green suite that had no fixture for the changed branch",
      instead: "add the fixture first, then narrow the rule",
    });
    expect(res.malformed).toBeUndefined();
  });

  it("flags the glued field and names the parameter whose text was lost", async () => {
    const { handleRecordFailure } = await fresh();
    const res = await handleRecordFailure({
      title: "narrowing a rule hid a partial match",
      mistake: GLUED_MISTAKE,
    });
    // Still stored — the scar is half-broken, not invalid.
    expect(res.ack).toBe(true);
    expect(res.malformed?.fields).toEqual(["mistake"]);
    expect(res.malformed?.glued).toEqual(["mistake", "instead"]);
    // `mistake` did arrive; `instead` is the text that was swallowed.
    expect(res.malformed?.lost).toEqual(["instead"]);
    expect(res.malformed?.note).toContain("glued together in transport");
    expect(res.malformed?.note).toContain("arrived empty");
  });

  it("reports the glue without rewriting the stored text", async () => {
    const { handleRecordFailure } = await fresh();
    const res = await handleRecordFailure({
      title: "narrowing a rule hid a partial match",
      mistake: GLUED_MISTAKE,
    });
    // Splitting the value back into fields would guess at a boundary the
    // server cannot see, so the text reaches disk exactly as sent.
    expect(res.scar.mistake).toContain('<parameter name="instead">');
    expect(res.scar.instead).toBe("");
    expect(readFileSync(res.path, "utf-8")).toContain("</mistake>");
  });

  it("does not claim a loss when the named parameter did arrive", async () => {
    const { handleRecordFailure } = await fresh();
    // A lesson that legitimately quotes the tag it is warning about: still
    // worth flagging, but nothing was swallowed.
    const res = await handleRecordFailure({
      title: "a glued tool call stored an empty field",
      mistake:
        "the stored mistake ended with the literal string " +
        '\'<parameter name="instead">\' and the fix was gone',
      instead: "read the record back field by field before moving on",
    });
    expect(res.malformed?.glued).toEqual(["instead"]);
    expect(res.malformed?.lost).toEqual([]);
    expect(res.malformed?.note).not.toContain("arrived empty");
  });

  it("counts an absent array parameter as lost", async () => {
    const { handleRecordFailure } = await fresh();
    const res = await handleRecordFailure({
      title: "keywords were swallowed by the glue",
      mistake:
        "the run never fired the scar back" +
        '</mistake>\n<parameter name="keywords">["ci gate", "runbook drift"]',
    });
    expect(res.malformed?.lost).toEqual(["keywords"]);
  });

  it("leaves ordinary markup and prose alone", async () => {
    const { describeGluedFields } = await fresh();
    // Angle brackets and the word "instead" are normal in lesson text; only a
    // tag naming one of this tool's own parameters is evidence of a glue.
    expect(
      describeGluedFields({
        title: "compare with <redirect> and </div> in the template",
        mistake: "used `a < b` in the guard and it parsed as a tag",
        instead: "escape it, or use a spaced comparison instead",
      })
    ).toBeNull();
  });
});

describe("fold reporting", () => {
  // A fold rewrites an EXISTING scar and drops the submitted title/mistake:
  // the store keeps the older recording's identity. Measured on the author's
  // machine, 6 folds have happened across 171 scars and 2 of them were wrong
  // (2026-07-20: a recording about a major dependency bump was merged into an
  // unrelated CI-artifact scar, and its title + mistake exist nowhere). Every
  // one of those calls returned the same `ack: true` a fresh record returns,
  // so the loss was invisible at the moment it happened.
  const FIRST = {
    title: "build gate bypassed by pipe",
    mistake:
      "gated the merge on npm run build piped to tail; exit code came from tail",
    instead: "run the build bare so the gate sees the real exit code",
  };
  const RECURRENCE = {
    title: "pipe swallowed build exit code",
    mistake:
      "npm run build piped to tail returned 0 despite tsc failure and the merge gate passed",
    instead: "set -o pipefail before any piped gate command",
  };

  it("omits the folded field when the recording becomes its own scar", async () => {
    const { handleRecordFailure } = await fresh();
    const res = await handleRecordFailure(FIRST);
    expect(res.folded).toBeUndefined();
    expect(res.scar.title).toBe(FIRST.title);
  });

  it("names the scar the recording was merged into", async () => {
    const { handleRecordFailure } = await fresh();
    const first = await handleRecordFailure(FIRST);
    const res = await handleRecordFailure(RECURRENCE);

    // The ack carries someone ELSE's title, and `path` points at a file this
    // call never created — that is exactly what the report has to disclose.
    expect(res.scar.id).toBe(first.scar.id);
    expect(res.scar.title).toBe(FIRST.title);
    expect(res.folded?.into).toBe(first.scar.id);
    expect(res.folded?.into_title).toBe(FIRST.title);
    expect(res.folded?.hit_count).toBe(2);
    expect(res.folded?.similarity).toBeGreaterThanOrEqual(0.45);
  });

  it("lists the submitted fields that are not on disk", async () => {
    const { handleRecordFailure } = await fresh();
    await handleRecordFailure(FIRST);
    const res = await handleRecordFailure(RECURRENCE);
    // title and mistake were replaced by the existing scar's text...
    expect(res.folded?.dropped).toContain("title");
    expect(res.folded?.dropped).toContain("mistake");
    // ...but `instead` survives above the [previous instead] marker, so
    // claiming it was dropped would be a false alarm.
    expect(res.folded?.dropped).not.toContain("instead");
    expect(res.scar.instead).toContain("set -o pipefail");
  });

  it("reports the fold on a recurrence with no instead of its own", async () => {
    const { handleRecordFailure } = await fresh();
    await handleRecordFailure(FIRST);
    const res = await handleRecordFailure({
      title: RECURRENCE.title,
      mistake: RECURRENCE.mistake,
    });
    expect(res.folded?.into_title).toBe(FIRST.title);
    expect(res.folded?.dropped).not.toContain("instead");
  });

  it("tells the caller what to do when the merge was wrong", async () => {
    const { handleRecordFailure } = await fresh();
    await handleRecordFailure(FIRST);
    const res = await handleRecordFailure(RECURRENCE);
    expect(res.folded?.note).toContain(FIRST.title);
    expect(res.folded?.note).toContain("different failure");
    // The file is the only place the merge can be undone.
    expect(res.folded?.note).toContain("path");
  });

  it("does not report a fold for a genuinely different failure", async () => {
    const { handleRecordFailure } = await fresh();
    await handleRecordFailure({
      title: "vercel env missing",
      mistake: "forgot to add the database url to vercel project settings",
    });
    const res = await handleRecordFailure({
      title: "prisma generate forgotten",
      mistake: "deployed without running prisma generate after a schema change",
    });
    expect(res.folded).toBeUndefined();
    expect(res.scar.title).toBe("prisma generate forgotten");
  });

  it("reports the fold that bumps hit_count on an identical re-record", async () => {
    const { handleRecordFailure } = await fresh();
    await handleRecordFailure(FIRST);
    const res = await handleRecordFailure(FIRST);
    expect(res.folded?.into_title).toBe(FIRST.title);
    expect(res.folded?.hit_count).toBe(2);
    // Same text on both sides: nothing the caller sent was lost.
    expect(res.folded?.dropped).toEqual([]);
  });

  it("exposes the fold through the recorder itself, not just the tool", async () => {
    const { recordPersonalScarDetailed } = await fresh();
    const first = await recordPersonalScarDetailed(FIRST);
    expect(first.fold).toBeNull();
    const second = await recordPersonalScarDetailed(RECURRENCE);
    expect(second.fold?.into).toBe(first.scar.id);
    expect(second.scar.hit_count).toBe(2);
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
