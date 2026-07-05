/**
 * Kira micro-benchmark — lookup / route hot paths with a regression budget.
 *
 *   npm run bench
 *
 * Loads the real skill/scar/route corpus, times the matcher on a handful of
 * representative queries, and compares each median latency against a budget
 * ceiling (see bench/README.md). Any benchmark over budget sets a non-zero
 * exit code, so a genuine regression trips a pre-commit gate or manual run.
 *
 * The harness has no dependencies beyond node:perf_hooks and self-calibrates
 * batch size to BATCH_TARGET_MS, so per-op numbers stay stable across machines.
 * Budgets carry deliberate headroom over the reference baseline so they fire on
 * algorithmic regressions (e.g. an accidental O(n²) matcher), not on ordinary
 * machine-to-machine jitter.
 */
import { performance } from "node:perf_hooks";
import { indexItems, lookup } from "../src/lookup.js";
import { resolveRoute, loadRoutes } from "../src/route.js";
import { loadAllSkills, loadAllScars } from "../src/index-loader.js";
import type { LookupRequest, RouteRequest } from "../src/types.js";

// ── Tunables ────────────────────────────────────────────────────────────
// Batches per benchmark. More samples = steadier median at the cost of runtime.
const SAMPLES = Math.max(10, Number(process.env.KIRA_BENCH_SAMPLES) || 60);
// Discard the first WARMUP_MS of calls so V8's JIT has settled before timing.
const WARMUP_MS = 100;
// Each timed batch is auto-sized to run for roughly this long.
const BATCH_TARGET_MS = 5;

// ── Stats ───────────────────────────────────────────────────────────────
interface Stat {
  name: string;
  median: number; // µs/op
  p95: number; // µs/op
  min: number; // µs/op
  opsPerSec: number;
  budget: number; // µs/op ceiling
  overBudget: boolean;
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx]!;
}

/**
 * Time `fn` and return µs/op stats. Self-calibrates batch size from the warmup
 * rate so each timed batch runs ~BATCH_TARGET_MS regardless of machine speed,
 * then collects SAMPLES batches and reports the distribution.
 */
function bench(name: string, budgetUs: number, fn: () => void): Stat {
  // Warmup — run for a fixed wall-clock window and count the calls.
  const warmEnd = performance.now() + WARMUP_MS;
  let warmCalls = 0;
  while (performance.now() < warmEnd) {
    fn();
    warmCalls++;
  }

  // Size a batch so it takes ~BATCH_TARGET_MS based on the observed rate.
  const perCallMs = WARMUP_MS / Math.max(warmCalls, 1);
  const batch = Math.max(1, Math.round(BATCH_TARGET_MS / perCallMs));

  const usPerOp: number[] = [];
  for (let s = 0; s < SAMPLES; s++) {
    const t0 = performance.now();
    for (let i = 0; i < batch; i++) fn();
    usPerOp.push(((performance.now() - t0) / batch) * 1000);
  }
  usPerOp.sort((a, b) => a - b);

  const median = percentile(usPerOp, 50);
  return {
    name,
    median,
    p95: percentile(usPerOp, 95),
    min: usPerOp[0]!,
    opsPerSec: 1e6 / median,
    budget: budgetUs,
    overBudget: median > budgetUs,
  };
}

// ── Report formatting ───────────────────────────────────────────────────
const us = (n: number) => `${n.toFixed(2)}µs`;

function printTable(stats: Stat[]): void {
  const rows = stats.map((s) => ({
    name: s.name,
    median: us(s.median),
    p95: us(s.p95),
    ops: `${Math.round(s.opsPerSec).toLocaleString("en-US")}/s`,
    budget: us(s.budget),
    // How much of the budget this benchmark consumes — low = lots of headroom.
    status: s.overBudget
      ? `OVER (${Math.round((s.median / s.budget) * 100)}%)`
      : `ok (${Math.round((s.median / s.budget) * 100)}%)`,
  }));

  const cols: Array<[keyof (typeof rows)[number], string]> = [
    ["name", "benchmark"],
    ["median", "median"],
    ["p95", "p95"],
    ["ops", "ops/sec"],
    ["budget", "budget"],
    ["status", "status"],
  ];
  const width = (key: keyof (typeof rows)[number], header: string) =>
    Math.max(header.length, ...rows.map((r) => r[key].length));
  const widths = cols.map(([key, header]) => width(key, header));

  const line = (cells: string[]) =>
    cells.map((c, i) => c.padEnd(widths[i]!)).join("  ");

  console.log(line(cols.map(([, header]) => header)));
  console.log(widths.map((w) => "─".repeat(w)).join("  "));
  for (const r of rows) console.log(line(cols.map(([key]) => r[key])));
}

// ── Scenarios ───────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const [rawSkills, rawScars, routes] = await Promise.all([
    loadAllSkills(),
    loadAllScars(),
    loadRoutes(),
  ]);
  const skills = indexItems(rawSkills);
  const scars = indexItems(rawScars);

  const L = (req: LookupRequest) => () => lookup(skills, scars, req);
  const R = (req: RouteRequest) => () => resolveRoute(routes, skills, scars, req);

  console.log("\nKira micro-benchmark — lookup / route");
  console.log(
    `corpus: ${skills.length} skills · ${scars.length} scars · ${routes.length} routes` +
      `   (samples=${SAMPLES}, node ${process.version})\n`
  );

  // Budgets (µs/op) carry ~4× headroom over the reference baseline documented
  // in bench/README.md. Median is gated; p95 is shown for insight only.
  const stats: Stat[] = [
    // Lookup: warm hit, filtered by a project context.
    bench("lookup · hit + context", 250, L({ keyword: "deploy vercel", context: ["nextjs"] })),
    // Lookup: hit with no context filter (scans every item).
    bench("lookup · hit, no context", 250, L({ keyword: "stripe" })),
    // Lookup: miss — exercises the fallback suggestion scan over all skills.
    bench("lookup · miss + suggest", 600, L({ keyword: "colonize the red planet" })),
    // Route: light goal → 2 steps, each resolved via lookup.
    bench("route · light (2 steps)", 500, R({ goal: "add payments", context: ["nextjs"] })),
    // Route: heaviest goal → 11 steps; the lookup hot path amplified.
    bench("route · heavy (11 steps)", 2500, R({ goal: "build a saas", context: ["nextjs"] })),
    // Route: miss — no matching route, cheapest path.
    bench("route · miss", 200, R({ goal: "colonize the red planet" })),
  ];

  printTable(stats);

  const over = stats.filter((s) => s.overBudget);
  console.log("");
  if (over.length > 0) {
    for (const s of over) {
      console.log(`  ✗ ${s.name}: ${us(s.median)} exceeds budget ${us(s.budget)}`);
    }
    console.log(`\nBUDGET: FAIL — ${over.length}/${stats.length} over budget (regression)\n`);
    process.exitCode = 1;
    return;
  }
  console.log(`BUDGET: PASS — ${stats.length}/${stats.length} within budget\n`);
}

main().catch((err) => {
  console.error("\n✗ bench failed:", err);
  process.exit(1);
});
