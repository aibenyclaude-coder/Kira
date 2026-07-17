import { describe, it, expect } from "vitest";
import { lookup, indexItems } from "../src/lookup.js";
import type { Skill, Scar } from "../src/types.js";

/**
 * Tier 2 used to be raw substring containment, so a keyword fired whenever a
 * query merely SPELLED it inside a longer word: "rm" inside "fo(rm)", "tail"
 * inside "(tail)wind", "test" inside "vi(test)". Scars sort critical-first, so
 * these landed at the TOP of the agent's "what not to do" list.
 */

const scar = (over: Partial<Scar>): Scar => ({
  id: "scar.x.v1",
  keywords: [],
  contexts: [],
  title: "x",
  summary: "x",
  severity: "warning",
  mistake: "x",
  instead: "x",
  hit_count: 1,
  version: "1.0.0",
  updated_at: "2026-01-01T00:00:00Z",
  ...over,
});

const skill = (over: Partial<Skill>): Skill => ({
  id: "community.x.v1",
  keywords: [],
  contexts: [],
  title: "x",
  summary: "x",
  source: "community",
  declaration: "x",
  instructions: "x",
  version: "1.0.0",
  updated_at: "2026-01-01T00:00:00Z",
  ...over,
});

const RM_SCAR = scar({
  id: "scar.rm-live-data.v1",
  keywords: ["rm", "rm -rf", "delete"],
  title: "Listing and deleting in one command wiped live data",
  severity: "critical",
});
const TAIL_SCAR = scar({
  id: "scar.pipe-to-tail.v1",
  keywords: ["tail", "pipefail", "exit code"],
  title: "Build gate bypassed: exit code swallowed by pipe to tail",
  severity: "critical",
});
const TEST_SCAR = scar({
  id: "scar.redis-test.v1",
  keywords: ["test", "redis", "discord"],
  title: "Redis-injected bot test looked like the AI talking to itself",
});

describe("tier 2 respects word boundaries", () => {
  const scars = indexItems([RM_SCAR, TAIL_SCAR, TEST_SCAR]);

  it.each([
    ["form validation", "rm"],
    ["zod react hook form", "rm"],
    ["prisma orm", "rm"],
    ["setup tailwind", "tail"],
    ["tailwind css", "tail"],
    ["setup vitest", "test"],
  ])("query %j does not fire the scar keyword %j spelled inside a word", (query) => {
    const res = lookup([], scars, { keyword: query });
    expect(res.scars).toEqual([]);
    expect(res.scar_count).toBe(0);
  });

  it.each([
    ["rm -rf the build dir", "scar.rm-live-data.v1"],
    ["pipe to tail", "scar.pipe-to-tail.v1"],
    ["redis test", "scar.redis-test.v1"],
  ])("query %j still fires when the keyword appears as a whole word", (query, id) => {
    const res = lookup([], scars, { keyword: query });
    expect(res.scars.map((s) => s.id)).toContain(id);
  });

  it("keeps a keyword that is a whole word next to punctuation", () => {
    const pages = indexItems([
      scar({ id: "scar.cf-pages.v1", keywords: ["cloudflare-pages"], title: "Soft 404" }),
    ]);
    // "cloudflare-pages".includes("cloudflare pages") was false — the hyphen made
    // substring matching miss a match it should have made.
    const res = lookup([], pages, { keyword: "cloudflare pages" });
    expect(res.scars.map((s) => s.id)).toEqual(["scar.cf-pages.v1"]);
  });

  it("folds plurals through the same stemmer similarity.ts uses", () => {
    const agents = indexItems([
      scar({ id: "scar.multi.v1", keywords: ["multi-agent"], title: "Fan-out cost blowup" }),
    ]);
    const res = lookup([], agents, { keyword: "multi agent workflow" });
    expect(res.scars.map((s) => s.id)).toEqual(["scar.multi.v1"]);
  });
});

describe("CJK keeps substring containment", () => {
  // Japanese has no spaces, so there are no word boundaries to respect. Applying
  // the Latin rule to CJK would silently stop every Japanese scar from matching.
  const jp = indexItems([
    scar({ id: "scar.jp.v1", keywords: ["独り言"], title: "AI が独り言を言う" }),
  ]);

  it("matches a CJK keyword inside an unsegmented CJK query", () => {
    const res = lookup([], jp, { keyword: "discord bot の独り言問題" });
    expect(res.scars.map((s) => s.id)).toEqual(["scar.jp.v1"]);
  });
});

describe("mixed-script queries", () => {
  // A CJK query still needs substring containment: Japanese runs Latin words
  // flush against kana with no space to split on ("dockerをインストール"). But
  // that exemption used to be keyed on the QUERY, so it handed every Latin
  // keyword back its substring behaviour — "expo" fired inside "export" for
  // anyone querying in Japanese, long after the Latin rule had fixed it.
  const scars = indexItems([
    scar({ id: "scar.expo.v1", keywords: ["expo"], title: "Expo install mismatch", severity: "critical" }),
    scar({ id: "scar.queue.v1", keywords: ["queue"], title: "Job queue ordering" }),
  ]);
  const skills = indexItems([
    skill({ id: "community.docker.v1", keywords: ["docker"] }),
    skill({ id: "community.redis.v1", keywords: ["redis"] }),
    skill({ id: "community.s3.v1", keywords: ["s3"] }),
  ]);

  it.each([
    ["export を使う", "expo"],
    ["bash の source .env が export されない", "expo"],
    ["enqueue の順序が壊れる", "queue"],
  ])("query %j does not fire the keyword %j buried in a longer Latin word", (query) => {
    const res = lookup([], scars, { keyword: query });
    expect(res.scars).toEqual([]);
    expect(res.scar_count).toBe(0);
  });

  it.each([
    ["dockerをインストールする", "community.docker.v1"],
    ["redisに接続できない", "community.redis.v1"],
    ["s3へアップロード", "community.s3.v1"],
  ])("query %j still fires a Latin keyword sitting flush against CJK", (query, id) => {
    const res = lookup(skills, [], { keyword: query });
    expect(res.skills.map((s) => s.id)).toContain(id);
  });
});

describe("index internals stay off the wire", () => {
  it("strips _kwPhrases and friends from returned scars and skills", () => {
    const res = lookup(
      indexItems([skill({ keywords: ["deploy vercel"] })]),
      indexItems([scar({ keywords: ["deploy vercel"] })]),
      { keyword: "deploy vercel" }
    );

    const json = JSON.stringify(res);
    for (const internal of ["_keywordsLower", "_contextsLower", "_kwPhrases", "_kwTokens", "_simTokens"]) {
      expect(json).not.toContain(internal);
    }
    // The scar body is still whole — mistake + instead ARE the payload.
    expect(res.scars[0]).toMatchObject({ mistake: "x", instead: "x" });
  });
});
