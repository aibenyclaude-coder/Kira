/**
 * Generate docs/corpus.json — the bundle the reciprocity-gated worker
 * endpoint (/v1/corpus) serves from raw.githubusercontent.
 *
 * Deterministic (sorted by id, no timestamps): CI regenerates and fails if
 * the committed bundle is stale, exactly like docs/stats.json.
 *
 * Usage:  node scripts/gen-corpus.mjs          # write docs/corpus.json
 *         node scripts/gen-corpus.mjs --check  # exit 1 if stale
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs", "corpus.json");

function loadDir(dir) {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(readFileSync(join(dir, f), "utf-8")));
  } catch {
    return [];
  }
}

const byId = (a, b) => String(a.id).localeCompare(String(b.id));

const bundle = {
  v: 1,
  skills: [
    ...loadDir(join(ROOT, "skills", "community")),
    ...loadDir(join(ROOT, "skills", "vendor")),
  ].sort(byId),
  scars: loadDir(join(ROOT, "skills", "scars")).sort(byId),
};

const rendered = JSON.stringify(bundle, null, 2) + "\n";

if (process.argv.includes("--check")) {
  let committed = "";
  try {
    committed = readFileSync(OUT, "utf-8");
  } catch {
    // missing counts as stale
  }
  if (committed !== rendered) {
    console.error("[gen-corpus] docs/corpus.json is stale — run: node scripts/gen-corpus.mjs");
    process.exit(1);
  }
  console.log("[gen-corpus] docs/corpus.json is fresh");
} else {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, rendered, "utf-8");
  console.log(
    `[gen-corpus] wrote ${OUT} (skills=${bundle.skills.length}, scars=${bundle.scars.length})`
  );
}
