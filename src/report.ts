import { appendFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ReportRequest, ReportResponse } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// At runtime this file lives in dist/, so one "..": dist → project root.
const REPORTS_DIR = join(__dirname, "..", "reports");
const LOG_FILE = join(REPORTS_DIR, "reports.log");

/**
 * Record the outcome of applying a Skill.
 *
 * v0.1: append-only local log.
 * v2.0: this becomes the input to the distributed nervous system
 *       (DESIGN.md §4 — alerts on repeated retries, broadcast resolutions).
 */
export async function record(request: ReportRequest): Promise<ReportResponse> {
  await mkdir(REPORTS_DIR, { recursive: true });

  const recorded_at = new Date().toISOString();
  const entry = { ...request, recorded_at };

  await appendFile(LOG_FILE, JSON.stringify(entry) + "\n", "utf-8");

  return { ack: true, recorded_at };
}
