/**
 * Scar-submission intake — runs in the scar-intake GitHub workflow.
 *
 * Reads the issue body from the ISSUE_BODY env var (safe injection path: the
 * body never touches a shell), extracts the first ```json fence, validates it
 * with the same rules the shipped corpus must pass (validate-entry.mjs +
 * sanitizer from dist/), and writes:
 *   - intake-result.md   — the comment the workflow posts on the issue
 *   - GITHUB_OUTPUT verdict=valid|invalid  — drives labeling
 *
 * Exit code is 0 in both verdicts (an invalid submission is a normal outcome,
 * not a CI failure).
 */
import { writeFileSync, appendFileSync } from "node:fs";
import { validateScar } from "./validate-entry.mjs";
import { sanitize } from "../dist/sanitize.js";

const body = process.env.ISSUE_BODY ?? "";

function setOutput(verdict) {
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `verdict=${verdict}\n`);
  }
}

function finish(verdict, markdown) {
  writeFileSync("intake-result.md", markdown, "utf-8");
  setOutput(verdict);
  console.log(`[scar-intake] verdict=${verdict}`);
}

const fence = body.match(/```json\s*\n([\s\S]*?)```/);
if (!fence) {
  finish(
    "invalid",
    [
      "## ❌ Scar intake — no JSON found",
      "",
      "I could not find a ` ```json ` block in this issue. Paste the scar as a fenced JSON block (the `kira_share_scar` tool produces one), then edit the issue — I re-run on every edit.",
    ].join("\n")
  );
  process.exit(0);
}

let scar;
try {
  scar = JSON.parse(fence[1]);
} catch (e) {
  finish(
    "invalid",
    [
      "## ❌ Scar intake — JSON does not parse",
      "",
      "```",
      String(e.message).slice(0, 300),
      "```",
      "",
      "Fix the JSON and edit the issue — I re-run on every edit.",
    ].join("\n")
  );
  process.exit(0);
}

const issues = validateScar(scar, { sanitize });

if (issues.length > 0) {
  finish(
    "invalid",
    [
      "## ❌ Scar intake — validation failed",
      "",
      ...issues.map((i) => `- ${i}`),
      "",
      "These are the same rules every shipped scar passes (`scripts/validate-entry.mjs`). Fix and edit the issue — I re-run on every edit.",
    ].join("\n")
  );
  process.exit(0);
}

const filename = `skills/scars/${scar.id.replace(/^scar\./, "").replace(/\.v\d+$/, "")}.json`;
finish(
  "valid",
  [
    "## ✅ Scar intake — valid submission",
    "",
    `Passes every corpus rule. Suggested file: \`${filename}\``,
    "",
    "```json",
    JSON.stringify(scar, null, 2),
    "```",
    "",
    "**Maintainer:** review the content (is it real? general? is `instead` executable?), then commit the block above as the suggested file with message `add scar: " +
      String(scar.title).replace(/"/g, "'") +
      "`. On merge, the submitter earns contributor status.",
  ].join("\n")
);
