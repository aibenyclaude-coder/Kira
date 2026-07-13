import { describe, expect, it } from "vitest";
import { indexItems, lookup } from "../src/lookup.js";
import type { Scar, Skill } from "../src/types.js";

function mkSkill(over: Partial<Skill>): Skill {
  return {
    id: "community.test.v1",
    keywords: ["test keyword"],
    contexts: [],
    title: "Test skill",
    summary: "A test skill.",
    source: "community",
    declaration: "d",
    instructions: "i",
    version: "1.0.0",
    updated_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

function mkScar(over: Partial<Scar>): Scar {
  return {
    id: "scar.test.v1",
    keywords: ["test scar"],
    contexts: [],
    title: "Test scar",
    summary: "A test scar.",
    severity: "warning",
    mistake: "m",
    instead: "n",
    hit_count: 1,
    version: "1.0.0",
    updated_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

const skills = indexItems([
  mkSkill({
    id: "community.deploy-vercel.v1",
    keywords: ["deploy vercel", "vercel deploy"],
    title: "Deploy a Next.js project to Vercel",
    summary: "Vercel deployment flow.",
  }),
]);
const scars = indexItems([
  mkScar({
    id: "scar.vercel-env.v1",
    keywords: ["vercel env", "environment variables"],
    title: "Vercel deploy fails from missing env vars",
    summary: "Deploy failed because env vars were not set on Vercel.",
  }),
]);

describe("lookup near-match (additive on 0-hit)", () => {
  it("keeps fully strict-hit responses unchanged (no near fields)", () => {
    // Both a skill AND a scar match lexically — nothing is missing, so nothing
    // is inferred.
    const strictScars = indexItems([
      mkScar({ id: "scar.vercel-deploy.v1", keywords: ["deploy vercel"] }),
    ]);
    const res = lookup(skills, strictScars, { keyword: "deploy vercel" });
    expect(res.skill_count).toBeGreaterThan(0);
    expect(res.scar_count).toBeGreaterThan(0);
    expect(res.near_skills).toBeUndefined();
    expect(res.near_scars).toBeUndefined();
    expect(res.suggestions).toBeUndefined();
  });

  it("adds scored near matches on 0-hit and derives suggestions from them", () => {
    // No strict tier matches ("deployment broken production" shares no exact
    // keyword, no substring, <2 word overlap) — but tokens overlap via alias.
    const res = lookup(skills, scars, { keyword: "deployment broken production" });
    expect(res.skill_count).toBe(0);
    expect(res.scar_count).toBe(0);
    expect(res.near_skills?.length).toBeGreaterThan(0);
    expect(res.near_skills![0]!.id).toBe("community.deploy-vercel.v1");
    expect(res.near_skills![0]!.score).toBeGreaterThan(0);
    expect(res.suggestions).toContain("Deploy a Next.js project to Vercel");
  });

  it("never leaks internal index fields through JSON serialization", () => {
    const strict = JSON.stringify(lookup(skills, scars, { keyword: "deploy vercel" }));
    const near = JSON.stringify(lookup(skills, scars, { keyword: "deployment broken production" }));
    for (const blob of [strict, near]) {
      expect(blob).not.toContain("_simTokens");
      expect(blob).not.toContain("_kwTokens");
      expect(blob).not.toContain("_keywordsLower");
    }
  });

  it("falls back to the generic message when nothing is near", () => {
    const res = lookup(skills, scars, { keyword: "quantum blockchain yodeling" });
    expect(res.near_skills).toBeUndefined();
    expect(res.suggestions?.[0]).toContain("No matching skills found");
  });
});

describe("lookup advisory near-scars (skill hit, zero scars)", () => {
  it("surfaces a strong near-scar even though a skill matched outright", () => {
    // The scar's keywords ("vercel env") clear none of the three lexical tiers
    // against "deploy vercel", so scar_count is 0 — yet it is the exact warning
    // this lookup exists to deliver. Before, a skill hit suppressed it entirely.
    const res = lookup(skills, scars, { keyword: "deploy vercel" });
    expect(res.skill_count).toBeGreaterThan(0);
    expect(res.scar_count).toBe(0);
    expect(res.near_scars?.map((n) => n.id)).toContain("scar.vercel-env.v1");
  });

  it("does not infer skills on this path — only the missing half is filled in", () => {
    const res = lookup(skills, scars, { keyword: "deploy vercel" });
    expect(res.near_skills).toBeUndefined();
    expect(res.suggestions).toBeUndefined();
  });

  it("holds a higher bar than the 0-hit recovery path", () => {
    // A one-word query scores 0.50 off a single incidental token — over the
    // recovery path's 0.30, so only the two-token floor rejects it. A response
    // that already carries a skill must not spend the agent's attention on one
    // word colliding in a title.
    const shipSkill = indexItems([
      mkSkill({ id: "community.ship.v1", keywords: ["ship"], title: "Ship a build" }),
    ]);
    const cacheScar = indexItems([
      mkScar({
        id: "scar.stale-cache.v1",
        keywords: ["cache invalidation"],
        title: "Ship blocked by a stale cache",
      }),
    ]);
    const res = lookup(shipSkill, cacheScar, { keyword: "ship" });
    expect(res.skill_count).toBeGreaterThan(0);
    expect(res.scar_count).toBe(0);
    expect(res.near_scars).toBeUndefined();
  });

  it("stays silent when a scar did match lexically", () => {
    const res = lookup(skills, scars, { keyword: "vercel env" });
    expect(res.scar_count).toBeGreaterThan(0);
    expect(res.near_scars).toBeUndefined();
  });
});
