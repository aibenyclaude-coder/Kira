import type {
  Skill,
  Scar,
  LookupRequest,
  LookupResponse,
} from "./types.js";

// Module-level constants — allocated once, not per-lookup.
const FILLER = new Set([
  "i", "a", "to", "my", "the", "an", "is", "it", "do",
  "want", "need", "please", "can", "how", "with", "for", "in", "on", "of",
]);
const MIN_WORD_OVERLAP = 2;

/** Pre-computed lowercase keywords for a skill/scar item. */
interface Indexed {
  _keywordsLower: string[];
  _contextsLower: string[];
}

/**
 * One-time indexing: lowercase keywords and contexts at load time
 * so we don't repeat it on every lookup call.
 */
export function indexItems<T extends { keywords: string[]; contexts: string[] }>(
  items: T[]
): (T & Indexed)[] {
  return items.map((item) => ({
    ...item,
    _keywordsLower: item.keywords.map((k) => k.toLowerCase()),
    _contextsLower: item.contexts.map((c) => c.toLowerCase()),
  }));
}

/**
 * Match keyword with three tiers:
 *   1. Exact match: "deploy vercel" === "deploy vercel"
 *   2. Contains match: "deploy vercel" found inside "I want to deploy vercel app"
 *   3. Word overlap: 2+ meaningful words match (e.g., "add auth" matches "add auth clerk")
 *
 * Returns matches in priority order: exact first, then contains, then word overlap.
 * Deduplicates across tiers.
 */
function matchByKeywordAndContext<T extends Indexed>(
  items: T[],
  keyword: string,
  contexts: string[]
): T[] {
  const normalizedKeyword = keyword.toLowerCase().trim();
  const normalizedContexts = new Set(contexts.map((c) => c.toLowerCase().trim()));
  const queryWords = normalizedKeyword.split(/\s+/);

  const exact: T[] = [];
  const contains: T[] = [];
  const wordOverlap: T[] = [];
  const seen = new Set<number>();

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;

    // Context filter first (cheap — Set.has is O(1)).
    if (normalizedContexts.size > 0 && item._contextsLower.length > 0) {
      if (!item._contextsLower.some((c) => normalizedContexts.has(c))) {
        continue;
      }
    }

    const itemKeywords = item._keywordsLower;

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

    // Tier 3: Word overlap — at least MIN_WORD_OVERLAP meaningful words must match.
    if (
      itemKeywords.some((k) => {
        const kWords = k.split(/\s+/);
        const meaningfulMatches = queryWords.filter(
          (qw) => !FILLER.has(qw) && kWords.includes(qw)
        );
        return meaningfulMatches.length >= MIN_WORD_OVERLAP;
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
  allSkills: (Skill & Indexed)[],
  allScars: (Scar & Indexed)[],
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

  // When 0 results, suggest closest available skills by single-word overlap
  let suggestions: string[] | undefined;
  if (sortedSkills.length === 0 && sortedScars.length === 0) {
    const queryWords = keyword.toLowerCase().split(/\s+/);
    const scored = allSkills.map((s) => {
      const overlap = queryWords.filter((q) =>
        s._keywordsLower.some((k) => k.split(/\s+/).includes(q))
      ).length;
      return { title: s.title, overlap };
    });
    suggestions = scored
      .filter((s) => s.overlap > 0)
      .sort((a, b) => b.overlap - a.overlap)
      .slice(0, 3)
      .map((s) => s.title);
    if (suggestions.length === 0) {
      suggestions = ["No matching skills found. Try broader keywords like 'deploy', 'auth', 'database', 'testing'."];
    }
  }

  return {
    skills: sortedSkills,
    scars: sortedScars,
    skill_count: sortedSkills.length,
    scar_count: sortedScars.length,
    ...(suggestions ? { suggestions } : {}),
  };
}
