/**
 * `npm run stats` — local-only, redaction-verified summary of ~/.kira/reports.log.
 *
 * This CLI is strictly LOCAL. It:
 *   - reads ONLY the local report log (~/.kira/reports.log, or $KIRA_HOME/reports.log),
 *   - makes NO network calls (no fetch/import of the telemetry pipeline),
 *   - prints only anonymous aggregates (counts, rates) — never the raw client_id
 *     values and never the free-text note/context contents,
 *   - and re-verifies, on every run, that the free-text fields already written
 *     to the log honor Kira's redaction guarantees (see PRIVACY.md).
 *
 * The log stores locally-sanitized entries (`ReportLogEntry`, NDJSON). Kira runs
 * its sanitizer once on the client before this line is ever appended, and again
 * on the receiving Worker before any DB insert. This tool is the third, offline
 * check: it scans the free-text fields for the *raw* secret/PII patterns that the
 * sanitizer is supposed to have replaced. A clean run means the on-disk log
 * carries no unredacted secrets; a flagged run surfaces the exact entry.
 *
 * Output modes:
 *   npm run stats            human-readable report + redaction verdict
 *   npm run stats -- --json  full stats object as JSON
 *   npm run stats -- --badge shields.io endpoint JSON (anonymous stats badge)
 *   npm run stats -- --strict exit 1 if any redaction leak is detected
 *   npm run stats -- --help  usage
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { OsFamily, ReportLogEntry, ReportStatus } from "../src/types.js";

// Resolve the log path exactly like src/consent.ts (KIRA_HOME override, else ~/.kira).
const KIRA_HOME = process.env.KIRA_HOME ?? join(homedir(), ".kira");
const REPORTS_LOG = join(KIRA_HOME, "reports.log");

/**
 * Raw patterns that MUST NOT survive sanitization. Presence in a free-text
 * field means the sanitizer failed for that entry. The redacted replacement
 * tokens ([REDACTED], [EMAIL], [IP], [UUID], /[USER], [PATH]) intentionally do
 * not match any of these, so a correctly-sanitized log scores zero leaks.
 */
