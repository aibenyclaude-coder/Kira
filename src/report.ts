import { appendFile, mkdir, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import type { ReportRequest, ReportResponse } from "./types.js";
import { enqueue } from "./telemetry.js";
import { hasSeenPrompt, markPromptSeen, loadConsent, KIRA_HOME } from "./consent.js";
import { sanitize } from "./sanitize.js";

const MISSES_LOG = join(KIRA_HOME, "misses.log");
/** Rotate misses.log once past this size (keeps one .1 generation). */
const MISSES_ROTATE_BYTES = 512 * 1024;

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

/** What almost matched a missed lookup — the alias/keyword gap signal. */
export interface MissNear {
  id: string;
  score: number;
}

/**
 * Log a lookup that returned 0 strict results (flywheel loop B input).
 *
 * Local-only, never uploaded. Written to ~/.kira/misses.log (KIRA_HOME
 * respected) — the old repo-relative ./reports/ path broke for installed
 * packages, where __dirname points inside node_modules/npx caches.
 *
 * The keyword passes the standard sanitizer: a query can embed paths or
 * secrets ("deploy /home/x/proj with KEY=..."), so it is treated like any
 * other free text even though the file never leaves the machine.
 */
export async function logMiss(
  keyword: string,
  context: string[],
  near: MissNear[]
): Promise<void> {
  await mkdir(KIRA_HOME, { recursive: true });
  try {
    const s = await stat(MISSES_LOG);
    if (s.size > MISSES_ROTATE_BYTES) await rename(MISSES_LOG, MISSES_LOG + ".1");
  } catch {
    // First write — no file to rotate.
  }
  const entry = {
    v: 1,
    keyword: sanitize(keyword, 200),
    context: context.slice(0, 8).map((c) => String(c).slice(0, 40)),
    near: near.slice(0, 6),
    ts: new Date().toISOString(),
  };
  await appendFile(MISSES_LOG, JSON.stringify(entry) + "\n", "utf-8");
}

/** Re-exported for tests. */
export { loadConsent };
