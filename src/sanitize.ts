/**
 * Pure, dependency-free text sanitizer.
 *
 * Runs on the client before local log write AND before network send.
 * The Worker re-runs the same patterns server-side as defense in depth.
 *
 * Idempotent: sanitize(sanitize(x)) === sanitize(x).
 */

import type { ReportPayloadV1 } from "./types.js";

const REDACT = "[REDACTED]";

/**
 * One redaction rule. `name` is stable and caller-facing: it is reported back
 * by `sanitizeWithReport` so a caller can tell WHICH rule rewrote its text.
 * Renaming one changes an observable contract — treat names as API.
 *
 * `repl` is a function rather than a `$1`-style template so that a replacement
 * can be compared against the text it replaces: re-sanitizing already-redacted
 * text still MATCHES (`HOME=[REDACTED]` matches the env rule again) but changes
 * nothing, and reporting that as a rewrite would be a false alarm.
 */
interface Rule {
  name: string;
  re: RegExp;
  repl: (match: string, ...groups: string[]) => string;
}

const PATTERNS: Rule[] = [
  // ── Token shapes (run before generic hex / KEY=value) ─────────────────
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
  // long hex (sha-1+, hex secrets)
  { name: "long-hex", re: /\b[a-f0-9]{40,}\b/gi, repl: () => REDACT },

  // ── Identity ─────────────────────────────────────────────────────────
  { name: "email", re: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, repl: () => "[EMAIL]" },
  { name: "ipv4", re: /(?<![\w.])\d{1,3}(\.\d{1,3}){3}(?![\w.])/g, repl: () => "[IP]" },
  {
    name: "uuid",
    re: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
    repl: () => "[UUID]",
  },

  // ── Paths ────────────────────────────────────────────────────────────
  { name: "home-path", re: /\/(?:home|Users)\/[^\s/"']+/g, repl: () => "/[USER]" },
  { name: "home-path", re: /[A-Za-z]:\\Users\\[^\\\s"']+/g, repl: () => "C:\\[USER]" },
  // Generic deep POSIX-like paths (3+ segments, conservative to avoid URLs)
  {
    name: "deep-path",
    re: /(?<![A-Za-z0-9_:/])\/(?:[\w.-]+\/){2,}[\w.-]+/g,
    repl: () => "[PATH]",
  },

  // ── KEY=value assignments (after token patterns above) ───────────────
  {
    name: "env-assignment",
    re: /\b([A-Z][A-Z0-9_]{2,})=([^\s'"]+)/g,
    repl: (_m, key) => `${key}=${REDACT}`,
  },
];

/** One rule that fired, and how many spans it rewrote. */
export interface RedactionHit {
  /** Stable `Rule.name`, e.g. "email" or "env-assignment". */
  pattern: string;
  count: number;
}

/** What `sanitizeWithReport` observed while cleaning one string. */
export interface SanitizeReport {
  /** Rules that fired, in the order they ran. Empty when nothing changed. */
  hits: RedactionHit[];
  /** True when the input exceeded `maxLen` and the tail was dropped. */
  truncated: boolean;
}

/**
 * Sanitize a single string AND report what changed.
 *
 * Redaction is deliberately aggressive, so it also fires on text that is not a
 * secret — `pkg@1.2.3` reads as an email, `JST=UTC+9` as an env assignment.
 * That is an acceptable trade on the network path, but on a write path it
 * silently rewrites the caller's own words, so callers that store text need to
 * be able to SEE the rewrite. This is the reporting entry point; `sanitize`
 * below is the same thing with the report dropped.
 *
 * A span counts only when the replacement differs from what it replaced, so
 * sanitizing already-sanitized text reports nothing.
 */
export function sanitizeWithReport(
  s: string | undefined,
  maxLen: number
): { text: string | undefined; report: SanitizeReport } {
  if (s === undefined || s === null) {
    return { text: s, report: { hits: [], truncated: false } };
  }
  const truncated = s.length > maxLen;
  let out = truncated ? s.slice(0, maxLen) : s;
  const hits: RedactionHit[] = [];
  for (const { name, re, repl } of PATTERNS) {
    let changed = 0;
    out = out.replace(re, (match: string, ...rest: unknown[]) => {
      // replace() appends (offset, wholeString) after the capture groups.
      const groups = rest.slice(0, -2) as string[];
      const replacement = repl(match, ...groups);
      if (replacement !== match) changed++;
      return replacement;
    });
    if (changed === 0) continue;
    // Rule names are not unique (three token shapes share "github-token"),
    // so fold repeats into one entry rather than reporting the same name twice.
    const existing = hits.find((h) => h.pattern === name);
    if (existing) existing.count += changed;
    else hits.push({ pattern: name, count: changed });
  }
  return { text: out, report: { hits, truncated } };
}

/**
 * Sanitize a single string. `undefined` passes through unchanged.
 * Length cap is applied first to bound regex work.
 */
export function sanitize(s: string | undefined, maxLen: number): string | undefined {
  return sanitizeWithReport(s, maxLen).text;
}

/** Length caps for the detail fields. */
export const NOTE_MAX = 500;
export const CONTEXT_MAX = 2000;

/**
 * Sanitize the detail layer of a payload. Anonymous core fields
 * (skill_id, status, client_id, kira_version, ts, env) are not touched —
 * they're already constrained by schema and must not contain free text.
 */
export function sanitizePayload(p: ReportPayloadV1): ReportPayloadV1 {
  if (!p.detail) return p;
  const note = sanitize(p.detail.note, NOTE_MAX);
  const context = sanitize(p.detail.context, CONTEXT_MAX);
  // Drop empty detail object entirely.
  if (note === undefined && context === undefined) {
    const { detail: _drop, ...rest } = p;
    return rest;
  }
  return {
    ...p,
    detail: {
      ...(note !== undefined && { note }),
      ...(context !== undefined && { context }),
    },
  };
}
