/**
 * Worker-side sanitizer.
 *
 * Mirrors the client patterns in src/sanitize.ts. Kept as a separate copy
 * so the Worker has zero dependencies on the parent TypeScript project at
 * build time. Any pattern change must update BOTH files.
 *
 * `PATTERNS` is exported so tests/sanitize.test.ts can compare the two lists
 * ENTRY BY ENTRY — name, regex source, regex flags, replacement source text —
 * rather than infer parity from whichever inputs someone thought to sample.
 * That inference is how the last divergence survived: the carve-outs below
 * were expressed client-side as functions and left here as plain `$1` strings,
 * so this copy went on redacting five shapes the client had already stopped
 * redacting, and no sample carried one.
 */

const REDACT = "[REDACTED]";

/** Mirrors SYSTEMD_UNIT_TAIL in src/sanitize.ts — see the note there. */
const SYSTEMD_UNIT_TAIL =
  /@[\w-]+\.(?:service|socket|device|mount|automount|swap|path|timer|slice|scope)$/;

/**
 * Mirrors `Rule` in src/sanitize.ts. `repl` is a function in every entry, even
 * where a constant would do, because the parity test compares replacements as
 * SOURCE TEXT — a shape that cannot be written two ways cannot silently drift.
 */
interface Rule {
  name: string;
  re: RegExp;
  repl: (match: string, ...groups: string[]) => string;
}

export const PATTERNS: Rule[] = [
  { name: "sk-token", re: /\bsk-[A-Za-z0-9_-]{20,}\b/g, repl: () => REDACT },
  { name: "stripe-key", re: /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/g, repl: () => REDACT },
  { name: "github-token", re: /\bghp_[A-Za-z0-9]{30,}\b/g, repl: () => REDACT },
  { name: "github-token", re: /\bghs_[A-Za-z0-9]{30,}\b/g, repl: () => REDACT },
  { name: "github-token", re: /\bgithub_pat_[A-Za-z0-9_]{40,}\b/g, repl: () => REDACT },
  { name: "slack-token", re: /\bxox[bpars]-[A-Za-z0-9-]{10,}\b/g, repl: () => REDACT },
  {
    name: "jwt",
    re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    repl: () => REDACT,
  },
  { name: "aws-access-key-id", re: /\bAKIA[0-9A-Z]{16}\b/g, repl: () => REDACT },
  { name: "long-hex", re: /\b[a-f0-9]{40,}\b/gi, repl: () => REDACT },
  // A TLD is never all digits, so `pkg@1.2.3` is not an address; the second
  // alternative keeps bare-IP domains, and a systemd template unit is spared.
  // See src/sanitize.ts for the full note.
  {
    name: "email",
    re: /\b[\w.+-]+@(?:[\w-]+\.)+[A-Za-z]{2,}\b|\b[\w.+-]+@\d{1,3}(?:\.\d{1,3}){3}\b/g,
    repl: (m) => (SYSTEMD_UNIT_TAIL.test(m) ? m : "[EMAIL]"),
  },
  { name: "ipv4", re: /(?<![\w.])\d{1,3}(\.\d{1,3}){3}(?![\w.])/g, repl: () => "[IP]" },
  {
    name: "uuid",
    re: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
    repl: () => "[UUID]",
  },
  { name: "home-path", re: /\/(?:home|Users)\/[^\s/"']+/g, repl: () => "/[USER]" },
  { name: "home-path", re: /[A-Za-z]:\\Users\\[^\\\s"']+/g, repl: () => "C:\\[USER]" },
  {
    name: "deep-path",
    re: /(?<![A-Za-z0-9_:/])\/(?:[\w.-]+\/){2,}[\w.-]+/g,
    repl: () => "[PATH]",
  },
  // A shell expansion is a reference to a value, and a value with no ASCII
  // alphanumeric carries no credential material. See src/sanitize.ts.
  {
    name: "env-assignment",
    re: /\b([A-Z][A-Z0-9_]{2,})=([^\s'"]+)/g,
    repl: (m, key, value) =>
      value.startsWith("$") || !/[A-Za-z0-9]/.test(value) ? m : `${key}=${REDACT}`,
  },
];

export function sanitize(s: string | undefined | null, maxLen: number): string | undefined {
  if (s === undefined || s === null) return undefined;
  let out = s.length > maxLen ? s.slice(0, maxLen) : s;
  for (const { re, repl } of PATTERNS) out = out.replace(re, repl);
  return out;
}
