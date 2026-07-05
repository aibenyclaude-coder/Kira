/**
 * Generate docs/stats.json — the number behind the README "scars absorbed"
 * badge and the public proof that the corpus is alive.
 *
 * Deterministic on purpose (no timestamps): CI regenerates and fails if the
 * committed file is stale, so the badge can never silently lie.
 *
 * Usage:  node scripts/gen-stats.mjs          # write docs/stats.json
 *         node scripts/gen-stats.mjs --check  # exit 1 if committed file is stale
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs", "stats.json");

function loadDir(dir) {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(readFileSync(join(dir, f), "utf-8")));
  } catch {
    return [];
  }
}

const scars = loadDir(join(ROOT, "skills", "scars"));
const community = loadDir(join(ROOT, "skills", "community"));
const vendor = loadDir(join(ROOT, "skills", "vendor"));

const stats = {
  community_scars: scars.length,
  community_skills: community.length,
  vendor_skills: vendor.length,
  total_scar_hits: scars.reduce((s, x) => s + (Number(x.hit_count) || 0), 0),
  critical_scars: scars.filter((x) => x.severity === "critical").length,
};

const rendered = JSON.stringify(stats, null, 2) + "\n";

if (process.argv.includes("--check")) {
  let committed = "";
  try {
    committed = readFileSync(OUT, "utf-8");
  } catch {
    // missing counts as stale
  }
  if (committed !== rendered) {
    console.error("[gen-stats] docs/stats.json is stale — run: node scripts/gen-stats.mjs");
    process.exit(1);
  }
  console.log("[gen-stats] docs/stats.json is fresh");
} else {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, rendered, "utf-8");
  console.log("[gen-stats] wrote", OUT, JSON.stringify(stats));
}
