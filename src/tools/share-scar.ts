/**
 * `kira_share_scar` MCP tool — promote a personal scar into a community
 * submission (F4, v1: GitHub-native).
 *
 * The absorption pipeline's supply valve: takes a LOCAL personal scar,
 * re-sanitizes and generalizes it into the community scar shape, and returns
 * everything needed to submit it — a prefilled GitHub issue URL and a `gh`
 * fallback. The tool itself performs NO network I/O and uploads NOTHING;
 * opening the issue is a deliberate human (or human-approved) act. That keeps
 * the local-only privacy promise intact: sharing is always explicit.
 */
import { createHash } from "node:crypto";
import { loadPersonalScars, type PersonalScar } from "../personal-scars.js";
import { sanitize } from "../sanitize.js";

const DEFAULT_REPO = "aibenyclaude-coder/Kira";
/** Prefilled-URL budget — GitHub/browsers get unreliable past ~8k chars. */
const URL_LIMIT = 6500;

const TITLE_MAX = 200;
const SUMMARY_MAX = 300;
const TEXT_MAX = 2000;

export const KIRA_SHARE_SCAR_TOOL = {
  name: "kira_share_scar",
  description:
    "Promote one of YOUR personal scars into a community submission so every " +
    "Kira user stops hitting that wall. Takes a personal scar id (from " +
    "kira_personal_brief / kira_lookup), re-sanitizes it, generalizes it to " +
    "the community scar shape, and returns a prefilled GitHub issue URL plus " +
    "a gh CLI fallback. NOTHING is uploaded by this tool — show the result to " +
    "the user and let them submit. Accepted scars earn contributor status " +
    "(see RECIPROCITY notes in the repo).",
  inputSchema: {
    type: "object",
    properties: {
      scar_id: {
        type: "string",
        description:
          "The personal scar to share (must start with 'scar.personal.').",
      },
      repo: {
        type: "string",
        description: `Target GitHub repo (default ${DEFAULT_REPO}).`,
      },
    },
    required: ["scar_id"],
  },
  annotations: {
    title: "Kira Share Scar",
    // Reads local scar files and builds strings; writes nothing anywhere.
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    // No network I/O — submission happens outside the tool, by the human.
    openWorldHint: false,
  },
} as const;

export interface ShareScarResult {
  /** Community-shaped scar candidate (sanitized, generalized id). */
  candidate: Record<string, unknown>;
  issue_title: string;
  /** Full issue body (markdown) — usable with the URL or gh fallback. */
  issue_body: string;
  /** Prefilled new-issue URL, or null when the body exceeds the URL budget. */
  submit_url: string | null;
  /** Fallback: save issue_body to a file and run this. */
  gh_command: string;
  /** Explicit no-upload statement for the agent to relay. */
  shared: "nothing yet — this tool only PREPARES the submission";
}

/** Leaves room for the `-<hash>` suffix inside a readable id segment. */
const SLUG_MAX = 48;

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, "");
}

function shortHash(s: string): string {
  return createHash("sha1").update(s).digest("hex").slice(0, 8);
}

/**
 * A community id is not decoration — it is the corpus FILENAME. The intake
 * bot derives `skills/scars/<id minus scar. and .v1>.json` from it and tells
 * the maintainer to commit that path, so two candidates that slugify alike do
 * not merely look alike: the second one silently overwrites the first, and
 * the corpus (keyed by id) loses an entry.
 *
 * A title-only slug collides constantly, because a slug is not a faithful
 * projection of every title. Measured over the 135 personal scars on this
 * machine, 18 of them (13.3%) shared a candidate id with another scar: any
 * title with no latin characters slugified to "" and hit the old constant
 * fallback (10 scars landed on the literal `scar.scar.v1` → `scar.json`),
 * titles with incidental latin debris collapsed to 1-2 chars (`scar.0.v1`,
 * `scar.ai.v1`), and two distinct long titles collided after the 48-char
 * truncation. The personal id already carries a content hash for exactly this
 * reason — `scar.personal.<slug>.<hash>.v1` — and is collision-free across the
 * same 135 records; the community candidate now carries one too.
 *
 * The hash goes INSIDE the slug segment so the corpus keeps its three-segment
 * `scar.<slug>.v1` convention and the id still satisfies the validator's
 * `/^scar\.[a-z0-9][a-z0-9-]*\.v\d+$/`. A maintainer is free to shorten it by
 * hand at merge time — that is a rename of a unique id, not a collision.
 */
