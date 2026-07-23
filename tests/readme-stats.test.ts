/**
 * README corpus counts are a shipped surface, not decoration: README.md is
 * listed in package.json `files`, so its prose IS the npmjs.com package page.
 *
 * Those numbers were hand-maintained and rotted at every release — v0.8.2
 * advertised "34 community skills and 12 community scars" while that same
 * tarball shipped 38 skills and 27 scars. scripts/gen-stats.mjs now owns them;
 * these tests keep that ownership honest.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error — plain .mjs module without type declarations
import { syncReadme, stats } from "../scripts/gen-stats.mjs";

const ROOT = join(__dirname, "..");
const readme = readFileSync(join(ROOT, "README.md"), "utf-8");

describe("README corpus counts", () => {
  it("are in sync with the corpus on disk", () => {
    const { text, problems } = syncReadme(readme, stats);
    expect(problems).toEqual([]);
    // Any diff here means README.md quotes a stale number.
    expect(text).toBe(readme);
  });

  it("quote the real counts verbatim", () => {
    expect(readme).toContain(`${stats.community_skills} community skills across`);
    expect(readme).toContain(`${stats.community_scars} community scars — real failure patterns`);
  });
});

describe("syncReadme", () => {
  it("rewrites a stale count", () => {
    const stale = readme.replace(
      `${stats.community_scars} community scars — real failure patterns`,
      `999 community scars — real failure patterns`,
    );
    const { text, problems } = syncReadme(stale, stats);
    expect(problems).toEqual([]);
    expect(text).toBe(readme);
  });

  it("never rewrites the grace-mode threshold, which is a policy constant", () => {
    // "until the corpus reaches 100 community scars" must survive verbatim,
    // otherwise the gate would silently restate the reciprocity policy.
    expect(readme).toContain("100 community scars");
    const { text } = syncReadme(readme, { ...stats, community_scars: 43210 });
    expect(text).toContain("100 community scars");
    expect(text).toContain("43210 community scars — real failure patterns");
  });

  it("fails closed when the prose is reworded instead of silently skipping", () => {
    const reworded = readme.replace(
      `${stats.community_scars} community scars — real failure patterns`,
      `${stats.community_scars} community scars, i.e. real failure patterns`,
    );
    const { text, problems } = syncReadme(reworded, stats);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("community_scars");
    // The unmatched rule must not be applied at all.
    expect(text).toBe(reworded);
  });
});
