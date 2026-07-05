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
  it("keeps strict-hit responses unchanged (no near fields)", () => {
    const res = lookup(skills, scars, { keyword: "deploy vercel" });
    expect(res.skill_count).toBeGreaterThan(0);
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
