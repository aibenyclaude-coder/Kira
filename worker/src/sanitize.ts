/**
 * Worker-side sanitizer.
 *
 * Mirrors the client patterns in src/sanitize.ts. Kept as a separate copy
 * so the Worker has zero dependencies on the parent TypeScript project at
 * build time. Any pattern change must update BOTH files.
 */

const REDACT = "[REDACTED]";

const PATTERNS: Array<[RegExp, string]> = [
  [/\bsk-[A-Za-z0-9_-]{20,}\b/g, REDACT],
  [/\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/g, REDACT],
  [/\bghp_[A-Za-z0-9]{30,}\b/g, REDACT],
  [/\bghs_[A-Za-z0-9]{30,}\b/g, REDACT],
  [/\bgithub_pat_[A-Za-z0-9_]{40,}\b/g, REDACT],
  [/\bxox[bpars]-[A-Za-z0-9-]{10,}\b/g, REDACT],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, REDACT],
  [/\bAKIA[0-9A-Z]{16}\b/g, REDACT],
  [/\b[a-f0-9]{40,}\b/gi, REDACT],
  [/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, "[EMAIL]"],
  [/(?<![\w.])\d{1,3}(\.\d{1,3}){3}(?![\w.])/g, "[IP]"],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[UUID]"],
  [/\/(?:home|Users)\/[^\s/"']+/g, "/[USER]"],
  [/[A-Za-z]:\\Users\\[^\\\s"']+/g, "C:\\[USER]"],
  [/(?<![A-Za-z0-9_:/])\/(?:[\w.-]+\/){2,}[\w.-]+/g, "[PATH]"],
  [/\b([A-Z][A-Z0-9_]{2,})=([^\s'"]+)/g, "$1=[REDACTED]"],
];

export function sanitize(s: string | undefined | null, maxLen: number): string | undefined {
  if (s === undefined || s === null) return undefined;
  let out = s.length > maxLen ? s.slice(0, maxLen) : s;
  for (const [re, repl] of PATTERNS) out = out.replace(re, repl);
  return out;
}
