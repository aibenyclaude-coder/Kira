/**
 * Kira flywheel — the local improvement loop (v1).
 *
 * Converts usage exhaust into catalog improvements, deterministically:
 *
 *   Loop B (demand):  ~/.kira/misses.log      → miss clusters → alias fixes / skill-gap stubs
 *   Loop C (quality): ~/.kira/reports.log     → retry/failure note clusters → scar stubs
 *   Loop A (supply):  ~/.kira/personal-scars/ → hit stats → promotion candidates (F4 preview)
 *
 * Design rules:
 *   - No network. No new dependencies. LLM refinement is OPTIONAL (--llm claude-cli)
 *     and falls back to deterministic stubs on any error.
 *   - Everything is readable evidence: the digest cites counts and sources.
 *   - Exit 0 with a one-line summary (timer-friendly).
 *
 * Usage:
 *   node dist/flywheel.js                    # digest only
 *   node dist/flywheel.js --emit-candidates  # + write candidate JSON stubs
 *   node dist/flywheel.js --llm claude-cli   # + refine top scar stubs via `claude -p`
 *
 * Env:
 *   KIRA_HOME   — data dir (default ~/.kira)
 *   CLAUDE_BIN  — absolute path to the claude CLI. Set this in systemd units:
 *                 user services don't inherit ~/.npm-global/bin on PATH
 *                 (learned the hard way in a prior bot deployment).
 */

import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { tokenize } from "./similarity.js";

const pExecFile = promisify(execFile);

/** Resolved at call time (not import time) so tests can swap KIRA_HOME. */
export function kiraHome(): string {
  return process.env.KIRA_HOME ?? join(homedir(), ".kira");
}

// ── NDJSON I/O ──────────────────────────────────────────────────────────

export interface MissEntry {
  keyword?: string;
  context?: string[];
  near?: Array<{ id: string; score: number }>;
  /**
   * Which recall path produced the miss. Absent on entries written before the
   * field existed — those are lookup misses, so anything that is not "route"
   * is treated as a lookup miss (a route gap is the fix-a-whole-route signal,
   * kept out of the skill/alias clusters).
   */
  kind?: string;
  ts?: string;
}

export interface ReportEntry {
  skill_id?: string;
  status?: string;
  detail?: { note?: string; context?: string };
  ts?: string;
}

/** Parse an NDJSON file; malformed lines are skipped, missing file → []. */
export async function readNdjson<T>(path: string): Promise<T[]> {
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch {
    return [];
  }
  const out: T[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed) as T);
    } catch {
      // Skip malformed lines — the loop must survive dirty logs.
    }
  }
  return out;
}

// ── Loop B: miss clustering ─────────────────────────────────────────────

