import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  aggregateReports,
  buildCandidates,
  clusterMisses,
  clusterNotes,
  readNdjson,
  runFlywheel,
} from "../src/flywheel.js";

let home: string;
let prevKiraHome: string | undefined;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "kira-flywheel-"));
  prevKiraHome = process.env.KIRA_HOME;
  process.env.KIRA_HOME = home;
});

afterEach(() => {
  if (prevKiraHome === undefined) delete process.env.KIRA_HOME;
  else process.env.KIRA_HOME = prevKiraHome;
});

const miss = (keyword: string, near: Array<{ id: string; score: number }> = []) =>
  JSON.stringify({ v: 1, keyword, context: ["typescript"], near, ts: "2026-07-06T00:00:00Z" });

describe("readNdjson", () => {
  it("skips malformed lines and survives a missing file", async () => {
    await writeFile(join(home, "misses.log"), miss("a b c") + "\nnot json\n\n" + miss("a b c") + "\n");
    const rows = await readNdjson<{ keyword: string }>(join(home, "misses.log"));
    expect(rows.length).toBe(2);
    expect(await readNdjson(join(home, "nope.log"))).toEqual([]);
  });
});

describe("clusterMisses", () => {
  it("groups similar keywords and keeps the best near score", () => {
    const clusters = clusterMisses([
      { keyword: "deploy fastapi app", near: [{ id: "s1", score: 0.31 }] },
      { keyword: "deploying fastapi", near: [{ id: "s1", score: 0.4 }] },
      { keyword: "totally unrelated thing" },
    ]);
    expect(clusters.length).toBe(2);
    expect(clusters[0]!.count).toBe(2);
    expect(clusters[0]!.nearBest.get("s1")).toBe(0.4);
  });

  it("assigns an entry to the MOST similar cluster, not the first past threshold", () => {
    // Entry 3 clears the 0.5 bar for both clusters (0.5 vs cluster 1,
    // 0.8 vs cluster 2) — best-fit must pick cluster 2.
    const clusters = clusterMisses([
      { keyword: "stripe webhook signature verify" },
      { keyword: "stripe webhook retry storm" },
      { keyword: "stripe webhook retry storm signature" },
    ]);
    expect(clusters.length).toBe(2);
    const grown = clusters.find((c) => c.count === 2);
    expect(grown).toBeDefined();
    expect(grown!.rep).toBe("stripe webhook retry storm");
  });

  // Regression: jaccard(a,b) ≤ min/max size, so a terse miss and a verbose one
  // about the same demand can NEVER reach the 0.5 gate. These three are the
  // real misses off this machine's log — they stayed three singleton clusters
  // for every weekly run, which is why Loop B never emitted a candidate.
  it("clusters a terse miss with verbose ones about the same demand", () => {
    const clusters = clusterMisses([
      { keyword: "discord bot claude -p 常駐" },
      { keyword: "discord bot persona 作成 LINE 実データ化" },
      { keyword: "discord bot 機能追加 イベントハンドラ welcome" },
    ]);
    expect(clusters.length).toBe(1);
    expect(clusters[0]!.count).toBe(3);
  });

  it("does not merge on a single shared token — that is a topic, not a demand", () => {
    const clusters = clusterMisses([
      { keyword: "discord channel management" },
      { keyword: "discord bot claude -p 常駐" },
      { keyword: "terraform state locking" },
    ]);
    expect(clusters.length).toBe(3);
  });
});

describe("aggregateReports + clusterNotes", () => {
  it("counts statuses and clusters repeated failure notes", () => {
    const stats = aggregateReports([
      { skill_id: "community.x.v1", status: "retry", detail: { note: "env var missing on deploy" } },
      { skill_id: "community.x.v1", status: "failure", detail: { note: "missing env vars during deploy" } },
      { skill_id: "community.x.v1", status: "success" },
      { skill_id: "community.y.v1", status: "success" },
    ]);
    expect(stats[0]!.skill_id).toBe("community.x.v1");
    expect(stats[0]!.retry + stats[0]!.failure).toBe(2);
    const noteClusters = clusterNotes(stats[0]!.notes);
    expect(noteClusters.length).toBe(1);
    expect(noteClusters[0]!.all.length).toBe(2);
  });
});

