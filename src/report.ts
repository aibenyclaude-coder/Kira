import { appendFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ReportRequest, ReportResponse } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");
const REPORTS_DIR = join(PROJECT_ROOT, "reports");
const LOG_FILE = join(REPORTS_DIR, "reports.log");
const MISSING_LOG = join(REPORTS_DIR, "missing-keywords.log");

/**
 * Record the outcome of applying a Skill.
 *
 * Append-only local log. hit_count updates are derived at aggregate
 * time (npm run aggregate), not per-report. This avoids race conditions
 * and false-positive keyword matching.
 */
export async function record(request: ReportRequest): Promise<ReportResponse> {
  await mkdir(REPORTS_DIR, { recursive: true });

  const recorded_at = new Date().toISOString();
  const entry = { ...request, recorded_at };

  await appendFile(LOG_FILE, JSON.stringify(entry) + "\n", "utf-8");

  return { ack: true, recorded_at };
}

/**
 * Log a keyword that returned 0 results from lookup.
 * Patrol jobs read this to discover demand for new skills.
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
