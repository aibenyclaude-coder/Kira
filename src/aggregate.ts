/**
 * Report aggregation + Scar auto-proposal.
 *
 * Reads reports.log, counts retry/failure patterns per keyword,
 * and proposes new Scars when a pattern exceeds the threshold.
 *
 * This is the first rotation of the flywheel:
 * use → report → aggregate → scar proposal → better lookup → use
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");
const REPORTS_DIR = join(PROJECT_ROOT, "reports");
const LOG_FILE = join(REPORTS_DIR, "reports.log");
const AGGREGATE_FILE = join(REPORTS_DIR, "aggregate.json");
const SCAR_PROPOSALS_FILE = join(REPORTS_DIR, "scar-proposals.json");

const RETRY_THRESHOLD = 2; // propose scar after 2 retries on same skill

interface ReportEntry {
  skill_id: string;
  status: "success" | "retry" | "failure";
  note?: string;
  recorded_at: string;
}

interface SkillStats {
  skill_id: string;
  success: number;
  retry: number;
  failure: number;
  total: number;
  success_rate: number;
  retry_notes: string[];
}

interface ScarProposal {
  skill_id: string;
  retry_count: number;
  notes: string[];
  proposed_at: string;
}

function parseReports(raw: string): ReportEntry[] {
  return raw
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as ReportEntry;
      } catch {
        return null;
      }
    })
    .filter((e): e is ReportEntry => e !== null);
}

function aggregateBySkill(entries: ReportEntry[]): Map<string, SkillStats> {
  const stats = new Map<string, SkillStats>();

  for (const entry of entries) {
    let s = stats.get(entry.skill_id);
    if (!s) {
      s = {
        skill_id: entry.skill_id,
        success: 0,
        retry: 0,
        failure: 0,
        total: 0,
        success_rate: 0,
        retry_notes: [],
      };
      stats.set(entry.skill_id, s);
    }

    s.total++;
    if (entry.status === "success") s.success++;
    else if (entry.status === "retry") {
      s.retry++;
      if (entry.note) s.retry_notes.push(entry.note);
    } else if (entry.status === "failure") {
      s.failure++;
      if (entry.note) s.retry_notes.push(entry.note);
    }

    s.success_rate = s.total > 0 ? Math.round((s.success / s.total) * 100) : 0;
  }

  return stats;
}

function proposeScarCandidates(stats: Map<string, SkillStats>): ScarProposal[] {
  const proposals: ScarProposal[] = [];

  for (const [, s] of stats) {
    if (s.retry + s.failure >= RETRY_THRESHOLD && s.retry_notes.length > 0) {
      proposals.push({
        skill_id: s.skill_id,
        retry_count: s.retry + s.failure,
        notes: s.retry_notes,
        proposed_at: new Date().toISOString(),
      });
    }
  }

  return proposals.sort((a, b) => b.retry_count - a.retry_count);
}

/**
 * Run the aggregation pipeline.
 * Called by patrol jobs or manually via `node dist/aggregate.js`.
 */
export async function runAggregation(): Promise<{
  stats: SkillStats[];
  proposals: ScarProposal[];
}> {
  let raw: string;
  try {
    raw = await readFile(LOG_FILE, "utf-8");
  } catch {
    return { stats: [], proposals: [] };
  }

  const entries = parseReports(raw);
  const statsMap = aggregateBySkill(entries);
  const stats = Array.from(statsMap.values()).sort(
    (a, b) => a.success_rate - b.success_rate
  );
  const proposals = proposeScarCandidates(statsMap);

  await mkdir(REPORTS_DIR, { recursive: true });
  await writeFile(AGGREGATE_FILE, JSON.stringify(stats, null, 2), "utf-8");
  await writeFile(
    SCAR_PROPOSALS_FILE,
    JSON.stringify(proposals, null, 2),
    "utf-8"
  );

  return { stats, proposals };
}

// CLI entrypoint
if (process.argv[1]?.endsWith("aggregate.js")) {
  runAggregation().then(({ stats, proposals }) => {
    console.log(`[aggregate] ${stats.length} skills tracked`);
    for (const s of stats) {
      console.log(
        `  ${s.skill_id}: ${s.success_rate}% success (${s.success}/${s.total}) | ${s.retry} retries`
      );
    }
    if (proposals.length > 0) {
      console.log(`\n[scar-proposals] ${proposals.length} candidates:`);
      for (const p of proposals) {
        console.log(`  ⚠ ${p.skill_id} (${p.retry_count} retries)`);
        for (const note of p.notes) {
          console.log(`    "${note}"`);
        }
      }
    } else {
      console.log("\n[scar-proposals] No candidates (threshold: 2+ retries)");
    }
  });
}