describe("buildCandidates", () => {
  it("proposes an alias when a near match existed, a gap stub otherwise", () => {
    const clusters = clusterMisses([
      { keyword: "deploy fastapi", near: [{ id: "community.deploy-vercel.v1", score: 0.35 }] },
      { keyword: "deploying fastapi", near: [{ id: "community.deploy-vercel.v1", score: 0.35 }] },
      { keyword: "terraform state locking" },
      { keyword: "terraform state lock stuck" },
    ]);
    const cands = buildCandidates(clusters, [], "2026-07-06T00:00:00Z");
    const kinds = cands.map((c) => c.kind).sort();
    expect(kinds).toContain("alias");
    expect(kinds).toContain("skill-gap");
  });

  // A candidate id is the corpus filename a maintainer is told to commit, so
  // it has to satisfy the validator and stay unique. The old token-derived
  // slug did neither: tokenize() emits CJK bigrams first, and stripping them
  // left the separator behind (`community.-discord-bot-claude.v1`), while a
  // title with no latin at all collapsed onto the constant "unnamed".
  const SKILL_ID = /^(community|vendor)\.[a-z0-9][a-z0-9-]*\.v\d+$/;

  it("emits an id the validator accepts even when the demand is not latin", () => {
    const clusters = clusterMisses([
      { keyword: "discord bot claude -p 常駐" },
      { keyword: "discord bot persona 作成 LINE 実データ化" },
    ]);
    const [cand] = buildCandidates(clusters, [], "2026-07-06T00:00:00Z");
    expect(String(cand!.body.id)).toMatch(SKILL_ID);
    expect(cand!.file.startsWith("skill-gap--")).toBe(false);
  });

  it("gives two all-CJK demands distinct ids instead of one shared constant", () => {
    const clusters = clusterMisses([
      { keyword: "データベース 設計 正規化 手順" },
      { keyword: "データベース 設計 正規化 手順 具体例" },
      { keyword: "請求書 作成 自動化 手順" },
      { keyword: "請求書 作成 自動化 手順 詳細" },
    ]);
    const cands = buildCandidates(clusters, [], "2026-07-06T00:00:00Z");
    expect(cands.length).toBe(2);
    for (const c of cands) expect(String(c.body.id)).toMatch(SKILL_ID);
    expect(new Set(cands.map((c) => c.file)).size).toBe(2);
    expect(cands.some((c) => c.file.includes("unnamed"))).toBe(false);
  });
});

describe("route-miss separation (Loop B stays clean, route gaps surfaced)", () => {
  const rmiss = (keyword: string) =>
    JSON.stringify({
      v: 1,
      kind: "route",
      keyword,
      context: [],
      near: [],
      ts: "2026-07-06T00:00:00Z",
    });

  it("keeps kind:route misses out of the lookup clusters and lists them as route gaps", async () => {
    await writeFile(
      join(home, "misses.log"),
      [
        miss("terraform state locking"),
        miss("terraform state lock stuck"),
        rmiss("build a discord bot"),
        rmiss("build a discord bot with slash commands"),
      ].join("\n") + "\n"
    );

    const res = await runFlywheel({ emitCandidates: true });
    const digest = await readFile(res.digestPath, "utf-8");

    // The lookup Loop B section (everything before the route-gap header) still
    // sees terraform and must NOT absorb the route goal as a lookup miss.
    const loopB = digest.split(/route gaps/i)[0]!;
    expect(loopB).toContain("terraform");
    expect(loopB).not.toContain("discord");

    // Route gaps get their own section.
    expect(digest).toMatch(/route gaps/i);
    expect(digest).toContain("discord bot");

    // A route gap is not a skill gap: buildCandidates never sees it, so no
    // skill-gap/alias candidate is emitted for the route goal.
    const emitted = await readdir(join(home, "flywheel", "candidates"));
    expect(emitted.some((f) => f.toLowerCase().includes("discord"))).toBe(false);
  });
});

describe("runFlywheel (end-to-end, no LLM)", () => {
  it("writes a digest and candidate stubs from dirty real-shaped logs", async () => {
    await writeFile(
      join(home, "misses.log"),
      [miss("terraform state locking"), miss("terraform state lock stuck"), "garbage line"].join("\n") + "\n"
    );
    await writeFile(
      join(home, "reports.log"),
      [
        JSON.stringify({ skill_id: "community.x.v1", status: "retry", detail: { note: "prisma generate forgotten" } }),
        JSON.stringify({ skill_id: "community.x.v1", status: "failure", detail: { note: "forgot prisma generate again" } }),
      ].join("\n") + "\n"
    );
    await mkdir(join(home, "personal-scars"), { recursive: true });
    await writeFile(
      join(home, "personal-scars", "p1.json"),
      JSON.stringify({ id: "pscar.p1", title: "pkill -f self-match", hit_count: 4 })
    );

    const res = await runFlywheel({ emitCandidates: true });
    expect(res.candidates).toBeGreaterThanOrEqual(2);

    const digest = await readFile(res.digestPath, "utf-8");
    expect(digest).toContain("terraform");
    expect(digest).toContain("community.x.v1");
    expect(digest).toContain("promotion candidate"); // hit_count 4 ≥ 3

    const emitted = await readdir(join(home, "flywheel", "candidates"));
    expect(emitted.some((f) => f.startsWith("skill-gap-"))).toBe(true);
    expect(emitted.some((f) => f.startsWith("scar-"))).toBe(true);
  });
});
