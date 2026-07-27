import type {
  Skill,
  Scar,
  SkillSummary,
  ScarSummary,
  LookupRequest,
  LookupResponse,
  NearMatch,
} from "./types.js";
import { tokenize, nearMatches, stem, hasCJK, type SimIndexed } from "./similarity.js";

// Module-level constants — allocated once, not per-lookup.
const FILLER = new Set([
  "i", "a", "to", "my", "the", "an", "is", "it", "do",
  "want", "need", "please", "can", "how", "with", "for", "in", "on", "of",
  "not",
]);
const MIN_WORD_OVERLAP = 2;

/**
 * Bar for the advisory near-scar path (a skill matched, no scar did).
 *
 * The zero-result path is a recovery path — anything beats an empty answer, so
 * it keeps the permissive 0.30 default. The advisory path injects into a
 * response that is NOT empty, where a wrong scar spends the agent's attention,
 * so it demands a real overlap instead. Measured over the 230 keywords the
 * shipping skills advertise: at 0.30/1-token the tail is junk (the query "sign
 * in" tokenizes to the single token "sign" and scores 1.00 against an unrelated
 * scar); at 0.50/2-tokens every emitted match is on-topic — "tag release"
 * surfaces the scar about two release rails racing on one tag.
 */
const ADVISORY_SCAR_THRESHOLD = 0.5;
const ADVISORY_MIN_MATCHED_TOKENS = 2;

/** Strip instructions from a skill to produce a lightweight summary. */
function toSkillSummary(skill: Skill & Indexed): SkillSummary {
  const { instructions: _, ...rest } = skill;
  return stripIndex(rest);
}

/**
 * A scar ships whole — mistake + instead ARE the payload — but its index fields
 * are internal. They used to ride along on every scar in every response:
 * _keywordsLower duplicated keywords verbatim, and the two Set fields serialized
 * to a pair of useless `{}` (JSON.stringify cannot see into a Set).
 */
function toScarSummary(scar: Scar & Indexed): ScarSummary {
  return stripIndex(scar);
}

/** Drop the Indexed bookkeeping so it never reaches the wire. */
function stripIndex<T extends Indexed>(item: T): Omit<T, keyof Indexed> {
  const {
    _keywordsLower: _k,
    _contextsLower: _c,
    _kwPhrases: _p,
    _kwWords: _w,
    _kwTokenWords: _tw,
    _kwTokens: _t,
    _simTokens: _s,
    ...rest
  } = item;
  return rest;
}

/** Pre-computed lowercase keywords + similarity token sets for a skill/scar item. */
export interface Indexed extends SimIndexed {
  _keywordsLower: string[];
  _contextsLower: string[];
  /** Per keyword, its stemmed word sequence — empty for CJK keywords (no word boundaries). */
  _kwPhrases: string[][];
  /** Per keyword, its stemmed word SET — always populated, tier 3 only. */
  _kwWords: Set<string>[];
  /** Per keyword, per whitespace token, its stemmed words — tier 3 only. */
  _kwTokenWords: string[][][];
}

/**
 * Split into an ordered list of stemmed words. Any non-alphanumeric run is a
 * separator, so "cloudflare-pages" is two words — the same split tokenize() uses.
 */
function phraseWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map(stem);
}

/**
 * Split into whitespace tokens, each as its own stemmed word list.
 *
 * `phraseWords` flattens "ERR_FILE_NOT_FOUND" into four words with no record
 * that they came from one identifier; this keeps that grouping.
 */
function tokenWords(text: string): string[][] {
  return text
    .toLowerCase()
    .split(/\s+/)
    .map(phraseWords)
    .filter((w) => w.length > 0);
}

/**
 * The single COMPOUND token every matched word came from, or null.
 *
 * Null covers both honest shapes: the words came from two or more different
 * tokens (independent signals), or the one token they came from is a plain
 * single word (nothing was split, so nothing was over-counted).
 */
