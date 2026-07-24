/**
 * `kira_premortem` MCP tool — a heat map of past failure patterns for a goal,
 * surfaced BEFORE the task starts.
 *
 * Where `kira_lookup` answers "what should I do for this keyword" and
 * `kira_route` answers "what are the ordered steps", `kira_premortem` answers
 * the question a careful engineer asks first: "what has already gone wrong for
 * people doing this, and how much time will avoiding it save me?"
 *
 * It matches the goal (+ optional project context) against the scar corpus
 * (shared + personal) using the same firing logic as lookup, ranks the hits
 * with the same ordering rule as lookup (compareScars: critical first, then
 * your own recorded failures, then hit_count) and attaches a quantified
 * prevention value in estimated minutes saved. How often each wall has been
 * recorded is reported per hotspot as `hit_count` and `heat`.
 *
 * Per DESIGN.md the unit of value is not tokens but "re-firing count reduction"
 * (再発火回数の削減) — so the response reports both a per-task estimate (what
 * avoiding these traps saves you now) and a cumulative figure weighted by how
 * many times each trap has been recorded.
 */
import { compareScars, lookup, type Indexed } from "../lookup.js";
import type { NearMatch, Scar, ScarSeverity } from "../types.js";

/**
 * Typical minutes an agent burns to reproduce, diagnose, fix and re-verify a
 * failure of each severity once it has been tripped. Deliberately conservative
 * — a `critical` scar is usually a runtime crash or a silent auth failure that
 * costs a full debug loop; a `warning` is a misconfiguration you notice and
 * correct. These are estimates, surfaced as such in the response.
 */
export const RECOVERY_MINUTES: Record<ScarSeverity, number> = {
  critical: 20,
  warning: 8,
};

const DEFAULT_TOP_K = 5;
const MAX_TOP_K = 20;

export interface PremortemRequest {
  /** The task you are about to start, in natural language. */
  goal: string;
  /** Optional project context tags to focus the heat map (e.g. ["nextjs"]). */
  context?: string[];
  /** Max number of hotspots to return. Default 5, clamped to [1, 20]. */
  top_k?: number;
}

export interface PremortemHotspot {
  id: string;
  title: string;
  severity: ScarSeverity;
  /** How many times this failure has been recorded (seed counts for the shipped corpus, actual recurrences for personal scars). */
  hit_count: number;
  contexts: string[];
  /** What the agent did wrong. */
  mistake: string;
  /** What to do instead. */
  instead: string;
  /** Relative intensity 0–100 vs the hottest matched scar. */
  heat: number;
  /** Estimated minutes saved by avoiding this one failure on this task. */
  estimated_minutes_saved: number;
}

export interface PremortemResponse {
  goal: string;
  context: string[];
  /** Total scars that match the goal (before top-K truncation). */
  matched_count: number;
  /** How many hotspots are returned (top-K). */
  returned_count: number;
  /** Failure patterns ranked worst-first (critical → personal → hit_count). */
  hotspots: PremortemHotspot[];
  prevention_value: {
    /** Sum of estimated_minutes_saved across returned hotspots (this task). */
    estimated_minutes_saved: number;
    /** Sum of hit_count across returned hotspots. */
    total_recorded_failures: number;
    /** hit_count-weighted minutes — cumulative across all recordings. */
    recorded_minutes_saved: number;
    critical_count: number;
    warning_count: number;
    /** Human-readable one-liner. */
    summary: string;
    /** Reminder that the minute figures are heuristic estimates. */
    basis: string;
  };
  /** When nothing matches strictly, the closest recorded scars (recovery path). */
  near_scars?: NearMatch[];
  /** What the agent should do with this heat map. */
  advice: string;
}

