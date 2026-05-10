import { appendFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ReportRequest, ReportResponse } from "./types.js";
import { enqueue } from "./telemetry.js";
import { hasSeenPrompt, markPromptSeen, loadConsent } from "./consent.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");
const REPORTS_DIR = join(PROJECT_ROOT, "reports");
const MISSING_LOG = join(REPORTS_DIR, "missing-keywords.log");

const CONSENT_PROMPT =
  "Telemetry: anonymous core (skill_id, status, anonymous client_id, kira version, OS family, Node major) " +
  "is sent to help improve skills. Free-text note/context are NOT sent unless you opt in. " +
  "To enable detailed reports run kira_consent({level:\"full\"}). " +
  "To disable all telemetry run kira_consent({level:\"off\"}) or set KIRA_TELEMETRY=off. " +
  "See PRIVACY.md for the exact wire format and redaction rules.";

/**
 * Record the outcome of applying a Skill.
 *
 * Local-first: every report appends NDJSON to ~/.kira/reports.log via the
 * telemetry pipeline. The pipeline batch-uploads the anonymous core to the
 * Worker per current consent level (off → no upload).
 *
 * On the very first invocation after install (level=default_basic), the
 * response carries a one-time consent_notice describing what is sent and
 * how to opt out.
 */
export async function record(
  request: ReportRequest,
  tier: "free" | "pro" = "free"
): Promise<ReportResponse> {
  const seen = await hasSeenPrompt();
  await enqueue(request, tier);
  const recorded_at = new Date().toISOString();

  if (!seen) {
    await markPromptSeen();
    return { ack: true, recorded_at, consent_notice: CONSENT_PROMPT };
  }
  return { ack: true, recorded_at };
}

/**
 * Log a keyword that returned 0 results from lookup.
 * Patrol jobs read this to discover demand for new skills.
 *
 * Stays at the legacy ./reports/ path: it's keyword-only (no user content)
 * and operators rely on the existing path for ETL.
 */
export async function logMissingKeyword(
  keyword: string,
  context: string[]
): Promise<void> {
  await mkdir(REPORTS_DIR, { recursive: true });
  const entry = {
    keyword,
    context,
    timestamp: new Date().toISOString(),
  };
  await appendFile(MISSING_LOG, JSON.stringify(entry) + "\n", "utf-8");
}

/** Re-exported for tests. */
export { loadConsent };