export interface MissCluster {
  /** First keyword seen — the human-readable representative. */
  rep: string;
  tokens: Set<string>;
  count: number;
  contexts: Set<string>;
  /** Best near-match score per skill/scar id across the cluster. */
  nearBest: Map<string, number>;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * When the containment fallback applies, the shorter side must be at least
 * half-covered, and by ≥ 2 real tokens — one shared word ("discord") is a
 * topic, not a demand.
 */
const CONTAIN_MIN = 0.5;
const CONTAIN_SHARED_MIN = 2;

/**
 * Similarity for "are these the same demand", ≥ 0 (0 = not the same).
 *
 * Jaccard is the right measure when the two sides are comparable in length,
 * and a *structurally impossible* one when they are not: `jaccard(a,b)` is
 * capped at `min/max size`, so once one side has more than 1/threshold times
 * the tokens of the other, the gate is unreachable NO MATTER HOW COMPLETE the
 * overlap is. That is not a corner case here — tokenize() expands CJK runs
 * into character bigrams, so a Japanese phrase yields ~1 token per character
 * while an English phrase yields ~1 per word, and real queries differ 3-5× in
 * token count. Measured over the 12 lookup misses on this machine: 20 of the
 * 66 pairs are barred by size ratio alone, the highest jaccard any pair
 * reaches is 0.182, and three misses that are plainly one demand ("discord
 * bot …" ×3) never merged — so Loop B emitted zero candidates in every weekly
 * run it has ever made.
 *
 * So the containment fallback is scoped to exactly the pairs where jaccard
 * cannot fire on its own: a terse query whose tokens sit inside a verbose one
 * is the same demand asked twice. Where jaccard CAN fire it stays the only
 * judge — two same-length queries sharing half their tokens ("stripe webhook
 * signature verify" vs "stripe webhook retry storm") are a shared topic with
 * different demands, and must stay apart.
 */
function demandSim(a: Set<string>, b: Set<string>, threshold: number): number {
  const j = jaccard(a, b);
  if (j >= threshold) return j;
  if (a.size === 0 || b.size === 0) return 0;
  const ratio = Math.min(a.size, b.size) / Math.max(a.size, b.size);
  if (ratio >= threshold) return 0; // jaccard was free to fire and didn't.
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  if (shared < CONTAIN_SHARED_MIN) return 0;
  const contained = shared / Math.min(a.size, b.size);
  return contained >= CONTAIN_MIN ? contained : 0;
}

/** Greedy clustering: an entry joins the MOST similar cluster (best-fit, so membership doesn't depend on arrival order). */
export function clusterMisses(entries: MissEntry[]): MissCluster[] {
  const clusters: MissCluster[] = [];
  for (const e of entries) {
    const kw = (e.keyword ?? "").trim();
    const toks = new Set(tokenize(kw));
    if (toks.size === 0) continue;
    let home: MissCluster | undefined;
    let bestSim = 0;
    for (const c of clusters) {
      const sim = demandSim(toks, c.tokens, 0.5);
      if (sim > bestSim) {
        bestSim = sim;
        home = c;
      }
    }
    if (!home) {
      home = { rep: kw, tokens: new Set(toks), count: 0, contexts: new Set(), nearBest: new Map() };
      clusters.push(home);
    }
    home.count++;
    for (const c of e.context ?? []) home.contexts.add(String(c));
    for (const n of e.near ?? []) {
      if (typeof n?.id !== "string" || typeof n?.score !== "number") continue;
      if (n.score > (home.nearBest.get(n.id) ?? 0)) home.nearBest.set(n.id, n.score);
    }
  }
  return clusters.sort((a, b) => b.count - a.count);
}

// ── Loop C: report aggregation ──────────────────────────────────────────

export interface SkillStats {
  skill_id: string;
  success: number;
  retry: number;
  failure: number;
  notes: string[];
}

export function aggregateReports(entries: ReportEntry[]): SkillStats[] {
  const by = new Map<string, SkillStats>();
  for (const e of entries) {
    const id = e.skill_id;
    const status = e.status;
    if (!id || !status) continue;
    let s = by.get(id);
    if (!s) {
      s = { skill_id: id, success: 0, retry: 0, failure: 0, notes: [] };
      by.set(id, s);
    }
    if (status === "success") s.success++;
    else if (status === "retry") s.retry++;
    else if (status === "failure") s.failure++;
    const note = e.detail?.note;
    if (note && status !== "success") s.notes.push(note);
  }
  return [...by.values()].sort(
    (a, b) => b.retry + b.failure - (a.retry + a.failure)
  );
}

/** Cluster failure notes within one skill; ≥2 similar notes → scar material. Best-fit like clusterMisses. */
export function clusterNotes(notes: string[]): Array<{ rep: string; all: string[] }> {
  const clusters: Array<{ rep: string; tokens: Set<string>; all: string[] }> = [];
  for (const note of notes) {
    const toks = new Set(tokenize(note));
    if (toks.size === 0) continue;
    let home: { rep: string; tokens: Set<string>; all: string[] } | undefined;
    let bestSim = 0;
    for (const c of clusters) {
      const sim = demandSim(toks, c.tokens, 0.4);
      if (sim > bestSim) {
        bestSim = sim;
        home = c;
      }
    }
    if (!home) {
      home = { rep: note, tokens: new Set(toks), all: [] };
      clusters.push(home);
    }
    home.all.push(note);
  }
  return clusters
    .filter((c) => c.all.length >= 2)
    .map(({ rep, all }) => ({ rep, all }));
}

// ── Loop A: personal scars (written by kira_record_failure / F1) ────────

export interface PersonalScarLite {
  id: string;
  title: string;
  hit_count: number;
}

export async function readPersonalScars(dir: string): Promise<PersonalScarLite[]> {
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }
  const out: PersonalScarLite[] = [];
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    try {
      const raw = JSON.parse(await readFile(join(dir, f), "utf-8"));
      out.push({
        id: String(raw.id ?? f.replace(/\.json$/, "")),
        title: String(raw.title ?? "(untitled)"),
        hit_count: Number(raw.hit_count ?? 0),
      });
    } catch {
      // Skip broken files.
    }
  }
  return out.sort((a, b) => b.hit_count - a.hit_count);
}

