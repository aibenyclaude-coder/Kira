import { appendFile, readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ReportRequest, ReportResponse, Scar } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");
const REPORTS_DIR = join(PROJECT_ROOT, "reports");
const SCARS_DIR = join(PROJECT_ROOT, "skills", "scars");
const LOG_FILE = join(REPORTS_DIR, "reports.log");
const MISSING_LOG = join(REPORTS_DIR, "missing-keywords.log");

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

  // Update scar hit_counts from real data (retry/failure increments matching scars)
  if (request.status === "retry" || request.status === "failure") {
    incrementScarHitCounts(request.skill_id).catch(() => {});
  }

  return { ack: true, recorded_at };
}

/**
 * When an agent reports retry/failure on a skill, increment hit_count
 * on any scars that share keywords with that skill.
 * This makes hit_count a real metric, not an estimate.
 */
async function incrementScarHitCounts(skillId: string): Promise<void> {
  let scarFiles: string[];
  try {
    scarFiles = (await readdir(SCARS_DIR)).filter((f) => f.endsWith(".json"));
  } catch {
    return;
  }

  // Extract the keyword hint from skill_id: "community.setup-prisma-nextjs.v1" → "prisma"
  const slug = skillId.split(".")[1] ?? "";
  const keywordHint = slug
    .replace(/^setup-/, "")
    .replace(/^deploy-/, "")
    .replace(/-nextjs$/, "")
    .replace(/-nodejs$/, "")
    .split("-")[0];

  if (!keywordHint) return;

  for (const file of scarFiles) {
    const path = join(SCARS_DIR, file);
    try {
      const raw = await readFile(path, "utf-8");
      const scar = JSON.parse(raw) as Scar;
      const matches = scar.keywords.some(
        (k) => k.toLowerCase().includes(keywordHint)
      );
      if (matches) {
        scar.hit_count += 1;
        await writeFile(path, JSON.stringify(scar, null, 2) + "\n", "utf-8");
      }
    } catch {
      // Skip malformed files
    }
  }
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
