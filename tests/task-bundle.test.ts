import { describe, it, expect } from "vitest";
import { lookup, indexItems, matchTasks } from "../src/lookup.js";
import { loadAllSkills, loadAllScars } from "../src/index-loader.js";
import type { Scar } from "../src/types.js";

/**
 * Keyword matching answers "what did you type". It cannot answer "what are you
 * about to do", because the word for an activity ("release") is almost never a
 * word in the failures that fire during it ("404 means dead auth", "server.json
 * version drift"). Measured on the shipped corpus before task tags existed:
 * "release" returned 1 of the 5 scars that actually fire during a release, and
 * "code review" returned 0 of 3. The knowledge was present and unreachable by
 * the only name the caller knows at that moment.
 *
 * These cases are the real thing: every id below is a scar that was genuinely
 * needed while doing that task on this repo.
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

describe("matchTasks", () => {
  it("recognises an activity by name", () => {
    expect(matchTasks("release")).toContain("release");
    expect(matchTasks("cut a release")).toContain("release");
    expect(matchTasks("code review")).toContain("code-review");
  });

  it("recognises the Japanese name (no word boundaries to lean on)", () => {
    expect(matchTasks("リリースする")).toContain("release");
    expect(matchTasks("デプロイ前の確認")).toContain("deploy");
    expect(matchTasks("移行の手順")).toContain("data-migration");
  });

  it("does not fire on a word that merely spells the task", () => {
    // "testsrc" and "latest" contain "test"; neither is a request to run tests.
    expect(matchTasks("ffmpeg testsrc frame diff")).not.toContain("test");
    expect(matchTasks("npx kira-mcp@latest")).not.toContain("test");
  });

  it("returns nothing for a query that names no activity", () => {
    expect(matchTasks("supabase row level security").size).toBe(0);
    expect(matchTasks("").size).toBe(0);
  });
});

describe("task bundle in lookup", () => {
  it("is APPENDED, never interleaved — the old result stays a prefix", () => {
    // A direct keyword hit must outrank a bundle item even when the bundle item
    // is more severe. Anything that re-sorts and truncates (kira_premortem)
    // would otherwise drop the keyword hit it was asked for.
    const scars = indexItems([
      scar({ id: "scar.keyword-hit.v1", keywords: ["widget"], severity: "warning" }),
      scar({ id: "scar.bundle-item.v1", tasks: ["release"], severity: "critical" }),
    ]);
    const r = lookup([], scars, { keyword: "widget release" });
    expect(r.scars.map((s) => s.id)).toEqual(["scar.keyword-hit.v1", "scar.bundle-item.v1"]);
  });

  it("can be switched off by a caller that truncates", () => {
    const scars = indexItems([scar({ id: "scar.bundle-item.v1", tasks: ["release"] })]);
    expect(lookup([], scars, { keyword: "release" }).scars).toHaveLength(1);
    expect(lookup([], scars, { keyword: "release", tasks: false }).scars).toHaveLength(0);
  });

  it("does not duplicate an item that keyword matching already returned", () => {
    const scars = indexItems([
      scar({ id: "scar.both.v1", keywords: ["release"], tasks: ["release"] }),
    ]);
    expect(lookup([], scars, { keyword: "release" }).scars.map((s) => s.id)).toEqual([
      "scar.both.v1",
    ]);
  });
});

describe("shipped corpus answers the task name (regression: was 5/17)", () => {
  // Ground truth: scars actually needed while performing each task on this repo.
  const CASES: Record<string, string[]> = {
    release: [
      "parallel-rails-same-trigger-race",
      "npm-publish-404-means-auth",
      "credential-ci-jobs-need-three-gates",
      "new-asset-dir-missing-from-ship-manifest",
    ],
    "code review": [
      "test-asserts-the-bug",
      "threshold-tuned-to-one-example",
      "lead-names-a-branch-no-input-reaches",
    ],
    debug: [
      "fixture-not-representative-of-real-output",
      "health-check-gated-on-unverified-command",
      "dns-cutover-stale-local-resolver-misdiagnosis",
    ],
    deploy: [
      "cloudflare-pages-soft-404-without-404-html",
      "dns-cutover-stale-local-resolver-misdiagnosis",
      "credential-ci-jobs-need-three-gates",
    ],
    automation: [
      "scheduled-automation-needs-layer-inventory",
      "gh-table-output-parsed-by-column",
      "git-push-delete-multi-ref-partial-success",
    ],
  };

  for (const [task, want] of Object.entries(CASES)) {
    it(`"${task}" returns every scar that fires during it`, async () => {
      const skills = indexItems(await loadAllSkills());
      const scars = indexItems(await loadAllScars());
      const got = lookup(skills, scars, { keyword: task }).scars.map((s) => s.id);
      for (const w of want) {
        expect(got.some((g) => g.includes(w)), `${task} → ${w}`).toBe(true);
      }
    });
  }
});