// ── Candidates ──────────────────────────────────────────────────────────

function shortHash(s: string): string {
  return createHash("sha1").update(s).digest("hex").slice(0, 8);
}

/**
 * Slug for a candidate FILENAME and ID — not decoration, so it has to survive
 * the id rules (`^(community|vendor)\.[a-z0-9][a-z0-9-]*\.v\d+$`) and stay
 * unique.
 *
 * Derived from the raw text, NOT from tokenize(): tokens are emitted CJK
 * bigrams first, and stripping the non-ascii ones left the separators behind,
 * so the first candidate this loop would ever have emitted was
 * `community.-discord-bot-claude.v1` — a leading hyphen the validator rejects.
 *
 * An empty derivation falls back to a hash OF THE CONTENT, never a constant:
 * a constant fallback is a merge point where every non-latin title lands on
 * the same filename (see the same fix in tools/share-scar.ts).
 */
function slugify(s: string, max = 40): string {
  const slug = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
  return slug || shortHash(s);
}

export interface Candidate {
  kind: "alias" | "skill-gap" | "scar";
  file: string;
  body: Record<string, unknown>;
}

export function buildCandidates(
  missClusters: MissCluster[],
  stats: SkillStats[],
  now: string
): Candidate[] {
  const out: Candidate[] = [];

  for (const c of missClusters) {
    if (c.count < 2) continue;
    const bestNear = [...c.nearBest.entries()].sort((a, b) => b[1] - a[1])[0];
    if (bestNear && bestNear[1] >= 0.3) {
      out.push({
        kind: "alias",
        file: `alias-${slugify(c.rep)}.json`,
        body: {
          _kira_candidate: "alias",
          target_id: bestNear[0],
          add_keywords: [c.rep],
          evidence: { misses: c.count, best_near_score: bestNear[1] },
          proposed_at: now,
        },
      });
    } else {
      out.push({
        kind: "skill-gap",
        file: `skill-gap-${slugify(c.rep)}.json`,
        body: {
          _kira_candidate: "skill-gap",
          id: `community.${slugify(c.rep)}.v1`,
          keywords: [c.rep, ...[...c.tokens].slice(0, 4)],
          contexts: [...c.contexts].slice(0, 6),
          title: `TODO: ${c.rep}`,
          summary: `TODO — asked ${c.count}× with no match.`,
          source: "community",
          declaration: "TODO",
          instructions: "## TODO\n\nWrite the skill. Observed demand:\n- " + c.rep,
          version: "0.0.1",
          updated_at: now,
        },
      });
    }
  }

  for (const s of stats) {
    for (const nc of clusterNotes(s.notes)) {
      out.push({
        kind: "scar",
        file: `scar-${slugify(s.skill_id)}-${slugify(nc.rep, 16)}.json`,
        body: {
          _kira_candidate: "scar",
          id: `scar.${slugify(s.skill_id)}-${slugify(nc.rep, 16)}.v1`,
          keywords: [...new Set(tokenize(s.skill_id + " " + nc.rep))].slice(0, 8),
          contexts: [],
          title: `TODO: recurring failure in ${s.skill_id}`,
          summary: nc.rep.slice(0, 140),
          severity: "warning",
          mistake: nc.all.join(" / ").slice(0, 800),
          instead: "TODO — write the avoidance strategy.",
          hit_count: nc.all.length,
          version: "0.0.1",
          updated_at: now,
        },
      });
    }
  }

  return out;
}

// ── Optional LLM refinement (claude CLI, subscription-friendly) ─────────

