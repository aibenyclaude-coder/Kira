/**
 * Personal Scars — local-only failure memory.
 *
 * When an agent hits a retry or an exception, `kira_record_failure` captures it
 * as a "personal scar": the same shape as a community Scar, but private to this
 * machine. Personal scars live under ~/.kira/personal-scars/<id>.json and are
 * NEVER uploaded — there is deliberately no telemetry path in this module, on
 * any tier. This is the user's own failure ledger, distinct from the shared,
 * curated scar database that ships with Kira.
 *
 * Every free-text field passes through the shared sanitizer before it touches
 * disk, so a personal scar can never persist an API key, path, or email — even
 * locally.
 */
import { mkdir, writeFile, readdir, readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { KIRA_HOME } from "./consent.js";
import { sanitize } from "./sanitize.js";
import { tokenize } from "./similarity.js";
import type { ScarSeverity } from "./types.js";

export const PERSONAL_SCARS_DIR = join(KIRA_HOME, "personal-scars");

// Field length caps — bound the regex work in the sanitizer and keep scars small.
const TITLE_MAX = 200;
const SUMMARY_MAX = 300;
const MISTAKE_MAX = 2000;
const INSTEAD_MAX = 2000;
const TERM_MAX = 80;
const MAX_KEYWORDS = 20;
const MAX_CONTEXTS = 20;

/** A locally-stored failure note. Mirrors the public Scar shape, plus provenance. */
export interface PersonalScar {
  /** Stable id: "scar.personal.<slug>.<hash>.v1" — also the file name stem. */
  id: string;
  keywords: string[];
  contexts: string[];
  title: string;
  summary: string;
  severity: ScarSeverity;
  /** What the agent did wrong / the exception encountered. */
  mistake: string;
  /** What to do instead next time. */
  instead: string;
  /** How many times this exact failure recurred on this machine. */
  hit_count: number;
  source: "personal";
  version: string;
  created_at: string;
  updated_at: string;
}

export interface RecordFailureInput {
  title: string;
  mistake: string;
  instead?: string;
  summary?: string;
  keywords?: string[];
  contexts?: string[];
  severity?: ScarSeverity;
}

/** Absolute path of the JSON file backing a given personal-scar id. */
export function personalScarPath(id: string): string {
  return join(PERSONAL_SCARS_DIR, `${id}.json`);
}

function slugify(s: string): string {
  const slug = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return slug || "failure";
}

function shortHash(s: string): string {
  return createHash("sha1").update(s).digest("hex").slice(0, 8);
}

function cleanList(list: string[] | undefined, maxCount: number): string[] {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== "string") continue;
    const cleaned = sanitize(item, TERM_MAX)?.trim();
    if (cleaned) out.push(cleaned);
    if (out.length >= maxCount) break;
  }
  return out;
}

/**
 * Two recordings of the "same" failure rarely share identical text, so exact
 * id matching alone would fragment recurrences into near-duplicate files and
 * hit_count would never grow past 1. A new recording at or above this
 * threshold is folded into the existing scar as a recurrence instead.
 */
const DEDUP_THRESHOLD = 0.45;

/** Title carries the identity of a failure; the mistake body is narrative around it. */
const TITLE_WEIGHT = 0.6;

/**
 * Overlap saturates on tiny token sets — a 2-token title fully contained in a
 * 10-token one scores 1.0 — so fields below this size score on Jaccard, which
 * penalizes the size gap.
 */
const MIN_OVERLAP_TOKENS = 4;

function scarTokens(title: string, mistake: string): Set<string> {
  return new Set(tokenize(`${title} ${mistake}`));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * Overlap coefficient (|A∩B| / min(|A|,|B|)): unlike Jaccard it does not
 * penalize one recording for being wordier than the other, which is the normal
 * case when the same wall is described twice.
 */
function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const smaller = Math.min(a.size, b.size);
  if (smaller < MIN_OVERLAP_TOKENS) return jaccard(a, b);
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / smaller;
}

/**
 * How strongly two recordings look like the same failure.
 *
 * Pooling title+mistake into one token set (the Jaccard term) lets a long,
 * freely-worded mistake body outvote a strong title match: a real recurrence
 * pair on a 77-scar store scored 0.35 pooled against the 0.45 threshold and
 * forked into two scars, each stuck at hit_count 1. Scoring the two fields
 * separately — title weighted higher, overlap instead of Jaccard so verbosity
 * costs nothing — puts that pair at 0.65 while the closest genuinely distinct
 * pair in the same store stays at 0.40.
 *
 * The pooled Jaccard is kept as a floor so this is purely additive: every pair
 * that folded before still folds.
 */
function scarSimilarity(
  a: { title: string; mistake: string },
  b: { title: string; mistake: string }
): number {
  const pooled = jaccard(
    scarTokens(a.title, a.mistake),
    scarTokens(b.title, b.mistake)
  );
  const fieldwise =
    TITLE_WEIGHT * overlap(new Set(tokenize(a.title)), new Set(tokenize(b.title))) +
    (1 - TITLE_WEIGHT) *
      overlap(new Set(tokenize(a.mistake)), new Set(tokenize(b.mistake)));
  return Math.max(pooled, fieldwise);
}