function confinedToOneCompound(tokens: string[][], matched: string[]): string[] | null {
  let only: string[] | null = null;
  for (const t of tokens) {
    if (!matched.some((w) => t.includes(w))) continue;
    if (only) return null;
    only = t;
  }
  if (only === null || only.length < 2) return null;
  return matched.every((w) => only!.includes(w)) ? only : null;
}

/**
 * Is this overlap just two halves of one identifier that isn't the same
 * identifier on the other side?
 *
 * Tier 3 counts DISTINCT words, which reads as "two independent things
 * matched". A token that punctuation-splits — `ERR_FILE_NOT_FOUND`,
 * `package.json`, `cloudflare-pages` — is one name, so its pieces are not
 * independent: the query "ERR_FILE_NOT_FOUND" cleared the bar against the
 * keyword "ERR_MODULE_NOT_FOUND tests" on `err` + `found`, the two boilerplate
 * ends of an error code, while differing on the only segment that says which
 * error it is. Confinement to ONE compound token on BOTH sides is what makes
 * that an artifact; the escape hatch is the identifier being the SAME one, so
 * "ERR_MODULE_NOT_FOUND vitest" still reaches that scar, and
 * "package.json version mismatch" still reaches the keyword "nested
 * package.json". Anything matching across two tokens is untouched.
 *
 * Measured over the shipped corpus (81 entries) against 1551 real query
 * strings (the miss log plus every title and keyword in the author's live
 * personal-scar store): 2 matches removed, both the same false positive, and
 * 0 legitimate matches lost — no query lost its last result.
 */
function isCompoundArtifact(
  queryTokens: string[][],
  keywordTokens: string[][],
  matched: string[]
): boolean {
  const q = confinedToOneCompound(queryTokens, matched);
  if (q === null) return false;
  const k = confinedToOneCompound(keywordTokens, matched);
  if (k === null) return false;
  return q.join(" ") !== k.join(" ");
}

/** Does `hay` contain `needle` as a contiguous run of whole words? */
function phraseIn(needle: string[], hay: string[]): boolean {
  if (needle.length === 0 || needle.length > hay.length) return false;
  for (let i = 0; i + needle.length <= hay.length; i++) {
    if (needle.every((w, j) => hay[i + j] === w)) return true;
  }
  return false;
}

/**
 * One-time indexing: lowercase keywords/contexts + similarity token sets at
 * load time so we don't repeat it on every lookup call.
 */
export function indexItems<
  T extends { keywords: string[]; contexts: string[]; title: string; summary: string }
>(items: T[]): (T & Indexed)[] {
  return items.map((item) => ({
    ...item,
    _keywordsLower: item.keywords.map((k) => k.toLowerCase()),
    _contextsLower: item.contexts.map((c) => c.toLowerCase()),
    _kwPhrases: item.keywords.map((k) => (hasCJK(k) ? [] : phraseWords(k))),
    _kwWords: item.keywords.map((k) => new Set(phraseWords(k))),
    _kwTokenWords: item.keywords.map((k) => tokenWords(k)),
    _kwTokens: new Set(item.keywords.flatMap((k) => tokenize(k))),
    _simTokens: new Set(
      [item.title, item.summary, ...item.keywords, ...item.contexts].flatMap((t) =>
        tokenize(t)
      )
    ),
  }));
}