export const KIRA_PREMORTEM_TOOL = {
  name: "kira_premortem",
  description:
    "Run a PRE-MORTEM before starting a task. Given a goal (and optional project context), " +
    "return a heat map of the past failure patterns (scars, shared and personal) most likely to " +
    "bite — ranked worst-first: critical before warning, your own recorded failures before the " +
    "shared corpus, then by how many times the wall has been recorded (hit_count). Each hotspot " +
    "includes the mistake, the fix ('instead'), a relative heat score, and estimated minutes " +
    "saved by avoiding it, plus an aggregate prevention value. When nothing matches strictly, " +
    "'near_scars' lists the closest recorded scars instead. " +
    "Call this FIRST for any non-trivial task to surface known traps up front, then read each " +
    "hotspot's 'instead' and use kira_lookup / kira_route to plan the actual work.",
  inputSchema: {
    type: "object",
    properties: {
      goal: {
        type: "string",
        description:
          "The task you are about to start, in natural language (e.g., 'deploy a Next.js app to Vercel with Stripe').",
      },
      context: {
        type: "array",
        items: { type: "string" },
        description:
          "Optional project context tags (e.g., ['nextjs', 'typescript']) to focus the heat map.",
      },
      top_k: {
        type: "number",
        description: "Max number of hotspots to return. Default 5, max 20.",
      },
    },
    required: ["goal"],
  },
  annotations: {
    title: "Kira Premortem",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
} as const;

function clampTopK(value?: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_TOP_K;
  return Math.max(1, Math.min(MAX_TOP_K, Math.floor(value)));
}

/**
 * Build the heat map for a goal. Pure: takes the pre-indexed scar corpus
 * (index once at load time — see server.ts), matches via the shared lookup
 * firing logic, then ranks and scores.
 */
export function buildPremortem(
  scars: (Scar & Indexed)[],
  request: PremortemRequest
): PremortemResponse {
  const goal = request.goal;
  const context = request.context ?? [];
  const k = clampTopK(request.top_k);

  // Reuse the exact scar firing logic (keyword + context) used everywhere else.
  // Skills are irrelevant to a pre-mortem, so pass an empty skill set. On a
  // 0-hit, lookup already computes the scored near-matches — reuse them below.
  const looked = lookup([], scars, {
    keyword: goal,
    context: request.context,
  });
  const matched = looked.scars;

  // Rank with the shared scar ordering (compareScars): critical first, then
  // your own recorded failures, then hit_count. Ranking by hit_count first —
  // what this used to do — reads well but does not survive real data: 173 of
  // the 180 scars on this machine sit at hit_count 1, so the "hottest first"
  // key is a near-constant and the answer was decided by the alphabetical
  // tiebreak underneath it. Measured over the 1007 keywords the shipped corpus
  // and the local store advertise: 37 goals returned a heat map with a WARNING
  // ranked above a CRITICAL, and one ("ci") pushed three criticals out of the
  // top-5 entirely while showing two warnings. hit_count keeps its own field
  // (`heat`), where it is labelled rather than silently deciding the order.
  const ranked = [...matched].sort(compareScars);

  // Heat is relative to the hottest MATCHED scar — which is no longer ranked[0]
  // now that severity leads (35 of those 1007 goals have their max hit_count
  // outside the first slot; reading it off ranked[0] would emit heat > 100).
  const maxHit = ranked.reduce((m, s) => Math.max(m, s.hit_count), 0);
  const top = ranked.slice(0, k);

  const hotspots: PremortemHotspot[] = top.map((scar) => ({
    id: scar.id,
    title: scar.title,
    severity: scar.severity,
    hit_count: scar.hit_count,
    contexts: scar.contexts,
    mistake: scar.mistake,
    instead: scar.instead,
    heat: maxHit > 0 ? Math.round((scar.hit_count / maxHit) * 100) : 0,
    estimated_minutes_saved: RECOVERY_MINUTES[scar.severity],
  }));

  const estimatedMinutes = hotspots.reduce(
    (sum, h) => sum + h.estimated_minutes_saved,
    0
  );
  const totalRecorded = hotspots.reduce((sum, h) => sum + h.hit_count, 0);
  const recordedMinutes = hotspots.reduce(
    (sum, h) => sum + h.hit_count * RECOVERY_MINUTES[h.severity],
    0
  );
  const criticalCount = hotspots.filter((h) => h.severity === "critical").length;
  const warningCount = hotspots.filter((h) => h.severity === "warning").length;

  const near_scars =
    hotspots.length === 0 && looked.near_scars && looked.near_scars.length > 0
      ? looked.near_scars
      : undefined;

  const summary =
    hotspots.length === 0
      ? "No known failure patterns match this goal."
      : `${hotspots.length} known failure pattern${hotspots.length === 1 ? " intersects" : "s intersect"} this goal ` +
        `(${criticalCount} critical, ${warningCount} warning). Avoiding them saves ~${estimatedMinutes} min on ` +
        `this task; these traps have been recorded ${totalRecorded} time${totalRecorded === 1 ? "" : "s"} so far.`;

  const advice =
    hotspots.length === 0
      ? near_scars
        ? "No failure pattern matches this goal exactly, but near_scars lists the closest " +
          "recorded ones — read their 'instead' (via kira_get) before you start, then call " +
          "kira_lookup on each concrete step and kira_report any new failures."
        : "No known failure patterns match this goal. Proceed, but call kira_lookup on each concrete step " +
          "and kira_report any new failures so future pre-mortems cover this path."
      : "Read each hotspot's 'instead' before you start — highest-heat traps first — then use " +
        "kira_lookup / kira_route to plan the work while steering clear of these patterns.";

  return {
    goal,
    context,
    matched_count: ranked.length,
    returned_count: hotspots.length,
    hotspots,
    prevention_value: {
      estimated_minutes_saved: estimatedMinutes,
      total_recorded_failures: totalRecorded,
      recorded_minutes_saved: recordedMinutes,
      critical_count: criticalCount,
      warning_count: warningCount,
      summary,
      basis:
        "Estimates: ~20 min saved per avoided critical failure, ~8 min per warning " +
        "(typical diagnose + fix + re-verify time). recorded_minutes_saved weights each by hit_count.",
    },
    ...(near_scars ? { near_scars } : {}),
    advice,
  };
}