export async function refineWithClaude(
  candidate: Candidate,
  bin: string
): Promise<Candidate> {
  if (candidate.kind !== "scar") return candidate;
  const prompt =
    "次の失敗ノート群から Kira の scar JSON を完成させろ。keys: title(英語1行), summary(1行), " +
    "mistake(何を間違えたか・具体的に), instead(代わりにどうするか・具体的に), severity(warning|critical)。" +
    "出力は JSON オブジェクトのみ。\n\nベース:\n" +
    JSON.stringify(candidate.body, null, 2);
  try {
    const { stdout } = await pExecFile(
      bin,
      ["-p", prompt, "--model", "claude-haiku-4-5", "--output-format", "json"],
      { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 }
    );
    const wrapper = JSON.parse(stdout);
    const text = String(wrapper.result ?? "").replace(/^```(?:json)?\n?|\n?```$/g, "");
    const refined = JSON.parse(text);
    const merged = { ...candidate.body };
    for (const k of ["title", "summary", "mistake", "instead", "severity"]) {
      if (typeof refined[k] === "string" && refined[k].length > 0) merged[k] = refined[k];
    }
    return { ...candidate, body: merged };
  } catch {
    return candidate; // Deterministic stub is always the fallback.
  }
}

// ── Digest ──────────────────────────────────────────────────────────────

export function renderDigest(
  date: string,
  misses: MissEntry[],
  missClusters: MissCluster[],
  routeClusters: MissCluster[],
  stats: SkillStats[],
  personal: PersonalScarLite[],
  candidates: Candidate[],
  // Whether the candidates were actually written to disk. The digest cannot
  // infer this: buildCandidates() runs unconditionally, so an empty list never
  // means "the flag was missing" — and a non-empty list does not mean the
  // files exist. Both halves have to be told.
  emitted: boolean
): string {
  const L: string[] = [];
  L.push(`# Kira flywheel digest — ${date}`);
  L.push("");
  L.push(`inputs: lookup-misses=${misses.length} / route-misses=${routeClusters.reduce((n, c) => n + c.count, 0)} / reports(skills)=${stats.length} / personal-scars=${personal.length}`);
  L.push("");
  L.push("## Loop B — 需要 (lookup misses)");
  if (missClusters.length === 0) L.push("(no misses — either perfect coverage or nobody is asking)");
  for (const c of missClusters.slice(0, 15)) {
    const best = [...c.nearBest.entries()].sort((a, b) => b[1] - a[1])[0];
    const action = best && best[1] >= 0.3
      ? `→ alias 追加候補: \`${best[0]}\` (score ${best[1]})`
      : "→ 新規 skill/scar 候補";
    L.push(`- **${c.rep}** ×${c.count} ${c.contexts.size ? `[${[...c.contexts].join(", ")}]` : ""} ${action}`);
  }
  L.push("");
  L.push("## Loop B — 需要 (route gaps: broad goals with no matching route)");
  if (routeClusters.length === 0) L.push("(no route misses — every broad goal hit a route, or none were asked)");
  for (const c of routeClusters.slice(0, 15)) {
    L.push(`- **${c.rep}** ×${c.count} ${c.contexts.size ? `[${[...c.contexts].join(", ")}]` : ""} → 新規 route 候補`);
  }
  L.push("");
  L.push("## Loop C — 品質 (report outcomes)");
  if (stats.length === 0) L.push("(no reports yet)");
  for (const s of stats.slice(0, 15)) {
    const total = s.success + s.retry + s.failure;
    L.push(`- \`${s.skill_id}\`: ${s.success}/${total} success, ${s.retry} retry, ${s.failure} failure${s.notes.length ? ` — ${s.notes.length} notes` : ""}`);
  }
  L.push("");
  L.push("## Loop A — 供給 (personal scars)");
  if (personal.length === 0) L.push("(none yet — kira_record_failure が入ると自動で貯まる)");
  for (const p of personal.slice(0, 10)) {
    L.push(`- ${p.title} (hit ${p.hit_count})${p.hit_count >= 3 ? " ★ promotion candidate" : ""}`);
  }
  L.push("");
  L.push("## Candidates");
  if (candidates.length === 0) L.push("(none — not enough repeated signal yet)");
  else if (!emitted) L.push("(listed only — rerun with --emit-candidates to write these to candidates/)");
  for (const c of candidates) L.push(`- [${c.kind}] ${c.file}`);
  L.push("");
  // Only point at candidates/ when something is actually there to read.
  L.push(
    candidates.length > 0 && emitted
      ? "次の一手: candidates/ を確認 → 採用するものを skills/ へ移して PR。alias 候補は該当 skill の keywords に追記。"
      : "次の一手: 上の Loop B/C の需要を見て、alias 候補は該当 skill の keywords に追記。"
  );
  return L.join("\n") + "\n";
}