/**
 * Tier-2 containment, at word boundaries.
 *
 * This used to be raw substring containment, which fired an item whenever a
 * query merely SPELLED a keyword inside a longer word. "rm" lives inside
 * "fo(rm) validation", so a CRITICAL scar about `rm` wiping live data led the
 * response for anyone building a form — and critical sorts first, so it was the
 * agent's top "what not to do". Likewise "tail" inside "(tail)wind", "test"
 * inside "vi(test)", "git" inside "(git)hub", "cli" inside "apollo (cli)ent".
 * Measured over the 237 keywords the corpus advertises plus the real miss log:
 * 19 such false positives, 8 of them CRITICAL. No skill lost a single match —
 * every "docker"/"dockerfile"-shaped pair was the same item matching twice.
 *
 * Word-splitting on punctuation also FIXES matches the substring rule missed:
 * "multi agent workflow" now reaches the "multi-agent" scars (the hyphen made
 * `includes` fail), and stemming pairs "rate limiting" with "rate limit".
 *
 * CJK is exempt: it has no word boundaries to respect, so a CJK keyword keeps
 * substring containment — the same assumption the bigram path in similarity.ts
 * makes. Without this carve-out every Japanese scar would stop matching.
 *
 * A CJK QUERY is exempt too, but only halfway. Japanese runs Latin words flush
 * against kana with no space to split on, so "dockerをインストール" has to reach
 * the keyword "docker" by containment. Keying the whole exemption on the query
 * went too far: it handed every Latin keyword its substring behaviour back the
 * moment a query contained one CJK character, so "expo" fired inside "export"
 * and "queue" inside "enqueue" — the exact class the rule above removed, still
 * live for anyone querying in Japanese. Measured over the shipped corpus (79
 * entries) against 69 real CJK queries: 6 spurious matches, one of them a
 * CRITICAL scar (which sorts first), and 0 legitimate matches lost.
 */
function containsAtWordBoundary(
  keywordLower: string,
  keywordPhrase: string[],
  queryLower: string,
  queryPhrase: string[]
): boolean {
  if (keywordPhrase.length === 0) {
    return queryLower.includes(keywordLower) || keywordLower.includes(queryLower);
  }
  if (hasCJK(queryLower)) {
    return (
      containsOutsideLatinWord(queryLower, keywordLower) ||
      containsOutsideLatinWord(keywordLower, queryLower)
    );
  }
  return phraseIn(keywordPhrase, queryPhrase) || phraseIn(queryPhrase, keywordPhrase);
}

/** Latin letters and digits — the characters that make a longer word, not a boundary. */
const LATIN_WORD_CHAR = /[\p{Script=Latin}\p{N}]/u;

/**
 * Substring containment that refuses a hit buried inside a longer Latin word.
 * A CJK character (or punctuation, or either edge) counts as a boundary, so
 * "docker" is found in "dockerをインストール" but "expo" is not in "export".
 */
function containsOutsideLatinWord(hay: string, needle: string): boolean {
  for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + 1)) {
    const before = i > 0 ? hay[i - 1]! : "";
    const after = hay[i + needle.length] ?? "";
    if (!LATIN_WORD_CHAR.test(before) && !LATIN_WORD_CHAR.test(after)) {
      return true;
    }
  }
  return false;
}

