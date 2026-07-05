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
 * using the same firing logic as lookup, then ranks the hits by `hit_count`
 * (how many agents have already slammed into each wall) and attaches a
 * quantified prevention value in estimated minutes saved.
 *
 * Per DESIGN.md the unit of value is not tokens but "re-firing count reduction"
 * (再発火回数の削減) — so the response reports both a per-task estimate (what
 * avoiding these traps saves you now) and a network figure weighted by how many
 * times each trap has historically burned agents.
 */
import { lookup, indexItems } from "../lookup.js";
import type { Scar, ScarSeverity } from "../types.js";

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
  /** How many agents have hit this wall across the network. */
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
  /** Failure patterns ranked hottest-first (by hit_count). */
  hotspots: PremortemHotspot[];
  prevention_value: {
    /** Sum of estimated_minutes_saved across returned hotspots (this task). */
    estimated_minutes_saved: number;
    /** Sum of hit_count across returned hotspots. */
    total_historical_failures: number;
    /** hit_count-weighted minutes — cumulative value across the network. */
    network_minutes_saved: number;
    critical_count: number;
    warning_count: number;
    /** Human-readable one-liner. */
    summary: string;
    /** Reminder that the minute figures are heuristic estimates. */
    basis: string;
  };
  /** What the agent should do with this heat map. */
  advice: string;
}

export const KIRA_PREMORTEM_TOOL = {
  name: "kira_premortem",
  description:
    "Run a PRE-MORTEM before starting a task. Given a goal (and optional project context), " +
    "return a heat map of the past failure patterns (scars) most likely to bite — ranked by how " +
    "many agents have already hit each wall (hit_count). Each hotspot includes the mistake, the " +
    "fix ('instead'), a relative heat score, and estimated minutes saved by avoiding it, plus an " +
    "aggregate prevention value. " +
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
 * Build the heat map for a goal. Pure: takes the raw scar corpus, indexes it,
 * matches via the shared lookup firing logic, then ranks and scores.
 */
export function buildPremortem(
  scars: Scar[],
  request: PremortemRequest
): PremortemResponse {
  const goal = request.goal;
  const context = request.context ?? [];
  const k = clampTopK(request.top_k);

  // Reuse the exact scar firing logic (keyword + context) used everywhere else.
  // Skills are irrelevant to a pre-mortem, so pass an empty skill set.
  const matched = lookup([], indexItems(scars), {
    keyword: goal,
    context: request.context,
  }).scars;

  // Rank by hit_count (proven traps first), then critical-first, then title
  // for a stable order.
  const ranked = [...matched].sort((a, b) => {
    if (b.hit_count !== a.hit_count) return b.hit_count - a.hit_count;
    if (a.severity !== b.severity) return a.severity === "critical" ? -1 : 1;
    return a.title.localeCompare(b.title);
  });

  const maxHit = ranked.length > 0 ? ranked[0]!.hit_count : 0;
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
  const totalHistorical = hotspots.reduce((sum, h) => sum + h.hit_count, 0);
  const networkMinutes = hotspots.reduce(
    (sum, h) => sum + h.hit_count * RECOVERY_MINUTES[h.severity],
    0
  );
  const criticalCount = hotspots.filter((h) => h.severity === "critical").length;
  const warningCount = hotspots.filter((h) => h.severity === "warning").length;

  const summary =
    hotspots.length === 0
      ? "No known failure patterns match this goal."
      : `${hotspots.length} known failure pattern${hotspots.length === 1 ? " intersects" : "s intersect"} this goal ` +
        `(${criticalCount} critical, ${warningCount} warning). Avoiding them saves ~${estimatedMinutes} min on ` +
        `this task; these traps have burned agents ${totalHistorical} time${totalHistorical === 1 ? "" : "s"} across the network.`;

  const advice =
    hotspots.length === 0
      ? "No known failure patterns match this goal. Proceed, but call kira_lookup on each concrete step " +
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
      total_historical_failures: totalHistorical,
      network_minutes_saved: networkMinutes,
      critical_count: criticalCount,
      warning_count: warningCount,
      summary,
      basis:
        "Estimates: ~20 min saved per avoided critical failure, ~8 min per warning " +
        "(typical diagnose + fix + re-verify time). network_minutes_saved weights each by hit_count.",
    },
    advice,
  };
}