// ── Main ────────────────────────────────────────────────────────────────

export async function runFlywheel(opts: {
  emitCandidates: boolean;
  llm?: string;
}): Promise<{ digestPath: string; candidates: number; summary: string }> {
  const home = kiraHome();
  // Local calendar date — the digest belongs to the operator's day, not UTC's
  // (a 00:30 JST run must not stamp yesterday's date).
  const d = new Date();
  const date = [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
  const outDir = join(home, "flywheel");
  await mkdir(outDir, { recursive: true });

  const [misses, reports, personal] = await Promise.all([
    readNdjson<MissEntry>(join(home, "misses.log")),
    readNdjson<ReportEntry>(join(home, "reports.log")),
    readPersonalScars(join(home, "personal-scars")),
  ]);

  // Route gaps (no route matched a broad goal) and lookup gaps (no skill
  // matched a task) are different demands with different fixes, so cluster
  // them apart. Only lookup clusters feed buildCandidates — a route gap must
  // never masquerade as a skill-gap/alias candidate.
  const lookupMisses = misses.filter((m) => m.kind !== "route");
  const routeMisses = misses.filter((m) => m.kind === "route");
  const missClusters = clusterMisses(lookupMisses);
  const routeClusters = clusterMisses(routeMisses);
  const stats = aggregateReports(reports);
  const now = new Date().toISOString();
  let candidates = buildCandidates(missClusters, stats, now);

  if (opts.emitCandidates && candidates.length > 0) {
    const candDir = join(outDir, "candidates");
    await mkdir(candDir, { recursive: true });
    if (opts.llm === "claude-cli") {
      const bin = process.env.CLAUDE_BIN ?? "claude";
      const refined: Candidate[] = [];
      let budget = 3; // At most 3 CLI calls per run — subscription-friendly.
      for (const c of candidates) {
        if (c.kind === "scar" && budget > 0) {
          budget--;
          refined.push(await refineWithClaude(c, bin));
        } else {
          refined.push(c);
        }
      }
      candidates = refined;
    }
    for (const c of candidates) {
      await writeFile(join(candDir, c.file), JSON.stringify(c.body, null, 2) + "\n", "utf-8");
    }
  }

  // The digest lists candidates even when they were not emitted to disk — it
  // is told which case it is so it can say so rather than guess.
  const wroteCandidates = opts.emitCandidates && candidates.length > 0;
  const digest = renderDigest(date, lookupMisses, missClusters, routeClusters, stats, personal, candidates, wroteCandidates);
  const digestPath = join(outDir, `${date}-digest.md`);
  await writeFile(digestPath, digest, "utf-8");

  const summary = `[flywheel] misses=${misses.length} (lookup ${lookupMisses.length}→${missClusters.length} / route ${routeMisses.length}→${routeClusters.length}), skills-reported=${stats.length}, personal-scars=${personal.length}, candidates=${candidates.length} → ${digestPath}`;
  return { digestPath, candidates: candidates.length, summary };
}

const isMain =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const argv = process.argv.slice(2);
  const emitCandidates = argv.includes("--emit-candidates");
  const llmIdx = argv.indexOf("--llm");
  const llm = llmIdx >= 0 ? argv[llmIdx + 1] : undefined;
  runFlywheel({ emitCandidates, llm })
    .then((r) => {
      // eslint-disable-next-line no-console
      console.log(r.summary);
    })
    .catch((e) => {
      // eslint-disable-next-line no-console
      console.error("[flywheel] failed:", e);
      process.exit(1);
    });
}
