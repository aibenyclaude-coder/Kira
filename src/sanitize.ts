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

const PATTERNS: Array<[RegExp, string]> = [
  // ── Token shapes (run before generic hex / KEY=value) ─────────────────
  [/\bsk-[A-Za-z0-9_-]{20,}\b/g, REDACT],
  [/\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/g, REDACT],
  [/\bghp_[A-Za-z0-9]{30,}\b/g, REDACT],
  [/\bghs_[A-Za-z0-9]{30,}\b/g, REDACT],
  [/\bgithub_pat_[A-Za-z0-9_]{40,}\b/g, REDACT],
  [/\bxox[bpars]-[A-Za-z0-9-]{10,}\b/g, REDACT],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, REDACT], // JWT
  [/\bAKIA[0-9A-Z]{16}\b/g, REDACT],
  [/\b[a-f0-9]{40,}\b/gi, REDACT], // long hex (sha-1+, hex secrets)

  // ── Identity ─────────────────────────────────────────────────────────
  [/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, "[EMAIL]"],
  [/(?<![\w.])\d{1,3}(\.\d{1,3}){3}(?![\w.])/g, "[IP]"],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[UUID]"],

  // ── Paths ────────────────────────────────────────────────────────────
  [/\/(?:home|Users)\/[^\s/"']+/g, "/[USER]"],
  [/[A-Za-z]:\\Users\\[^\\\s"']+/g, "C:\\[USER]"],
  // Generic deep POSIX-like paths (3+ segments, conservative to avoid URLs)
  [/(?<![A-Za-z0-9_:/])\/(?:[\w.-]+\/){2,}[\w.-]+/g, "[PATH]"],

  // ── KEY=value assignments (after token patterns above) ───────────────
  [/\b([A-Z][A-Z0-9_]{2,})=([^\s'"]+)/g, "$1=[REDACTED]"],
];

/**
 * Sanitize a single string. `undefined` passes through unchanged.
 * Length cap is applied first to bound regex work.
 */
export function sanitize(s: string | undefined, maxLen: number): string | undefined {
  if (s === undefined || s === null) return s;
  let out = s.length > maxLen ? s.slice(0, maxLen) : s;
  for (const [re, repl] of PATTERNS) out = out.replace(re, repl);
  return out;
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
