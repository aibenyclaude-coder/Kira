/**
 * Kira core types.
 *
 * Skill = できること（正しいやり方）
 * Scar  = しないこと（過去の失敗）
 *
 * Both are fetched at runtime via kira_lookup.
 * The agent reads Skills to know HOW, reads Scars to know what to AVOID.
 */

export type SkillSource = "community" | "vendor";

export interface Skill {
  /** Stable unique identifier: "<source>.<slug>.v<N>" */
  id: string;

  /** Firing keywords. Match is case-insensitive, exact-token. */
  keywords: string[];

  /**
   * Optional project context tags (e.g., "nextjs", "python").
   * If empty, the skill matches any context.
   */
  contexts: string[];

  title: string;
  summary: string;

  source: SkillSource;
  /** Present only if source === "vendor". */
  vendor?: string;

  /**
   * Upfront disclosure string — the agent announces this to the user
   * BEFORE executing.
   */
  declaration: string;

  /** The actual step-by-step instructions (Markdown). */
  instructions: string;

  version: string;
  updated_at: string;
}

export type ScarSeverity = "warning" | "critical";

export interface Scar {
  /** Stable unique identifier: "scar.<slug>.v<N>" */
  id: string;

  /** Firing keywords — same matching rules as Skills. */
  keywords: string[];

  /** Project context tags for filtering. */
  contexts: string[];

  title: string;

  /** One-line: what went wrong. */
  summary: string;

  severity: ScarSeverity;

  /**
   * What the agent did wrong (the mistake).
   * Agent reads this to recognize the pattern.
   */
  mistake: string;

  /**
   * What to do instead (the fix / avoidance strategy).
   */
  instead: string;

  /**
   * How many times this failure was reported across the network.
   * Higher = more agents have hit this wall.
   */
  hit_count: number;

  version: string;
  updated_at: string;
}

/** Lightweight skill without instructions — for lookup/route responses. */
export type SkillSummary = Omit<Skill, "instructions"> & { category?: string };

/** Lightweight scar — full content is always returned (scars are small). */
export type ScarSummary = Scar;

export interface LookupRequest {
  keyword: string;
  context?: string[];
}

export interface LookupResponse {
  skills: SkillSummary[];
  scars: ScarSummary[];
  skill_count: number;
  scar_count: number;
  /** When 0 results, suggests the closest available skills. */
  suggestions?: string[];
}

export interface GetResponse {
  skill: Skill | null;
  scar: Scar | null;
}

// ── Route types ────────────────────────────────────────────────────────

export interface RouteStep {
  order: number;
  keyword: string;
  skill: SkillSummary | null;
  scars: ScarSummary[];
  description: string;
}

export interface RouteRequest {
  goal: string;
  context?: string[];
}

export interface RouteResponse {
  goal: string;
  steps: RouteStep[];
  step_count: number;
  coverage: string;
}

// ── Report types ───────────────────────────────────────────────────────

export type ReportStatus = "success" | "retry" | "failure";

export interface ReportRequest {
  skill_id: string;
  status: ReportStatus;
  note?: string;
}

export interface ReportResponse {
  ack: true;
  recorded_at: string;
}