const LEAK_PATTERNS: { label: string; re: RegExp }[] = [
  { label: "openai/stripe key", re: /\bsk[-_](?:live_|test_)?[A-Za-z0-9]{16,}/ },
  { label: "github token", re: /\b(?:ghp|ghs|gho|ghu|ghr)_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}/ },
  { label: "slack token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/ },
  { label: "jwt", re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/ },
  { label: "aws access key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { label: "long hex secret", re: /\b[0-9a-fA-F]{40,}\b/ },
  { label: "email", re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/ },
  { label: "ipv4", re: /\b(?:\d{1,3}\.){3}\d{1,3}\b/ },
  { label: "home path", re: /(?:\/home\/[^/\s]+|\/Users\/[^/\s]+|C:\\Users\\[^\\\s]+)/ },
];

interface Stats {
  path: string;
  total: number;
  status: Record<ReportStatus, number>;
  success_rate: number;
  distinct_clients: number;
  with_detail: number;
  sent: number;
  unsent: number;
  versions: Record<string, number>;
  os: Record<string, number>;
  node_major: Record<string, number>;
  tier: Record<string, number>;
  per_skill: { skill_id: string; total: number; success_rate: number }[];
  first_ts: string | null;
  last_ts: string | null;
  malformed_lines: number;
}

interface LeakHit {
  skill_id: string;
  ts: string;
  field: "note" | "context";
  category: string;
}

interface RedactionAudit {
  free_text_fields_scanned: number;
  leaks: LeakHit[];
}

function readLog(path: string): { lines: string[]; missing: boolean } {
  try {
    const raw = readFileSync(path, "utf-8");
    return { lines: raw.split("\n").filter((l) => l.trim().length > 0), missing: false };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { lines: [], missing: true };
    throw err;
  }
}

function parse(lines: string[]): { entries: ReportLogEntry[]; malformed: number } {
  const entries: ReportLogEntry[] = [];
  let malformed = 0;
  for (const line of lines) {
    try {
      const e = JSON.parse(line) as ReportLogEntry;
      if (e && typeof e.skill_id === "string" && typeof e.status === "string") entries.push(e);
      else malformed++;
    } catch {
      malformed++;
    }
  }
  return { entries, malformed };
}

function bump(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

function rate(success: number, total: number): number {
  return total > 0 ? Math.round((success / total) * 100) : 0;
}

function computeStats(entries: ReportLogEntry[], malformed: number): Stats {
  const status: Record<ReportStatus, number> = { success: 0, retry: 0, failure: 0 };
  const clients = new Set<string>();
  const versions: Record<string, number> = {};
  const os: Record<string, number> = {};
  const nodeMajor: Record<string, number> = {};
  const tier: Record<string, number> = {};
  const perSkill = new Map<string, { total: number; success: number }>();
  let withDetail = 0;
  let sent = 0;
  let first: string | null = null;
  let last: string | null = null;

  for (const e of entries) {
    if (e.status === "success" || e.status === "retry" || e.status === "failure") status[e.status]++;
    if (typeof e.client_id === "string") clients.add(e.client_id);
    if (e.kira_version) bump(versions, e.kira_version);
    if (e.env?.os) bump(os, e.env.os as OsFamily);
    if (typeof e.env?.node_major === "number") bump(nodeMajor, String(e.env.node_major));
    if (e.env?.tier) bump(tier, e.env.tier);
    if (e.detail && (e.detail.note !== undefined || e.detail.context !== undefined)) withDetail++;
    if (e.sent) sent++;

    const s = perSkill.get(e.skill_id) ?? { total: 0, success: 0 };
    s.total++;
    if (e.status === "success") s.success++;
    perSkill.set(e.skill_id, s);

    if (typeof e.ts === "string") {
      if (first === null || e.ts < first) first = e.ts;
      if (last === null || e.ts > last) last = e.ts;
    }
  }

  const per_skill = Array.from(perSkill.entries())
    .map(([skill_id, s]) => ({ skill_id, total: s.total, success_rate: rate(s.success, s.total) }))
    .sort((a, b) => b.total - a.total);

  return {
    path: REPORTS_LOG,
    total: entries.length,
    status,
    success_rate: rate(status.success, entries.length),
    distinct_clients: clients.size,
    with_detail: withDetail,
    sent,
    unsent: entries.length - sent,
    versions,
    os,
    node_major: nodeMajor,
    tier,
    per_skill,
    first_ts: first,
    last_ts: last,
    malformed_lines: malformed,
  };
}

function auditRedaction(entries: ReportLogEntry[]): RedactionAudit {
  const leaks: LeakHit[] = [];
  let scanned = 0;
  for (const e of entries) {
    if (!e.detail) continue;
    const fields: [("note" | "context"), string | undefined][] = [
      ["note", e.detail.note],
      ["context", e.detail.context],
    ];
    for (const [field, value] of fields) {
      if (typeof value !== "string") continue;
      scanned++;
      for (const { label, re } of LEAK_PATTERNS) {
        if (re.test(value)) {
          leaks.push({ skill_id: e.skill_id, ts: e.ts ?? "?", field, category: label });
        }
      }
    }
  }
  return { free_text_fields_scanned: scanned, leaks };
}

// ── Formatting ──────────────────────────────────────────────────────────

function distLine(map: Record<string, number>): string {
  const keys = Object.keys(map).sort((a, b) => map[b] - map[a]);
  if (keys.length === 0) return "—";
  return keys.map((k) => `${k}: ${map[k]}`).join(", ");
}

function humanReport(stats: Stats, audit: RedactionAudit, missing: boolean): string {
  const L: string[] = [];
  L.push("Kira — local report stats");
  L.push(`  source: ${stats.path}`);

  if (missing) {
    L.push("");
    L.push("  No report log yet. Nothing has been recorded on this machine.");
    L.push("  (A log appears the first time an agent calls kira_report.)");
  } else if (stats.total === 0) {
    L.push("");
    L.push("  Log exists but contains no valid entries.");
  } else {
    const s = stats.status;
    L.push(`  reports: ${stats.total}  (success ${s.success} · retry ${s.retry} · failure ${s.failure})`);
    L.push(`  success rate: ${stats.success_rate}%`);
    L.push(`  anonymous clients: ${stats.distinct_clients}   uploaded/pending: ${stats.sent}/${stats.unsent}`);
    if (stats.first_ts && stats.last_ts) L.push(`  window: ${stats.first_ts} → ${stats.last_ts}`);
    if (stats.malformed_lines > 0) L.push(`  skipped malformed lines: ${stats.malformed_lines}`);
    L.push("");
    L.push("  environment:");
    L.push(`    kira version : ${distLine(stats.versions)}`);
    L.push(`    os family    : ${distLine(stats.os)}`);
    L.push(`    node major   : ${distLine(stats.node_major)}`);
    L.push(`    tier         : ${distLine(stats.tier)}`);
    if (stats.per_skill.length > 0) {
      L.push("");
      L.push("  top skills by volume:");
      for (const p of stats.per_skill.slice(0, 10)) {
        L.push(`    ${p.skill_id}  —  ${p.total} report(s), ${p.success_rate}% success`);
      }
    }
  }

  L.push("");
  L.push("  Redaction guarantees (see PRIVACY.md):");
  L.push("    • This command reads only the local log above and makes no network calls.");
  L.push("    • Free-text note/context are passed through the sanitizer before they are");
  L.push("      written locally AND again before upload: secrets, tokens, emails, IPs,");
  L.push("      UUIDs and home paths become [REDACTED]/[EMAIL]/[IP]/[UUID]/[PATH]//[USER].");
  L.push("    • This report prints anonymous aggregates only — never raw client_id values");
  L.push("      and never the note/context text itself.");
  L.push("");

  if (missing || stats.total === 0) {
    L.push("  redaction check: nothing to verify.");
  } else if (audit.leaks.length === 0) {
    L.push(`  redaction check: ✓ verified — 0 leaks across ${audit.free_text_fields_scanned} free-text field(s).`);
  } else {
    L.push(`  redaction check: ✗ ${audit.leaks.length} potential leak(s) across ${audit.free_text_fields_scanned} field(s):`);
    for (const leak of audit.leaks.slice(0, 20)) {
      L.push(`    ⚠ ${leak.category} in ${leak.field} of ${leak.skill_id} @ ${leak.ts}`);
    }
    L.push("    → The on-disk log holds an unredacted value. Please file a PRIVACY issue");
    L.push("      with the sanitizer pattern that missed it (do NOT paste the secret).");
  }

  return L.join("\n");
}

function badge(stats: Stats, audit: RedactionAudit): object {
  const leaks = audit.leaks.length;
  const message =
    stats.total === 0
      ? "no reports"
      : `${stats.total} reports · ${stats.success_rate}% ok · ${leaks} leaks`;
  const color = stats.total === 0 ? "lightgrey" : leaks > 0 ? "red" : "brightgreen";
  return { schemaVersion: 1, label: "kira", message, color };
}

const HELP = `npm run stats — local-only, redaction-verified summary of ~/.kira/reports.log

Usage:
  npm run stats             human-readable report + redaction verdict
  npm run stats -- --json   full stats object as JSON
  npm run stats -- --badge  shields.io endpoint JSON (anonymous stats badge)
  npm run stats -- --strict exit 1 if any redaction leak is detected
  npm run stats -- --help   this message

Reads only $KIRA_HOME/reports.log (default ~/.kira/reports.log). Never makes a
network request. Prints anonymous aggregates only — see PRIVACY.md.`;

function main(): void {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(HELP);
    return;
  }

  const { lines, missing } = readLog(REPORTS_LOG);
  const { entries, malformed } = parse(lines);
  const stats = computeStats(entries, malformed);
  const audit = auditRedaction(entries);

  if (args.includes("--json")) {
    console.log(JSON.stringify({ ...stats, redaction: audit }, null, 2));
  } else if (args.includes("--badge")) {
    console.log(JSON.stringify(badge(stats, audit)));
  } else {
    console.log(humanReport(stats, audit, missing));
  }

  if (args.includes("--strict") && audit.leaks.length > 0) process.exitCode = 1;
}

main();
