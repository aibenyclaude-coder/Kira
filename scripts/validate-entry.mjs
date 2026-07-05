/**
 * Shared corpus-entry validation — single source of truth for:
 *   - tests/corpus-lint.test.ts  (every shipped skill/scar must pass)
 *   - scripts/scar-intake.mjs    (community submissions must pass)
 *
 * Returns an array of human-readable issue strings; empty = valid.
 * The optional `sanitize` function (src/sanitize.ts) enables the
 * poisoning/leak gate: any field the sanitizer would rewrite is rejected —
 * corpus text must contain nothing secret-shaped to begin with.
 */

const SCAR_ID = /^scar\.[a-z0-9][a-z0-9-]*\.v\d+$/;
const SKILL_ID = /^(community|vendor)\.[a-z0-9][a-z0-9-]*\.v\d+$/;
const SEMVER = /^\d+\.\d+\.\d+$/;

function isStringArray(v) {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function checkSanitizeStable(issues, obj, fields, sanitize) {
  if (!sanitize) return;
  for (const f of fields) {
    const v = obj[f];
    if (typeof v !== "string") continue;
    const out = sanitize(v, Math.max(v.length + 10, 8000));
    if (out !== v) {
      issues.push(
        `${f}: sanitizer would redact content — remove secrets/private paths/emails before submitting`
      );
    }
  }
}

// Skill INSTRUCTIONS legitimately teach `KEY=value` placeholders and example
// paths, so full sanitize-stability over-fires there. Gate instructions on
// live-looking token shapes only — placeholders (sk-XXXX, <YOUR_KEY>) pass.
const HARD_SECRET_PATTERNS = [
  [/sk-[A-Za-z0-9]{24,}/, "OpenAI/Stripe-style live key"],
  [/ghp_[A-Za-z0-9]{30,}/, "GitHub token"],
  [/gho_[A-Za-z0-9]{30,}/, "GitHub OAuth token"],
  [/AKIA[0-9A-Z]{16}/, "AWS access key id"],
  [/xox[bap]-[A-Za-z0-9-]{10,}/, "Slack token"],
  [/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/, "JWT"],
];

function checkHardSecrets(issues, obj, fields) {
  for (const f of fields) {
    const v = obj[f];
    if (typeof v !== "string") continue;
    for (const [re, label] of HARD_SECRET_PATTERNS) {
      if (re.test(v)) {
        issues.push(`${f}: contains a live-looking ${label} — replace with a placeholder`);
      }
    }
  }
}

export function validateScar(o, { sanitize } = {}) {
  const issues = [];
  if (!o || typeof o !== "object") return ["not a JSON object"];

  if (typeof o.id !== "string" || !SCAR_ID.test(o.id))
    issues.push(`id: must match ${SCAR_ID} (got ${JSON.stringify(o.id)})`);
  if (!isStringArray(o.keywords) || o.keywords.length < 3)
    issues.push("keywords: need 3+ string variants an agent would search");
  if (!isStringArray(o.contexts))
    issues.push("contexts: must be a string array (may be empty = universal)");
  if (typeof o.title !== "string" || o.title.length < 8 || o.title.length > 200)
    issues.push("title: 8..200 chars");
  if (typeof o.summary !== "string" || o.summary.length < 8 || o.summary.length > 300)
    issues.push("summary: 8..300 chars");
  if (o.severity !== "warning" && o.severity !== "critical")
    issues.push("severity: 'warning' | 'critical'");
  if (typeof o.mistake !== "string" || o.mistake.length < 40)
    issues.push("mistake: concrete description required (40+ chars)");
  if (typeof o.instead !== "string" || o.instead.length < 40)
    issues.push("instead: concrete avoidance strategy required (40+ chars)");
  if (!Number.isInteger(o.hit_count) || o.hit_count < 1)
    issues.push("hit_count: integer >= 1 (honest counts only)");
  if (typeof o.version !== "string" || !SEMVER.test(o.version))
    issues.push("version: semver string");
  if (typeof o.updated_at !== "string" || Number.isNaN(Date.parse(o.updated_at)))
    issues.push("updated_at: ISO-8601 date");

  checkSanitizeStable(issues, o, ["title", "summary", "mistake", "instead"], sanitize);
  return issues;
}

export function validateSkill(o, { sanitize } = {}) {
  const issues = [];
  if (!o || typeof o !== "object") return ["not a JSON object"];

  if (typeof o.id !== "string" || !SKILL_ID.test(o.id))
    issues.push(`id: must match ${SKILL_ID} (got ${JSON.stringify(o.id)})`);
  if (!isStringArray(o.keywords) || o.keywords.length < 3)
    issues.push("keywords: need 3+ string variants");
  if (!isStringArray(o.contexts)) issues.push("contexts: must be a string array");
  if (typeof o.title !== "string" || o.title.length < 8)
    issues.push("title: required (8+ chars)");
  if (typeof o.summary !== "string" || o.summary.length < 8)
    issues.push("summary: required (8+ chars)");
  if (o.source !== "community" && o.source !== "vendor")
    issues.push("source: 'community' | 'vendor'");
  if (typeof o.declaration !== "string" || o.declaration.length < 20)
    issues.push("declaration: required (what the agent announces before executing)");
  if (typeof o.instructions !== "string" || o.instructions.length < 100)
    issues.push("instructions: required markdown (100+ chars)");
  else if (!o.instructions.includes("What NOT"))
    issues.push("instructions: must include a 'What NOT to do' section");
  if (typeof o.version !== "string" || !SEMVER.test(o.version))
    issues.push("version: semver string");
  if (typeof o.updated_at !== "string" || Number.isNaN(Date.parse(o.updated_at)))
    issues.push("updated_at: ISO-8601 date");

  checkSanitizeStable(issues, o, ["title", "summary", "declaration"], sanitize);
  checkHardSecrets(issues, o, ["instructions"]);
  return issues;
}
