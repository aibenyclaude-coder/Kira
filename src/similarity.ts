/**
 * Token-level similarity for near-match scoring.
 *
 * Purpose: when the 3 lexical tiers in lookup.ts return nothing, we still
 * (a) surface the closest skills/scars to the agent (magic-moment recovery)
 * and (b) record in the miss log what ALMOST matched — that difference is
 * exactly the alias/keyword a maintainer should add (flywheel loop B).
 *
 * Deterministic and dependency-free. Deliberately crude: both query and item
 * pass the SAME tokenize() pipeline, so linguistic imperfections (plural/ing
 * stripping producing non-words like "kubernete") cancel out — consistency
 * beats correctness for matching.
 */

/** Words that carry no matching signal. Superset of lookup.ts FILLER. */
const STOP = new Set([
  "i", "a", "to", "my", "the", "an", "is", "it", "do",
  "want", "need", "please", "can", "how", "with", "for", "in", "on", "of",
  "and", "or", "but", "this", "that", "then", "into", "from", "using", "use",
  "via", "when", "what", "where", "which", "some", "any", "app", "project",
]);

/** Expansion aliases: token → replacement token(s). Applied before AND after stemming. */
const ALIASES: Record<string, string[]> = {
  ts: ["typescript"],
  js: ["javascript"],
  py: ["python"],
  k8s: ["kubernetes"],
  db: ["database"],
  pr: ["pull", "request"],
  prs: ["pull", "request"], // 3 chars — too short for the plural stemmer to reach "pr"
  repo: ["repository"],
  auth: ["authentication"],
  env: ["environment"],
  config: ["configuration"],
  deploy: ["deployment"],
  doc: ["documentation"],
  test: ["testing"],
  ci: ["continuous", "integration"],
};

function stem(w: string): string {
  if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

function expand(w: string): string[] {
  return ALIASES[w] ?? [w];
}

/**
 * Normalize free text into matching tokens.
 * lowercase → split on non-alphanumerics → alias → stem → alias → stop/len filter → dedupe.
 */
export function tokenize(text: string): string[] {
  const out = new Set<string>();
  const rough = text.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/);
  for (const raw of rough) {
    if (!raw) continue;
    for (const a of expand(raw)) {
      for (const b of expand(stem(a))) {
        if (b.length >= 2 && !STOP.has(b)) out.add(b);
      }
    }
  }
  return [...out];
}

/** Pre-computed token sets, built once at load time (see lookup.indexItems). */
export interface SimIndexed {
  /** Tokens from keywords[] only — matches here weigh double. */
  _kwTokens: Set<string>;
  /** Tokens from title + summary + keywords + contexts. */
  _simTokens: Set<string>;
}

export interface NearScored<T> {
  item: T;
  /** 0-1 query-coverage: (2×keyword-hits + 1×other-hits) / (2×|query|). */
  score: number;
  matched_tokens: string[];
}

/**
 * Score all items against a keyword and return the top matches.
 * Score is query coverage: how much of what the caller asked for exists in
 * the item, with keyword-field hits weighted double. Threshold 0.30 keeps
 * single-strong-token hits on 3-token queries (2/6 ≈ 0.33) while dropping
 * incidental title-word collisions.
 */
export function nearMatches<T extends SimIndexed & { title: string }>(
  items: T[],
  keyword: string,
  opts: { limit?: number; threshold?: number } = {}
): NearScored<T>[] {
  const limit = opts.limit ?? 3;
  const threshold = opts.threshold ?? 0.3;
  const q = tokenize(keyword);
  if (q.length === 0) return [];

  const scored: NearScored<T>[] = [];
  for (const item of items) {
    let points = 0;
    const matched: string[] = [];
    for (const t of q) {
      if (item._kwTokens.has(t)) {
        points += 2;
        matched.push(t);
      } else if (item._simTokens.has(t)) {
        points += 1;
        matched.push(t);
      }
    }
    const score = points / (2 * q.length);
    if (score >= threshold) {
      scored.push({ item, score: Math.round(score * 100) / 100, matched_tokens: matched });
    }
  }

  scored.sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title));
  return scored.slice(0, limit);
}
