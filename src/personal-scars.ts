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
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { KIRA_HOME } from "./consent.js";
import { sanitize } from "./sanitize.js";
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

  const id = `scar.personal.${slugify(title)}.${shortHash(`${title}\n${mistake}`)}.v1`;
  const now = new Date().toISOString();

  await mkdir(PERSONAL_SCARS_DIR, { recursive: true });
  const file = personalScarPath(id);

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
