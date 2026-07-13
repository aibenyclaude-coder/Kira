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

/** Exported so lookup.ts's word-boundary matcher folds plurals the same way this does. */
export function stem(w: string): string {
  if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

function expand(w: string): string[] {
  return ALIASES[w] ?? [w];
}

/** CJK (かな/カナ/漢字/半角カナ) の連続 run にマッチ。 */
const CJK_RUN = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uff66-\uff9f]+/g;

/** Single CJK char \u2014 same class as CJK_RUN, unanchored and without the /g state. */
const CJK_CHAR = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uff66-\uff9f]/;

/**
 * CJK \u306f\u5206\u304b\u3061\u66f8\u304d\u3057\u306a\u3044\u305f\u3081\u8a9e\u5883\u754c\u304c\u5b58\u5728\u3057\u306a\u3044\u3002lookup.ts \u306e tier 2 \u306f
 * CJK \u3092\u542b\u3080\u6587\u5b57\u5217\u306b\u3060\u3051\u90e8\u5206\u6587\u5b57\u5217\u30de\u30c3\u30c1\u3092\u8a31\u3057\u3001Latin \u306b\u306f\u8a9e\u5883\u754c\u3092\u8981\u6c42\u3059\u308b\u3002
 */
export function hasCJK(text: string): boolean {
  return CJK_CHAR.test(text);
}

/**
 * CJK run は文字 bigram に割る (分かち書きが無いため)。
 * 1 文字 run はそのまま 1 トークン。両側 (query/item) が同じ処理を通るので
 * 助詞由来のノイズ bigram は互いに弱い一致にしかならない。
 */
function cjkBigrams(run: string): string[] {
  if (run.length <= 2) return [run];
  const out: string[] = [];
  for (let i = 0; i < run.length - 1; i++) out.push(run.slice(i, i + 2));
  return out;
}

/**
 * Normalize free text into matching tokens.
 * Latin/数字: lowercase → alias → stem → alias → stop/len filter。
 * CJK: run ごとに文字 bigram (STOP/stem/alias は適用しない)。
 */
export function tokenize(text: string): string[] {
  const out = new Set<string>();
  const lower = text.toLowerCase();

  for (const run of lower.match(CJK_RUN) ?? []) {
    for (const bg of cjkBigrams(run)) out.add(bg);
  }

  const rough = lower.replace(CJK_RUN, " ").replace(/[^a-z0-9]+/g, " ").split(/\s+/);
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
