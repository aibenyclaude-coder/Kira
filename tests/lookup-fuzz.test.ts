import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { lookup, indexItems } from "../src/lookup.ts";
import type { Skill, Scar, SkillSource, ScarSeverity } from "../src/types.ts";

// ── Load the real corpus straight from disk ──────────────────────────────
// Property tests run against the shipped skills/scars so the invariants hold
// for the data agents actually receive, not just synthetic fixtures.
const HERE = dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = join(HERE, "..", "skills");

function loadDir<T>(dir: string): T[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf-8")) as T);
}

const realSkills = indexItems(loadDir<Skill>(join(SKILLS_DIR, "community")));
const realScars = indexItems(loadDir<Scar>(join(SKILLS_DIR, "scars")));

// ── Synthetic item factories (for ordering/tier invariants) ──────────────
function makeSkill(
  i: number,
  source: SkillSource,
  keywords: string[] = ["shared"],
  contexts: string[] = []
): Skill {
  return {
    id: `skill.${i}`,
    keywords,
    contexts,
    title: `Synthetic skill ${i}`,
    summary: "synthetic",
    source,
    ...(source === "vendor" ? { vendor: "acme" } : {}),
    declaration: "synthetic declaration",
    instructions: "## synthetic\n\nstep 1",
    version: "1.0.0",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

function makeScar(
  i: number,
  severity: ScarSeverity,
  hit_count: number,
  keywords: string[] = ["shared"],
  contexts: string[] = []
): Scar {
  return {
    id: `scar.${i}`,
    keywords,
    contexts,
    title: `Synthetic scar ${i}`,
    summary: "synthetic",
    severity,
    mistake: "synthetic mistake",
    instead: "synthetic instead",
    hit_count,
    version: "1.0.0",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

// ── Fuzz inputs ──────────────────────────────────────────────────────────
// Bias the vocabulary toward real keyword tokens so the word-overlap and
// containment tiers actually get exercised, mixed with arbitrary strings.
const VOCAB = [
  "deploy", "vercel", "auth", "setup", "nextjs", "add", "database",
  "prisma", "stripe", "docker", "test", "clerk", "foo", "bar", "zzz",
];
const phraseArb = fc
  .array(fc.constantFrom(...VOCAB), { minLength: 0, maxLength: 5 })
  .map((words) => words.join(" "));
const keywordArb = fc.oneof(
  phraseArb,
  fc.string(),
  fc.constantFrom("", " ", "  \t  ")
);
const contextArb = fc.array(
  fc.constantFrom("nextjs", "react", "typescript", "python", "nodejs", "__none__"),
  { maxLength: 3 }
);

describe("kira_lookup matcher — property-based fuzz", () => {
  it("loads a non-empty corpus where every item has keywords (fixture sanity)", () => {
    expect(realSkills.length).toBeGreaterThan(0);
    expect(realScars.length).toBeGreaterThan(0);
    for (const s of realSkills) expect(s.keywords.length).toBeGreaterThan(0);
    for (const s of realScars) expect(s.keywords.length).toBeGreaterThan(0);
  });

  it("never throws for arbitrary keyword and context", () => {
    fc.assert(
      fc.property(keywordArb, contextArb, (keyword, context) => {
        expect(() =>
          lookup(realSkills, realScars, { keyword, context })
        ).not.toThrow();
      })
    );
  });

  it("keeps skill_count and scar_count equal to the array lengths", () => {
    fc.assert(
      fc.property(keywordArb, contextArb, (keyword, context) => {
        const res = lookup(realSkills, realScars, { keyword, context });
        expect(res.skill_count).toBe(res.skills.length);
        expect(res.scar_count).toBe(res.scars.length);
      })
    );
  });

  it("only ever returns items that exist in the corpus", () => {
    const skillIds = new Set(realSkills.map((s) => s.id));
    const scarIds = new Set(realScars.map((s) => s.id));
    fc.assert(
      fc.property(keywordArb, contextArb, (keyword, context) => {
        const res = lookup(realSkills, realScars, { keyword, context });
        for (const s of res.skills) expect(skillIds.has(s.id)).toBe(true);
        for (const s of res.scars) expect(scarIds.has(s.id)).toBe(true);
      })
    );
  });

  it("never leaks internal fields in skill summaries", () => {
    fc.assert(
      fc.property(keywordArb, contextArb, (keyword, context) => {
        const res = lookup(realSkills, realScars, { keyword, context });
        for (const s of res.skills) {
          expect(s).not.toHaveProperty("instructions");
          expect(s).not.toHaveProperty("_keywordsLower");
          expect(s).not.toHaveProperty("_contextsLower");
        }
      })
    );
  });

  it("is deterministic — identical inputs produce deep-equal output", () => {
    fc.assert(
      fc.property(keywordArb, contextArb, (keyword, context) => {
        const a = lookup(realSkills, realScars, { keyword, context });
        const b = lookup(realSkills, realScars, { keyword, context });
        expect(a).toEqual(b);
      })
    );
  });

  it("surfaces suggestions exactly when there are zero matches", () => {
    fc.assert(
      fc.property(keywordArb, contextArb, (keyword, context) => {
        const res = lookup(realSkills, realScars, { keyword, context });
        const empty = res.skill_count === 0 && res.scar_count === 0;
        expect(res.suggestions !== undefined).toBe(empty);
        if (res.suggestions) {
          expect(res.suggestions.length).toBeGreaterThanOrEqual(1);
          expect(res.suggestions.length).toBeLessThanOrEqual(3);
        }
      })
    );
  });

  it("always matches an exact keyword regardless of case or padding", () => {
    fc.assert(
      fc.property(
        fc.nat(),
        fc.nat(),
        fc.constantFrom("plain", "upper", "pad"),
        (si, ki, mode) => {
          const skill = realSkills[si % realSkills.length]!;
          const kw = skill.keywords[ki % skill.keywords.length]!;
          let query = kw;
          if (mode === "upper") query = kw.toUpperCase();
          if (mode === "pad") query = `   ${kw}   `;
          const res = lookup(realSkills, realScars, { keyword: query, context: [] });
          expect(res.skills.map((s) => s.id)).toContain(skill.id);
        }
      )
    );
  });

  it("filters out a skill whose contexts don't overlap the requested context", () => {
    fc.assert(
      fc.property(fc.nat(), fc.nat(), (si, ki) => {
        const skill = realSkills[si % realSkills.length]!;
        // Property only holds for items that declare contexts (real corpus does).
        if (skill.contexts.length === 0) return;
        const kw = skill.keywords[ki % skill.keywords.length]!;
        const res = lookup(realSkills, realScars, {
          keyword: kw,
          context: ["__no_such_context__"],
        });
        expect(res.skills.map((s) => s.id)).not.toContain(skill.id);
      })
    );
  });

  it("orders matched skills community-first, then vendor", () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom<SkillSource>("community", "vendor"), {
          minLength: 1,
          maxLength: 8,
        }),
        (sources) => {
          const skills = indexItems(sources.map((src, i) => makeSkill(i, src)));
          const res = lookup(skills, [], { keyword: "shared", context: [] });
          // Every synthetic skill shares the exact keyword → all are returned.
          expect(res.skills.length).toBe(sources.length);
          const returned = res.skills.map((s) => s.source);
          const firstVendor = returned.indexOf("vendor");
          const lastCommunity = returned.lastIndexOf("community");
          if (firstVendor !== -1 && lastCommunity !== -1) {
            expect(lastCommunity).toBeLessThan(firstVendor);
          }
        }
      )
    );
  });

  it("orders matched scars critical-first, then by descending hit_count", () => {
    const rank = (s: ScarSeverity) => (s === "critical" ? 0 : 1);
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            severity: fc.constantFrom<ScarSeverity>("critical", "warning"),
            hit_count: fc.integer({ min: 0, max: 1000 }),
          }),
          { minLength: 1, maxLength: 10 }
        ),
        (specs) => {
          const scars = indexItems(
            specs.map((sp, i) => makeScar(i, sp.severity, sp.hit_count))
          );
          const res = lookup([], scars, { keyword: "shared", context: [] });
          expect(res.scars.length).toBe(specs.length);
          for (let i = 1; i < res.scars.length; i++) {
            const prev = res.scars[i - 1]!;
            const cur = res.scars[i]!;
            expect(rank(prev.severity)).toBeLessThanOrEqual(rank(cur.severity));
            if (prev.severity === cur.severity) {
              expect(prev.hit_count).toBeGreaterThanOrEqual(cur.hit_count);
            }
          }
        }
      )
    );
  });

  it("matches via substring containment (tier 2)", () => {
    const skills = indexItems([makeSkill(0, "community", ["deploy vercel"])]);
    fc.assert(
      fc.property(
        fc.constantFrom(
          "deploy vercel",
          "i want to deploy vercel app",
          "please deploy vercel now",
        ),
        (query) => {
          const res = lookup(skills, [], { keyword: query, context: [] });
          expect(res.skills.map((s) => s.id)).toContain("skill.0");
        }
      )
    );
  });

  it("matches via 2+ word overlap but not a single overlap (tier 3)", () => {
    const skills = indexItems([makeSkill(0, "community", ["deploy vercel app"])]);
    // 'deploy' + 'app' overlap, reordered so neither string contains the other.
    const hit = lookup(skills, [], { keyword: "app zzz deploy", context: [] });
    expect(hit.skills.map((s) => s.id)).toContain("skill.0");
    // Only 'deploy' overlaps → below the 2-word threshold.
    const miss = lookup(skills, [], { keyword: "deploy zzz qqq", context: [] });
    expect(miss.skills.map((s) => s.id)).not.toContain("skill.0");
  });

  it("does not count filler words toward the overlap threshold", () => {
    const skills = indexItems([makeSkill(0, "community", ["foo bar"])]);
    // 'foo' is the only meaningful overlap; 'the/a/to' are filler → no match.
    const res = lookup(skills, [], { keyword: "foo the a to", context: [] });
    expect(res.skills.map((s) => s.id)).not.toContain("skill.0");
  });

  it("returns nothing — not the whole corpus — for an empty keyword", () => {
    // This used to assert the opposite: the empty string is a substring of every
    // keyword, so the old tier 2 matched EVERY item and an empty/malformed call
    // dumped all 77 items (~118KB, scar bodies and all) into the agent's context.
    // That was an accident of substring matching, not a feature. Word-boundary
    // matching has no words to match on, so the caller gets the recovery
    // suggestion instead of a token bomb.
    const res = lookup(realSkills, realScars, { keyword: "", context: [] });
    expect(res.skill_count).toBe(0);
    expect(res.scar_count).toBe(0);
    expect(res.suggestions).toBeDefined();
  });
});
