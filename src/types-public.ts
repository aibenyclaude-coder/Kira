/**
 * Public type entrypoint — `kira-mcp/types`.
 *
 * Stable, curated re-export of the Skill / Scar / Route contract types so
 * downstream tooling can type Kira's lookup, route, get, and report payloads
 * without depending on internal module paths.
 *
 * Types only: every re-export is `export type`, so this module erases to
 * nothing at runtime (no import survives compilation).
 */

// Skill contract
export type { Skill, SkillSource, SkillSummary } from "./types.js";

// Scar contract
export type { Scar, ScarSeverity, ScarSummary } from "./types.js";

// kira_lookup / kira_get
export type {
  LookupRequest,
  LookupResponse,
  GetResponse,
} from "./types.js";

// kira_route
export type {
  RouteStep,
  RouteRequest,
  RouteResponse,
} from "./types.js";

// kira_report
export type {
  ReportStatus,
  ReportRequest,
  ReportResponse,
} from "./types.js";
