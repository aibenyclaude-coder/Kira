#!/usr/bin/env node
/**
 * Privacy demo — shows what Kira's sanitizer does to free-text fields
 * BEFORE anything is written to disk or sent over the network.
 *
 * Run: npm run demo:privacy
 *
 * No secrets in this file are real — they are placeholder shapes.
 */
import { sanitize } from "./sanitize.js";

const RESET = "\x1b[0m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";

const cases = [
  {
    label: "OpenAI API key",
    input: "deploy failed; OPENAI_KEY=sk-NOTREALNOTREALNOTREALNOTREALNOT broke",
  },
  {
    label: "GitHub token + home path",
    input:
      "wrangler login error in /home/alice/projects/my-app with ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  },
  {
    label: "JWT in Authorization header",
    input:
      "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk failed",
  },
  {
    label: "Stripe secret",
    input: "STRIPE_SECRET_KEY=sk_live_AAAAAAAAAAAAAAAA webhook 401",
  },
  {
    label: "Email + IP + UUID",
    input:
      "user 550e8400-e29b-41d4-a716-446655440000 (alice@example.com) from 192.168.1.42",
  },
  {
    label: "Windows path",
    input: "C:\\Users\\Alice\\Documents\\config.json missing",
  },
];

function diff(before: string, after: string): string {
  // Highlight every change region.
  const len = Math.max(before.length, after.length);
  let result = "";
  let i = 0;
  while (i < len) {
    if (before[i] === after[i]) {
      result += `${DIM}${after[i] ?? ""}${RESET}`;
      i += 1;
    } else {
      // find next equal char
      let j = i;
      while (j < len && before[j] !== after[j]) j += 1;
      result += `${GREEN}${BOLD}${after.slice(i, j)}${RESET}`;
      i = j;
    }
  }
  return result;
}

console.log(`${BOLD}Kira sanitizer — what leaves your machine?${RESET}\n`);

for (const c of cases) {
  const out = sanitize(c.input, 4096) ?? "";
  console.log(`${BOLD}${c.label}${RESET}`);
  console.log(`  ${RED}before:${RESET} ${c.input}`);
  console.log(`  ${GREEN}after:${RESET}  ${diff(c.input, out)}`);
  console.log();
}

console.log(
  `${DIM}Sanitizer runs locally before write AND server-side before D1 insert.\n` +
    `Full schema and opt-out: PRIVACY.md${RESET}`
);
