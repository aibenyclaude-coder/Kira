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
  context?: string;
}

export interface ReportResponse {
  ack: true;
  recorded_at: string;
  /** One-time consent prompt — non-null only on the first report after install. */
  consent_notice?: string;
}

// ── Telemetry payload (wire format v1) ─────────────────────────────────

export type ConsentLevel = "off" | "basic" | "full";
export type OsFamily = "linux" | "darwin" | "win32" | "other";

/**
 * Wire format sent to the telemetry Worker.
 *
 * - level=basic adds anonymous core only (no detail{})
 * - level=full additionally includes sanitized note/context in detail{}
 *
 * MUST NEVER carry: file paths, env var names/values, project/repo names,
 * git remote URLs, raw error messages, hostname/username/IP/MAC,
 * API keys, JWTs, OAuth tokens, session cookies, emails, phone numbers,
 * or any process.env value other than the kira version.
 */
export interface ReportPayloadV1 {
  v: 1;
  skill_id: string;
  status: ReportStatus;
  /** Anonymous client UUID — local-only, regenerated on opt-out. */
  client_id: string;
  /** Kira package version (build-time read from package.json). */
  kira_version: string;
  /** ISO-8601 timestamp, client-generated. */
  ts: string;
  env: {
    os: OsFamily;
    /** Major version only — never minor/patch. */
    node_major: number;
    tier: "free" | "pro";
  };
  /** Detail layer — present only when consent level === "full". */
  detail?: {
    note?: string;
    context?: string;
  };
}

/** Local NDJSON entry — superset of wire format with send-state fields. */
export interface ReportLogEntry extends ReportPayloadV1 {
  /** Whether this entry was uploaded successfully. */
  sent: boolean;
  send_attempts: number;
}

// ── Consent state ──────────────────────────────────────────────────────

export interface ConsentState {
  v: 1;
  level: ConsentLevel;
  /** UUIDv4 — regenerated whenever level transitions to "off". */
  client_id: string;
  decided_at: string;
  source: "default_basic" | "first_run_prompt" | "tool" | "env";
}
