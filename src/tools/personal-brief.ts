/**
 * `kira_personal_brief` MCP tool — the SessionStart "magic moment".
 *
 * At the start of a session (ideally driven from a SessionStart hook — see
 * examples/claude-code-sessionstart-hook.sh) the agent surfaces the user's most
 * recent PERSONAL scars: the private, local-only failure notes written by
 * kira_record_failure under ~/.kira/personal-scars/. Starting a session already
 * aware of the walls you hit last time ON THIS MACHINE is the whole point.
 *
 * This tool reads those scar files directly, ranks them by recency (most recent
 * first), and returns the top-N. It is local-only: it performs no network I/O
 * and writes nothing to stdout (stdout is the MCP transport).
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { PERSONAL_SCARS_DIR, type PersonalScar } from "../personal-scars.js";

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 50;

export const KIRA_PERSONAL_BRIEF_TOOL = {
  name: "kira_personal_brief",
  description:
    "Surface your most recent PERSONAL scars — the private, local-only failure " +
    "notes recorded by kira_record_failure under ~/.kira/personal-scars/. " +
    "Call this at the START of a session (ideally from a SessionStart hook) so " +
    "you begin already aware of the walls you hit last time on this machine. " +
    "Returns the top-N scars by recency (most recent first), each with its " +
    "mistake and what to do instead. Pass 'limit' to change how many, and " +
    "'contexts' to keep only scars relevant to the current project. " +
    "Personal scars are LOCAL-ONLY — this reads them from disk and never " +
    "touches the network.",
  inputSchema: {
    type: "object",
    properties: {
      limit: {
        type: "number",
        description: `How many recent scars to return (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}).`,
      },
      contexts: {
        type: "array",
        items: { type: "string" },
        description:
          "Optional project context tags (e.g., ['nextjs', 'typescript']). " +
          "When given, only scars sharing at least one context are returned; " +
          "untagged scars are always kept (they apply everywhere).",
      },
    },
  },
  annotations: {
    title: "Kira Personal Brief",
    // Reads local scar files; writes nothing.
    readOnlyHint: true,
    destructiveHint: false,
    // Same inputs + same on-disk scars → same brief.
    idempotentHint: true,
    // Local-only: never reaches the network on any tier.
    openWorldHint: false,
  },
} as const;

export interface PersonalBriefInput {
  /** How many recent scars to return. Clamped to [1, MAX_LIMIT]. */
  limit?: number;
  /** When non-empty, keep only scars sharing a context (plus untagged ones). */
  contexts?: string[];
}

export interface PersonalBrief {
  /** Top-N personal scars, most recent first. */
  scars: PersonalScar[];
  /** How many scars are in `scars` (after context filter + limit). */
  count: number;
  /** Total personal scars found on disk (before filter/limit). */
  total: number;
  /** Absolute directory the scars were read from. */
  source_dir: string;
  /** Reassures that nothing left the machine. */
  read: "local-only";
  /** A ready-to-print one-liner + summary for a SessionStart banner. */
  headline: string;
}

/** Narrow an unknown parsed object to a usable PersonalScar. */
function isPersonalScar(s: Partial<PersonalScar> | null | undefined): s is PersonalScar {
  return (
    !!s &&
    typeof s.id === "string" &&
    typeof s.title === "string" &&
    typeof s.updated_at === "string" &&
    typeof s.hit_count === "number"
  );
}

/**
 * Load every personal scar from ~/.kira/personal-scars/. A missing directory
 * (no failures recorded yet) yields an empty list; corrupt or non-JSON files
 * are skipped rather than failing the whole brief.
 */
