import type {
  Skill,
  Scar,
  LookupRequest,
  LookupResponse,
} from "./types.js";

/**
 * Match keyword with three tiers:
 *   1. Exact match: "deploy vercel" === "deploy vercel"
 *   2. Contains match: "deploy vercel" found inside "I want to deploy vercel app"
 *   3. Word overlap: "deploy" matches "deploy vercel" (any word in the keyword appears in a skill keyword)
 *
 * Returns matches in priority order: exact first, then contains, then word overlap.
 * Deduplicates across tiers.
 */
function matchByKeywordAndContext<T extends { keywords: string[]; contexts: string[] }>(
  items: T[],
  keyword: string,
  contexts: string[]
): T[] {
  const normalizedKeyword = keyword.toLowerCase().trim();
  const normalizedContexts = contexts.map((c) => c.toLowerCase().trim());
  const queryWords = normalizedKeyword.split(/\s+/);

  const exact: T[] = [];
  const contains: T[] = [];
  const wordOverlap: T[] = [];
  const seen = new Set<number>();

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;

    // Context filter first (cheap).
    if (normalizedContexts.length > 0 && item.contexts.length > 0) {
      if (!item.contexts.some((c) => normalizedContexts.includes(c.toLowerCase()))) {
        continue;
      }
    }

    const itemKeywords = item.keywords.map((k) => k.toLowerCase());

    // Tier 1: Exact match
    if (itemKeywords.some((k) => k === normalizedKeyword)) {
      exact.push(item);
      seen.add(i);
      continue;
    }

    // Tier 2: Query contains a skill keyword, or skill keyword contains query
    if (
      itemKeywords.some(
        (k) => normalizedKeyword.includes(k) || k.includes(normalizedKeyword)
      )
    ) {
      contains.push(item);
      seen.add(i);
      continue;
    }

    // Tier 3: Word overlap — at least 1 meaningful word matches.
    // Skip common filler words to avoid false positives.
    const FILLER = new Set(["i", "a", "to", "my", "the", "an", "is", "it", "do", "want", "need", "please", "can", "how", "add", "setup", "set", "up", "create", "install", "get", "make", "use", "with", "for", "in", "on", "of", "app", "project"]);
    if (
      itemKeywords.some((k) => {
        const kWords = k.split(/\s+/);
        const meaningfulMatches = queryWords.filter(
          (qw) => !FILLER.has(qw) && kWords.includes(qw)
        );
        return meaningfulMatches.length >= 1;
      })
    ) {
      if (!seen.has(i)) {
        wordOverlap.push(item);
        seen.add(i);
      }
    }
  }

  return [...exact, ...contains, ...wordOverlap];
}

/**
 * Lookup returns BOTH skills (how to do it) and scars (what to avoid).
 *
 * Skills: community first, then vendor.
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
  const sortedScars = [...matchedScars].sort((a, b) => {
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
