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
 * Tail of a systemd template unit — `worker@1.service`, `user@1000.service`,
 * `kura-health@iroha.timer` — which the `email` rule below would otherwise read
 * as an address at a `.service` TLD.
 *
 * The suffix set is systemd's, not ICANN's, so it does not grow when new gTLDs
 * are delegated — but the two namespaces CAN collide, and one already does:
 * `.target` is a delegated brand TLD (checked against the IANA list, version
 * 2026072600), so it is deliberately absent here and a unit of that type keeps
 * redacting. The other ten are unregistered; `.services` exists but the `$`
 * anchor keeps it out. Exactly one label may sit between `@` and the suffix,
 * which is a unit's instance id — a mail domain deep enough to have more (
 * `user@mail.example.service`) is not a unit and stays redacted.
 */
const SYSTEMD_UNIT_TAIL =
  /@[\w-]+\.(?:service|socket|device|mount|automount|swap|path|timer|slice|scope)$/;

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
export interface Rule {
  name: string;
  re: RegExp;
  repl: (match: string, ...groups: string[]) => string;
}

/**
 * Exported for the Worker parity test, which compares this list to
 * `worker/src/sanitize.ts` ENTRY BY ENTRY. Sample-based comparison alone let a
 * divergence live for months: the Worker kept two per-match carve-outs as plain
 * `$1` strings, and no sample happened to carry one.
 */
export const PATTERNS: Rule[] = [
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
  /**
   * An address is `local@domain`, and a domain ends in a TLD — which is never
   * all digits (ICANN forbids it precisely so a name can't be read as an IP).
   * The old tail `[\w.-]+` accepted one anyway, so every `pkg@1.2.3` in a
   * failure note was stored as `[EMAIL]`: "npm published kira-mcp@0.8.2" —
   * measured, not hypothetical — reached a live personal-scar store as "npm
   * published [EMAIL]", which is the one detail the lesson existed to record.
   *
   * Requiring an alphabetic last label costs no coverage: `user@163.com`
   * (numeric FIRST label, a real mail provider) still redacts, and the one
   * shape that legitimately has no TLD — a bare-IP domain — is kept by the
   * second alternative, so `user@192.168.1.1` still redacts whole rather than
   * decaying into `user@[IP]` via the rule below.
   *
   * `[\w-]` excludes `.`, so the dots fix every split point: the repeated
   * group has one parse per input and cannot backtrack exponentially.
   *
   * A systemd template unit is spared via `SYSTEMD_UNIT_TAIL` above: measured,
   * not hypothetical — `user@1000.service` reached a live personal-scar store
   * as `[EMAIL]` in a lesson that existed to record WHICH unit the cgroup parse
   * had picked up. Returning the match unchanged (rather than excluding the
   * shape in the pattern) keeps the reporting contract simple, as the `$`
   * carve-out below does: a spared span differs from no replacement, so it
   * reports nothing. This is the LAST rule that can match such a span — the
   * ones below need an IP, a UUID, a path or a `KEY=`, so releasing it emits
   * no plausible partial output.
   */
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
  /**
   * Last rule in the list, so a span it declines to rewrite is released to
   * nothing — no later rule can match a SUBSET of it and emit plausible
   * partial output.
   *
   * A value starting with `$` is a shell expansion — `$HOME`, `${PATH}`,
   * `$(cmd)` — which is a REFERENCE to a value, never the value itself, so
   * keeping it costs no secret coverage. Redacting it did cost: `[^\s'"]+`
   * stops at whitespace, so `JID=$(gh run view 42 --json jobs)` reached a live
   * personal-scar store as `JID=[REDACTED] run view 42 --json jobs)` — a
   * dangling paren and an unrunnable command, in a scar that existed only to
   * teach that command. Any real path inside an expansion is already gone:
   * `home-path` and `deep-path` run above this rule.
   *
   * Returning the match unchanged (rather than excluding `$` in the pattern)
   * keeps this legible next to the reporting contract: `sanitizeWithReport`
   * counts a span only when the replacement differs, so a spared expansion
   * reports nothing without any extra bookkeeping.
   *
   * A value with NO ASCII alphanumeric character at all is spared for the same
   * structural reason: it carries no credential material. Every machine
   * credential shape is alnum-bearing (hex, base64, base64url, JWT, `sk-`,
   * `ghp_`, `AKIA`, UUID) and those shapes are matched by the rules ABOVE this
   * one anyway — this rule is only the catch-all for an unrecognized literal.
   * What it was actually eating, measured over 115 real `kira_record_failure`
   * calls and a 155-scar live store, was prose placeholders: `HOME=...`,
   * `PATH=(最小)`, `VAR=値`, `GROUPS=(...)` — 0 secrets, 100% false positives.
   * Residual risk, stated rather than hidden: a secret composed purely of
   * punctuation would now survive. No credential format produces one, and
   * password policies universally require alphanumerics.
   *
   * Deliberately NOT spared, so the remaining false positives stay visible:
   * a short literal number (`MAX_THINKING_TOKENS=0`) or an offset (`JST=UTC+9`)
   * — both alnum, both indistinguishable by shape from a real short secret.
   */
  {
    name: "env-assignment",
    re: /\b([A-Z][A-Z0-9_]{2,})=([^\s'"]+)/g,
    repl: (m, key, value) =>
      value.startsWith("$") || !/[A-Za-z0-9]/.test(value) ? m : `${key}=${REDACT}`,
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