/**
 * Match keyword with three tiers:
 *   1. Exact match: "deploy vercel" === "deploy vercel"
 *   2. Contains match: "deploy vercel" found inside "I want to deploy vercel app"
 *   3. Word overlap: 2+ distinct meaningful words match ("add auth" ↔ "add auth clerk")
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
  const queryPhrase = phraseWords(normalizedKeyword);
  const queryTokens = tokenWords(normalizedKeyword);

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

    // Tier 2: Query contains a skill keyword, or skill keyword contains query —
    // at WORD boundaries, so "form validation" no longer matches the keyword "rm".
    if (
      itemKeywords.some((k, ki) =>
        containsAtWordBoundary(
          k,
          item._kwPhrases[ki] ?? [],
          normalizedKeyword,
          queryPhrase
        )
      )
    ) {
      contains.push(item);
      seen.add(i);
      continue;
    }

    /**
     * Tier 3: word overlap — MIN_WORD_OVERLAP meaningful words must match.
     *
     * DISTINCT words. The filter used to be counted by length, so one query
     * word repeated twice cleared a bar that reads as "two words matched":
     * a query mentioning `branch` twice reached every scar whose keywords
     * merely contain "branch" — "branch cleanup", "dead branch", "protected
     * branch" — on a single shared word, which is exactly the sub-threshold
     * overlap the line below the loop exists to reject.
     *
     * Measured over the shipped corpus (81 entries) against 1531 real query
     * strings (the miss log plus every title and keyword in the author's live
     * personal-scar store): 3 queries, 7 matches, 0 of them sharing a second
     * word with the item they matched — and 2 of the 7 CRITICAL, which sorts
     * first and leads the agent's "what not to do". Nothing was gained by the
     * old count: every one of the 1531 queries that matched on two genuinely
     * distinct words still matches. Two of the three queries now return the
     * empty-result suggestion instead, which is the honest answer — the corpus
     * holds nothing that overlaps them by two words.
     */
    if (
      item._kwWords.some((kWords, ki) => {
        const meaningfulMatches = [
          ...new Set(queryPhrase.filter((qw) => !FILLER.has(qw) && kWords.has(qw))),
        ];
        if (meaningfulMatches.length < MIN_WORD_OVERLAP) return false;
        return !isCompoundArtifact(
          queryTokens,
          item._kwTokenWords[ki] ?? [],
          meaningfulMatches
        );
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

/** Project a scored near-match into the wire shape. */
function toNear(n: {
  item: { id: string; title: string };
  score: number;
  matched_tokens: string[];
}): NearMatch {
  return {
    id: n.item.id,
    title: n.item.title,
    score: n.score,
    matched_tokens: n.matched_tokens,
  };
}

/** Optional wire fields are omitted rather than sent empty. */
function orUndefined(list: NearMatch[]): NearMatch[] | undefined {
  return list.length > 0 ? list : undefined;
}

/**
 * THE ordering rule for scars, wherever an agent is shown a list of them.
 *
 * Critical first (a scar that sorts first is the agent's top "what not to do"),
 * then your own recorded failures — "I personally hit this here" beats any
 * shared-corpus frequency signal — then hit_count. Deliberately NOT a total
 * order: it is applied with a stable sort, so equal-ranked scars keep the
 * match tier they arrived in (exact keyword > containment > word overlap).
 *
 * Exported because a second surface that re-implements this drifts: premortem
 * ranked by hit_count first, which put a twice-recorded WARNING above a
 * CRITICAL and, under top_k, pushed criticals out of the answer entirely.
 */
export function compareScars(a: Scar, b: Scar): number {
  if (a.severity !== b.severity) {
    return a.severity === "critical" ? -1 : 1;
  }
  const personal =
    Number(b.source === "personal") - Number(a.source === "personal");
  if (personal !== 0) return personal;
  return b.hit_count - a.hit_count;
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

  let matchedSkills = matchByKeywordAndContext(allSkills, keyword, contexts);
  let matchedScars = matchByKeywordAndContext(allScars, keyword, contexts);

  /**
   * Context tags disambiguate BETWEEN candidates; they cannot disambiguate
   * between none. When the filter leaves the whole response empty, it stopped
   * narrowing an answer and started deleting one — the caller who honestly
   * tagged its project gets less than the caller who tagged nothing.
   *
   * The recovery path below already settled this question in the caller's
   * favour and only applied it to the weaker signal: near-matching scores
   * title/summary tokens at a 0.30 threshold with the context filter
   * deliberately off. So a fuzzy 0.30 near-match survived a context mismatch
   * while an EXACT keyword hit did not — and near matches ship as id + title +
   * score, without the mistake/instead payload that is the point of a scar.
   *
   * Measured over 62 real kira_lookup calls (47 carrying context tags) taken
   * from this machine's agent transcripts and miss log, against the shipped
   * corpus plus the author's 173-scar personal store: 8 of the 47 returned
   * NOTHING while the corpus held a keyword match, and 4 of those 8 had no
   * near-match to fall back on either — a literally empty answer. Against the
   * SHIPPED corpus alone (what a fresh npm install holds) the class survives:
   * "mcp server add tool typescript" + ["typescript", "mcp-server"] drops
   * `community.mcp-registry-publish.v1`, whose contexts say "mcp".
   *
   * It also corrupted the flywheel's own input. logMiss() fires on a 0-hit
   * response, so 3 of the 15 entries in the miss log — the maintainer's list
   * of what the corpus is MISSING — are queries the corpus could already
   * answer, and two of them had been written down as corpus gaps to go
   * research.
   *
   * The condition is "no surviving candidate DECLARES one of the requested
   * tags", not "the response is empty". An item with no contexts opts out of
   * the filter entirely, so an empty-contexts entry that happens to share a
   * keyword would otherwise keep the response non-empty and suppress the
   * relaxation — the caller's tags would be enforced against everything else
   * on the strength of an item that never answered them. Surviving items that
   * declare contexts intersect the request by construction, so this reads
   * exactly as: apply the filter only where it discriminates.
   *
   * Relaxed for both lists together: doing it per list would hand back skills
   * while still hiding the scars that belong with them.
   */
  const discriminates = [...matchedSkills, ...matchedScars].some(
    (i) => i._contextsLower.length > 0
  );
  if (contexts.length > 0 && !discriminates) {
    matchedSkills = matchByKeywordAndContext(allSkills, keyword, []);
    matchedScars = matchByKeywordAndContext(allScars, keyword, []);
  }

  // ── Skills (return summaries without instructions to save tokens) ──
  const community = matchedSkills.filter((s) => s.source === "community");
  const vendor = matchedSkills.filter((s) => s.source === "vendor");
  const sortedSkills = [...community, ...vendor].map(toSkillSummary);

  // ── Scars ────────────────────────────────────────────────────────────
  const rankedScars = [...matchedScars].sort(compareScars);
  const sortedScars = rankedScars.map(toScarSummary);

  // Fall back to scored near-matching (token-level, with title/summary/alias
  // coverage — see similarity.ts). Near results are a recovery path, so the
  // context filter is intentionally NOT applied here.
  let suggestions: string[] | undefined;
  let nearSkills: NearMatch[] | undefined;
  let nearScars: NearMatch[] | undefined;

  if (sortedSkills.length === 0 && sortedScars.length === 0) {
    nearSkills = orUndefined(nearMatches(allSkills, keyword).map(toNear));
    nearScars = orUndefined(nearMatches(allScars, keyword).map(toNear));

    suggestions = (nearSkills ?? []).map((n) => n.title);
    if (suggestions.length === 0) {
      suggestions = ["No matching skills found. Try broader keywords like 'deploy', 'auth', 'database', 'testing'."];
    }
  } else if (sortedScars.length === 0) {
    // A skill matched but no scar did — the agent now holds a recipe and an
    // empty "what not to do" list, which is exactly the moment before it
    // executes. Gating near-scars on a fully empty response hid them there:
    // asking for "deploy vercel" returned the Vercel deploy skill while the
    // scar "Vercel deploy fails from missing env vars" stayed silent, because
    // its keywords ("vercel env") miss all three lexical tiers. Scars are the
    // point of Kira, so a strong near-scar ships even when a skill matched.
    nearScars = orUndefined(
      nearMatches(allScars, keyword, { threshold: ADVISORY_SCAR_THRESHOLD })
        .filter((n) => n.matched_tokens.length >= ADVISORY_MIN_MATCHED_TOKENS)
        .map(toNear)
    );
  }

  return {
    skills: sortedSkills,
    scars: sortedScars,
    skill_count: sortedSkills.length,
    scar_count: sortedScars.length,
    ...(suggestions ? { suggestions } : {}),
    ...(nearSkills ? { near_skills: nearSkills } : {}),
    ...(nearScars ? { near_scars: nearScars } : {}),
  };
}