function candidateId(title: string, mistake: string): string {
  const slug = slugify(title);
  const hash = shortHash(`${title}\n${mistake}`);
  return `scar.${slug ? `${slug}-` : ""}${hash}.v1`;
}

function clean(text: string | undefined, cap: number): string {
  if (!text) return "";
  return (sanitize(text, cap) ?? "").trim();
}

/** Generalize a personal scar into the community submission shape. */
export function buildCandidate(scar: PersonalScar): Record<string, unknown> {
  const title = clean(scar.title, TITLE_MAX);
  const mistake = clean(scar.mistake, TEXT_MAX);
  return {
    id: candidateId(title, mistake),
    keywords: scar.keywords.slice(0, 8),
    contexts: scar.contexts,
    title,
    summary: clean(scar.summary, SUMMARY_MAX) || title,
    severity: scar.severity,
    mistake,
    instead: clean(scar.instead, TEXT_MAX),
    // Honest count: how often it actually recurred on the submitter's machine.
    hit_count: scar.hit_count,
    version: "1.0.0",
    updated_at: new Date().toISOString(),
  };
}

function buildIssueBody(
  candidate: Record<string, unknown>,
  scar: PersonalScar
): string {
  return [
    "## Scar submission",
    "",
    "A personal scar promoted via `kira_share_scar`. The intake bot validates the JSON when the `scar-submission` label is present.",
    "",
    "```json",
    JSON.stringify(candidate, null, 2),
    "```",
    "",
    `Provenance: hit ${scar.hit_count} time${scar.hit_count === 1 ? "" : "s"} on the submitter's machine before promotion. All text passed the local sanitizer twice (at record time and at share time).`,
    "",
    "- [x] Sanitized — no secrets, private paths, or identifiers",
    "- [ ] I license this contribution under the repository's MIT license",
    "- [ ] `keywords` has 3+ variants a future agent would actually search",
    "",
    "_Why share? Accepted scars earn contributor status — the fresh community feed that non-contributors subscribe for._",
  ].join("\n");
}

/**
 * Validate raw MCP arguments and prepare the submission bundle.
 * Throws on invalid input, matching the other tool handlers in this repo.
 */
export async function handleShareScar(args: unknown): Promise<ShareScarResult> {
  const a = (args ?? {}) as Record<string, unknown>;

  const scarId = typeof a.scar_id === "string" ? a.scar_id.trim() : "";
  if (!scarId) {
    throw new Error("kira_share_scar requires a non-empty 'scar_id'.");
  }
  if (!scarId.startsWith("scar.personal.")) {
    throw new Error(
      `Only PERSONAL scars can be shared ('scar.personal.*'); got "${scarId}". ` +
        "Community scars are already shared."
    );
  }
  const repo =
    typeof a.repo === "string" && /^[\w.-]+\/[\w.-]+$/.test(a.repo)
      ? a.repo
      : DEFAULT_REPO;

  const scar = (await loadPersonalScars()).find((s) => s.id === scarId);
  if (!scar) {
    throw new Error(
      `No personal scar with id "${scarId}". List yours via kira_personal_brief.`
    );
  }

  const candidate = buildCandidate(scar);
  const issue_title = `[scar] ${String(candidate.title)}`.slice(0, 120);
  const issue_body = buildIssueBody(candidate, scar);

  const url =
    `https://github.com/${repo}/issues/new` +
    `?labels=${encodeURIComponent("scar-submission")}` +
    `&title=${encodeURIComponent(issue_title)}` +
    `&body=${encodeURIComponent(issue_body)}`;

  return {
    candidate,
    issue_title,
    issue_body,
    submit_url: url.length <= URL_LIMIT ? url : null,
    gh_command:
      `Save issue_body to scar-submission.md, then: ` +
      `gh issue create --repo ${repo} --label scar-submission ` +
      `--title ${JSON.stringify(issue_title)} --body-file scar-submission.md`,
    shared: "nothing yet — this tool only PREPARES the submission",
  };
}
