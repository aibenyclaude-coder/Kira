/**
 * Generate docs/stats.json — the number behind the README "scars absorbed"
 * badge and the public proof that the corpus is alive — and keep the corpus
 * counts quoted in README.md prose in sync with it.
 *
 * Deterministic on purpose (no timestamps): CI regenerates and fails if the
 * committed file is stale, so the badge can never silently lie.
 *
 * README.md ships inside the npm tarball (package.json `files`), so its prose
 * is the npmjs.com package page too. Those numbers used to be hand-maintained
 * and rotted at every release: v0.8.2 advertised "34 community skills and 12
 * community scars" while that same tarball shipped 38 skills and 27 scars.
 *
 * Usage:  node scripts/gen-stats.mjs          # write docs/stats.json + sync README.md
 *         node scripts/gen-stats.mjs --check  # exit 1 if either is stale
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs", "stats.json");
const README = join(ROOT, "README.md");

/**
 * Sites in README.md prose that must track the corpus.
 *
 * Each rule is `<number><suffix>`, where `suffix` is a plain literal chosen to
 * be unique in the file — never a bare " community scars", because README.md
 * also states the grace-mode threshold ("until the corpus reaches 100 community
 * scars"), which is a policy constant and must NOT be rewritten to the count.
 *
 * A rule that does not match EXACTLY once is a hard error rather than a silent
 * skip: rewording the pitch sentence must fail loudly here, not quietly stop
 * gating the number.
 */
const README_RULES = [
  { key: "community_skills", suffix: " community skills across" },
  { key: "community_scars", suffix: " community scars — real failure patterns" },
];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");

/**
 * Rewrite the README corpus counts from `stats`.
 * Returns the updated text plus any rules that failed to match exactly once.
 */
export function syncReadme(text, stats) {
  let out = text;
  const problems = [];
  for (const { key, suffix } of README_RULES) {
    const re = new RegExp("\\d+" + escapeRe(suffix), "g");
    const hits = text.match(re) ?? [];
    if (hits.length !== 1) {
      problems.push(
        `README.md: expected exactly 1 site for ${key} ("<n>${suffix}"), found ${hits.length}` +
          " — the prose was reworded; update README_RULES in scripts/gen-stats.mjs",
      );
      continue;
    }
    out = out.replace(re, `${stats[key]}${suffix}`);
  }
  return { text: out, problems };
}

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

export const stats = {
  community_scars: scars.length,
  community_skills: community.length,
  vendor_skills: vendor.length,
  total_scar_hits: scars.reduce((s, x) => s + (Number(x.hit_count) || 0), 0),
  critical_scars: scars.filter((x) => x.severity === "critical").length,
};

const rendered = JSON.stringify(stats, null, 2) + "\n";

// Importing this module (tests) must not write files — only the CLI does.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const readmeBefore = readFileSync(README, "utf-8");
  const { text: readmeAfter, problems } = syncReadme(readmeBefore, stats);

  if (process.argv.includes("--check")) {
    const stale = [];
    let committed = "";
    try {
      committed = readFileSync(OUT, "utf-8");
    } catch {
      // missing counts as stale
    }
    if (committed !== rendered) stale.push("docs/stats.json");
    if (readmeAfter !== readmeBefore) stale.push("README.md");

    if (problems.length || stale.length) {
      for (const p of problems) console.error("[gen-stats]", p);
      if (stale.length) {
        console.error(
          `[gen-stats] ${stale.join(" and ")} stale — run: node scripts/gen-stats.mjs`,
        );
      }
      process.exit(1);
    }
    console.log("[gen-stats] docs/stats.json and README.md are fresh");
  } else {
    // A rule that stopped matching means the README number is no longer gated —
    // fail instead of writing a half-synced file.
    if (problems.length) {
      for (const p of problems) console.error("[gen-stats]", p);
      process.exit(1);
    }
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, rendered, "utf-8");
    if (readmeAfter !== readmeBefore) writeFileSync(README, readmeAfter, "utf-8");
    console.log("[gen-stats] wrote", OUT, JSON.stringify(stats));
    console.log(
      readmeAfter !== readmeBefore
        ? "[gen-stats] synced README.md corpus counts"
        : "[gen-stats] README.md already in sync",
    );
  }
}
