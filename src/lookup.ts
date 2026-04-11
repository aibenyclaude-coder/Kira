import type {
  Skill,
  Scar,
  LookupRequest,
  LookupResponse,
} from "./types.js";

/**
 * Shared keyword × context matching logic.
 * Used for both Skills and Scars — same firing rules.
 */
function matchByKeywordAndContext<T extends { keywords: string[]; contexts: string[] }>(
  items: T[],
  keyword: string,
  contexts: string[]
): T[] {
  const normalizedKeyword = keyword.toLowerCase().trim();
  const normalizedContexts = contexts.map((c) => c.toLowerCase().trim());

  return items
    .filter((item) =>
      item.keywords.some((k) => k.toLowerCase() === normalizedKeyword)
    )
    .filter((item) => {
      if (normalizedContexts.length === 0) return true;
      if (item.contexts.length === 0) return true;
      return item.contexts.some((c) =>
        normalizedContexts.includes(c.toLowerCase())
      );
    });
}

/**
 * Lookup returns BOTH skills (how to do it) and scars (what to avoid).
 *
 * Skills: community first, then vendor (§3.3).
 * Scars: critical first, then warning. Higher hit_count = more agents burned.
 */
export function lookup(
  allSkills: Skill[],
  allScars: Scar[],
  request: LookupRequest
): LookupResponse {
  const keyword = request.keyword;
  const contexts = request.context ?? [];

  // ── Skills ───────────────────────────────────────────────────────────
  const matchedSkills = matchByKeywordAndContext(allSkills, keyword, contexts);
  const community = matchedSkills.filter((s) => s.source === "community");
  const vendor = matchedSkills.filter((s) => s.source === "vendor");
  const sortedSkills = [...community, ...vendor];

  // ── Scars ────────────────────────────────────────────────────────────
  const matchedScars = matchByKeywordAndContext(allScars, keyword, contexts);
  // Critical scars first, then by hit_count descending (more burns = higher priority).
  const sortedScars = matchedScars.sort((a, b) => {
    if (a.severity !== b.severity) {
      return a.severity === "critical" ? -1 : 1;
    }
    return b.hit_count - a.hit_count;
  });

  return {
    skills: sortedSkills,
    scars: sortedScars,
    skill_count: sortedSkills.length,
    scar_count: sortedScars.length,
  };
}