function readExisting(file: string): PersonalScar | null {
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf-8")) as Partial<PersonalScar>;
    if (typeof parsed.hit_count === "number" && typeof parsed.created_at === "string") {
      return parsed as PersonalScar;
    }
  } catch {
    // Corrupt file — treat as absent and overwrite with a fresh scar.
  }
  return null;
}

/**
 * Persist a personal scar to ~/.kira/personal-scars/<id>.json.
 *
 * The id is derived from the sanitized title + mistake, so re-recording the
 * same failure targets the same file and bumps `hit_count` (preserving the
 * original `created_at`). All text is sanitized before write. This function
 * performs no network I/O and writes nothing to stdout.
 */
export async function recordPersonalScar(
  input: RecordFailureInput
): Promise<PersonalScar> {
  const title = sanitize(input.title, TITLE_MAX)!.trim();
  const mistake = sanitize(input.mistake, MISTAKE_MAX)!.trim();
  const instead = input.instead ? sanitize(input.instead, INSTEAD_MAX)!.trim() : "";
  const summary = input.summary
    ? sanitize(input.summary, SUMMARY_MAX)!.trim()
    : title.slice(0, SUMMARY_MAX);
  const keywords = cleanList(input.keywords, MAX_KEYWORDS);
  const contexts = cleanList(input.contexts, MAX_CONTEXTS);
  const severity: ScarSeverity = input.severity === "critical" ? "critical" : "warning";
  const now = new Date().toISOString();

  await mkdir(PERSONAL_SCARS_DIR, { recursive: true });

  // Recurrence check: fold a near-duplicate recording into the existing scar
  // so hit_count measures how often the wall was actually hit.
  let match: PersonalScar | null = null;
  let best = 0;
  for (const existing of await loadPersonalScars()) {
    const sim = scarSimilarity({ title, mistake }, existing);
    if (sim >= DEDUP_THRESHOLD && sim > best) {
      best = sim;
      match = existing;
    }
  }
  if (match) {
    const merged: PersonalScar = {
      ...match,
      keywords: [...new Set([...match.keywords, ...keywords])].slice(0, MAX_KEYWORDS),
      contexts: [...new Set([...match.contexts, ...contexts])].slice(0, MAX_CONTEXTS),
      // The newest fix reflects the latest understanding; keep the old one
      // only when the new recording brought none.
      instead: instead || match.instead,
      severity:
        severity === "critical" || match.severity === "critical"
          ? "critical"
          : "warning",
      hit_count: match.hit_count + 1,
      updated_at: now,
    };
    await writeFile(
      personalScarPath(merged.id),
      JSON.stringify(merged, null, 2) + "\n",
      "utf-8"
    );
    return merged;
  }

  const id = `scar.personal.${slugify(title)}.${shortHash(`${title}\n${mistake}`)}.v1`;
  const file = personalScarPath(id);

  // Exact-id collision fallback — only reachable when title+mistake tokenize
  // to nothing (all stop words), which the Jaccard pass above cannot see.
  const prev = readExisting(file);
  const hit_count = prev ? prev.hit_count + 1 : 1;
  const created_at = prev ? prev.created_at : now;

  const scar: PersonalScar = {
    id,
    keywords,
    contexts,
    title,
    summary,
    severity,
    mistake,
    instead,
    hit_count,
    source: "personal",
    version: "1.0.0",
    created_at,
    updated_at: now,
  };

  await writeFile(file, JSON.stringify(scar, null, 2) + "\n", "utf-8");
  return scar;
}

/**
 * Load every personal scar, normalized to the full PersonalScar shape
 * (missing optional fields get safe defaults).
 *
 * This is the single shared reader behind lookup/premortem recall,
 * kira_personal_brief and kira_status. A missing directory (no failures
 * recorded yet) yields an empty list; corrupt files, non-JSON files and
 * entries without the id/title/mistake core are skipped — recall must
 * survive a dirty directory.
 */
export async function loadPersonalScars(
  dir: string = PERSONAL_SCARS_DIR
): Promise<PersonalScar[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return []; // Directory absent — no failures recorded yet.
  }

  const out: PersonalScar[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      const raw = JSON.parse(
        await readFile(join(dir, name), "utf-8")
      ) as Partial<PersonalScar>;
      if (
        typeof raw.id !== "string" ||
        typeof raw.title !== "string" ||
        typeof raw.mistake !== "string"
      ) {
        continue;
      }
      out.push({
        id: raw.id,
        keywords: stringArray(raw.keywords),
        contexts: stringArray(raw.contexts),
        title: raw.title,
        summary: typeof raw.summary === "string" ? raw.summary : raw.title,
        severity: raw.severity === "critical" ? "critical" : "warning",
        mistake: raw.mistake,
        instead: typeof raw.instead === "string" ? raw.instead : "",
        hit_count:
          typeof raw.hit_count === "number" && raw.hit_count > 0
            ? raw.hit_count
            : 1,
        source: "personal",
        version: typeof raw.version === "string" ? raw.version : "1.0.0",
        created_at: typeof raw.created_at === "string" ? raw.created_at : "",
        updated_at: typeof raw.updated_at === "string" ? raw.updated_at : "",
      });
    } catch {
      // Corrupt or unreadable file — skip it.
    }
  }
  return out;
}

function stringArray(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string")
    : [];
}
