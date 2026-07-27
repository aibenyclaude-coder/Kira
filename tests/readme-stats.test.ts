/**
 * Corpus counts quoted in prose are a public surface, not decoration.
 *
 * README.md is listed in package.json `files`, so its prose IS the npmjs.com
 * package page — those numbers were hand-maintained and rotted at every
 * release: v0.8.2 advertised "34 community skills and 12 community scars"
 * while that same tarball shipped 38 skills and 27 scars.
 *
 * docs/launch/objections.md never ships, but it is the prepared reply to
 * "this corpus is tiny / seeded" — the one answer whose entire force is that
 * our numbers are honest. It drifted to "21 scars" against a corpus of 43.
 *
 * scripts/gen-stats.mjs now owns both; these tests keep that ownership honest.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error — plain .mjs module without type declarations
import { syncProse, PROSE_RULES, stats } from "../scripts/gen-stats.mjs";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf-8");
const readme = read("README.md");
const objections = read("docs/launch/objections.md");

describe("gated prose corpus counts", () => {
  it("gates both README.md and the launch objections script", () => {
    // A file silently dropped from this table stops being gated while every
    // other test here keeps passing.
    expect(Object.keys(PROSE_RULES).sort()).toEqual([
      "README.md",
      "docs/launch/objections.md",
    ]);
  });

  for (const rel of Object.keys(PROSE_RULES)) {
    it(`${rel} is in sync with the corpus on disk`, () => {
      const text = read(rel);
      const result = syncProse(rel, text, stats);
      expect(result.problems).toEqual([]);
      // Any diff here means the file quotes a stale number.
      expect(result.text).toBe(text);
    });
  }

  it("README.md quotes the real counts verbatim", () => {
    expect(readme).toContain(`${stats.community_skills} community skills across`);
    expect(readme).toContain(`${stats.community_scars} community scars — real failure patterns`);
  });

  it("objections.md quotes the real counts verbatim", () => {
    expect(objections).toContain(
      `${stats.community_skills} skills / ${stats.community_scars} scars, and every scar was actually hit`,
    );
  });
});

describe("syncProse", () => {
  it("rewrites a stale README count", () => {
    const stale = readme.replace(
      `${stats.community_scars} community scars — real failure patterns`,
      `999 community scars — real failure patterns`,
    );
    const { text, problems } = syncProse("README.md", stale, stats);
    expect(problems).toEqual([]);
    expect(text).toBe(readme);
  });

  it("rewrites a stale objections count — the drift that was actually shipped", () => {
    const stale = objections.replace(
      `${stats.community_scars} scars, and every scar was actually hit`,
      `21 scars, and every scar was actually hit`,
    );
    expect(stale).not.toBe(objections);
    const { text, problems } = syncProse("docs/launch/objections.md", stale, stats);
    expect(problems).toEqual([]);
    expect(text).toBe(objections);
  });

  it("never rewrites the grace-mode threshold, which is a policy constant", () => {
    // "until the corpus reaches 100 community scars" must survive verbatim,
    // otherwise the gate would silently restate the reciprocity policy.
    expect(readme).toContain("100 community scars");
    const { text } = syncProse("README.md", readme, { ...stats, community_scars: 43210 });
    expect(text).toContain("100 community scars");
    expect(text).toContain("43210 community scars — real failure patterns");
  });

  it("fails closed when README prose is reworded instead of silently skipping", () => {
    const reworded = readme.replace(
      `${stats.community_scars} community scars — real failure patterns`,
      `${stats.community_scars} community scars, i.e. real failure patterns`,
    );
    const { text, problems } = syncProse("README.md", reworded, stats);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("community_scars");
    // The unmatched rule must not be applied at all.
    expect(text).toBe(reworded);
  });

  it("fails closed when objections prose is reworded", () => {
    const reworded = objections.replace(
      `${stats.community_scars} scars, and every scar was actually hit`,
      `${stats.community_scars} scars — and every scar was actually hit`,
    );
    const { text, problems } = syncProse("docs/launch/objections.md", reworded, stats);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("docs/launch/objections.md");
    expect(text).toBe(reworded);
  });

  it("refuses an ungated file rather than reporting it in sync", () => {
    // Returning {problems: []} for an unknown path would make "not gated"
    // indistinguishable from "gated and fresh".
    expect(() => syncProse("CHANGELOG.md", "12 scars", stats)).toThrow(/PROSE_RULES/);
  });
});