async function loadPersonalScars(): Promise<PersonalScar[]> {
  let names: string[];
  try {
    names = await readdir(PERSONAL_SCARS_DIR);
  } catch {
    return []; // directory absent — clean slate
  }

  const out: PersonalScar[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      const raw = await readFile(join(PERSONAL_SCARS_DIR, name), "utf-8");
      const parsed = JSON.parse(raw) as Partial<PersonalScar>;
      if (isPersonalScar(parsed)) out.push(parsed);
    } catch {
      // corrupt / unreadable file — skip it
    }
  }
  return out;
}

/** Epoch ms for an ISO timestamp; unparseable timestamps sort oldest. */
function recencyMs(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

/** Most recent first; stable tiebreak on id keeps ordering deterministic. */
function byRecencyDesc(a: PersonalScar, b: PersonalScar): number {
  const diff = recencyMs(b.updated_at) - recencyMs(a.updated_at);
  if (diff !== 0) return diff;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function normalizeContexts(contexts: string[] | undefined): string[] {
  if (!Array.isArray(contexts)) return [];
  const out: string[] = [];
  for (const c of contexts) {
    if (typeof c !== "string") continue;
    const t = c.trim().toLowerCase();
    if (t) out.push(t);
  }
  return out;
}

/** A scar matches when it is untagged (universal) or shares a wanted context. */
function matchesContext(scar: PersonalScar, wanted: string[]): boolean {
  const tags = Array.isArray(scar.contexts) ? scar.contexts : [];
  if (tags.length === 0) return true;
  const have = new Set(tags.map((t) => t.toLowerCase()));
  return wanted.some((w) => have.has(w));
}

function clampLimit(limit: number | undefined): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit)));
}

function pluralScars(n: number): string {
  return n === 1 ? "scar" : "scars";
}

function headlineFor(shown: PersonalScar[], total: number): string {
  if (total === 0) {
    return (
      "No personal scars recorded yet — a clean slate. Failures you capture " +
      "with kira_record_failure will surface here at the start of your next session."
    );
  }
  if (shown.length === 0) {
    return (
      `You have ${total} personal ${pluralScars(total)}, but none match the ` +
      "requested project context."
    );
  }
  const critical = shown.filter((s) => s.severity === "critical").length;
  const criticalNote = critical > 0 ? ` (${critical} critical)` : "";
  return (
    `Recalling your last ${shown.length} of ${total} personal ` +
    `${pluralScars(total)}${criticalNote}. Review before you start — ` +
    "don't hit the same wall twice."
  );
}

/**
 * Build the SessionStart brief: read local personal scars, optionally filter to
 * the current project context, and return the top-N by recency. Never performs
 * network I/O and never writes to stdout.
 */
export async function buildPersonalBrief(
  input: PersonalBriefInput = {}
): Promise<PersonalBrief> {
  const all = await loadPersonalScars();
  const total = all.length;

  const wanted = normalizeContexts(input.contexts);
  const filtered = wanted.length
    ? all.filter((s) => matchesContext(s, wanted))
    : all;

  filtered.sort(byRecencyDesc);
  const scars = filtered.slice(0, clampLimit(input.limit));

  return {
    scars,
    count: scars.length,
    total,
    source_dir: PERSONAL_SCARS_DIR,
    read: "local-only",
    headline: headlineFor(scars, total),
  };
}

/**
 * Validate raw MCP arguments and build the brief.
 * Throws (never returns an error envelope) on invalid input, matching the
 * other tool handlers in this repo.
 */
export async function handlePersonalBrief(args: unknown): Promise<PersonalBrief> {
  const a = (args ?? {}) as Record<string, unknown>;

  if (a.limit !== undefined && typeof a.limit !== "number") {
    throw new Error("'limit' must be a number.");
  }
  if (a.contexts !== undefined && !Array.isArray(a.contexts)) {
    throw new Error("'contexts' must be an array of strings.");
  }

  return buildPersonalBrief({
    limit: typeof a.limit === "number" ? a.limit : undefined,
    contexts: Array.isArray(a.contexts)
      ? a.contexts.filter((x): x is string => typeof x === "string")
      : undefined,
  });
}
