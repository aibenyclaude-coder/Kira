/**
 * `kira_record_failure` MCP tool — capture a retry or exception as a personal scar.
 *
 * The agent calls this right after a task needed extra attempts or threw, so
 * future runs ON THIS MACHINE can avoid the same wall. The failure is stored as
 * a local-only "personal scar" (see personal-scars.ts) — it is sanitized before
 * it touches disk and is NEVER uploaded, on any tier. This tool performs no
 * network I/O and writes nothing to stdout (stdout is the MCP transport).
 */
import {
  recordPersonalScarDetailed,
  personalScarPath,
  describeScarRedactions,
  describeGluedFields,
  type PersonalScar,
  type RecordFailureInput,
  type ScarFoldReport,
  type ScarRedactionReport,
  type ScarStructureReport,
} from "../personal-scars.js";
import type { ScarSeverity } from "../types.js";

export const KIRA_RECORD_FAILURE_TOOL = {
  name: "kira_record_failure",
  description:
    "Capture a retry or exception you just hit as a PERSONAL scar — a private, " +
    "local-only failure note stored under ~/.kira/personal-scars/. " +
    "Call this immediately after a task needed extra attempts or threw an error, " +
    "so future runs on this machine can avoid the same wall. " +
    "Provide 'title' (what went wrong), 'mistake' (what was done / the exception), " +
    "and ideally 'instead' (what to do next time). " +
    "All free text is sanitized (keys, paths, emails redacted) before it touches " +
    "disk; the response's 'redactions' field reports anything that was rewritten, " +
    "so check it and re-record if a redaction hit something that was not a secret. " +
    "A 'malformed' field means this call's parameters were glued together in " +
    "transport and a field's text was lost — re-record with one long field at a time. " +
    "A 'folded' field means this was merged into an EXISTING scar as a recurrence: " +
    "the returned scar is that older one and your title/mistake were not stored, so " +
    "check 'folded.into_title' and re-record if it describes a different failure. " +
    "Personal scars are LOCAL-ONLY — they are never uploaded, on any tier.",
  inputSchema: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "Short summary of what went wrong (becomes the scar title).",
      },
      mistake: {
        type: "string",
        description:
          "What the agent did wrong, or the exception / retry cause. The pattern " +
          "to recognize and avoid next time.",
      },
      instead: {
        type: "string",
        description: "What to do instead next time (the fix / avoidance strategy).",
      },
      summary: {
        type: "string",
        description: "Optional one-line summary. Defaults to the title.",
      },
      keywords: {
        type: "array",
        items: { type: "string" },
        description: "Firing keywords so this scar surfaces on future lookups.",
      },
      contexts: {
        type: "array",
        items: { type: "string" },
        description: "Project context tags (e.g., ['nextjs', 'typescript']).",
      },
      severity: {
        type: "string",
        enum: ["warning", "critical"],
        description: "Defaults to 'warning'.",
      },
    },
    required: ["title", "mistake"],
  },
  annotations: {
    title: "Kira Record Failure",
    // Writes a JSON file under ~/.kira/personal-scars/; not a pure read.
    readOnlyHint: false,
    // Only creates/updates a local scar file — cannot harm the user's env.
    destructiveHint: false,
    // Re-recording the same failure bumps hit_count (frequency is signal),
    // so repeated calls change local state.
    idempotentHint: false,
    // Local-only: never reaches the network on any tier.
    openWorldHint: false,
  },
} as const;

export interface RecordFailureResult {
  ack: true;
  scar: PersonalScar;
  /** Absolute path of the local file the scar was written to. */
  path: string;
  /** Reassures the agent/user that nothing left the machine. */
  stored: "local-only";
  /**
   * Present ONLY when the sanitizer rewrote the submitted text. Absent means
   * the stored scar says exactly what the caller sent.
   */
  redactions?: ScarRedactionReport & { note: string };
  /**
   * Present ONLY when a submitted field carried a literal tag naming another
   * parameter — the signature of a call whose parameters were glued together in
   * transport. Absent means the arguments arrived intact.
   */
  malformed?: ScarStructureReport & { note: string };
  /**
   * Present ONLY when this recording was merged into an existing scar as a
   * recurrence. Absent means `scar` is this call's own new scar.
   */
  folded?: ScarFoldReport & { note: string };
}

/** Caller-facing explanation of a rewrite, sized for an agent to act on. */
function redactionNote(r: ScarRedactionReport): string {
  const parts: string[] = [];
  if (r.count > 0) {
    parts.push(
      `The sanitizer rewrote ${r.count} span${r.count === 1 ? "" : "s"} in ${r.fields.join(", ")} ` +
        `(${r.patterns.join(", ")}), so the stored scar differs from what you sent.`
    );
  }
  if (r.truncated.length > 0) {
    parts.push(`Over the length cap, tail dropped: ${r.truncated.join(", ")}.`);
  }
  parts.push(
    "Redaction is intentional for real secrets, but it also fires on things that " +
      "are not secrets — `pkg@1.2.3` reads as an email, `JST=UTC+9` as an env " +
      "assignment. Check scar.mistake / scar.instead above: if a redaction ate the " +
      "detail the lesson depends on, rephrase it (quote or space out the value) and " +
      "record again."
  );
  return parts.join(" ");
}

/** Caller-facing explanation of a glued call, sized for an agent to act on. */
function malformedNote(r: ScarStructureReport): string {
  const parts = [
    `${r.fields.join(", ")} contains a literal tag naming ${r.glued.join(", ")}, ` +
      "which means this call's parameters were glued together in transport: the " +
      "stored scar holds markup where lesson text belongs.",
  ];
  if (r.lost.length > 0) {
    parts.push(
      `${r.lost.join(", ")} arrived empty — that text was swallowed, not sent.`
    );
  }
  parts.push(
    "Nothing was rewritten. Check scar.mistake / scar.instead above: if the tag " +
      "was not intentional, delete the file at 'path' and record again with at " +
      "most ONE long free-text field per call (two long fields back to back is " +
      "what produces the glue)."
  );
  return parts.join(" ");
}

/** Caller-facing explanation of a merge, sized for an agent to act on. */
function foldNote(r: ScarFoldReport): string {
  const parts = [
    `This recording was merged into an EXISTING scar as a recurrence ` +
      `(similarity ${r.similarity}, hit_count now ${r.hit_count}): "${r.into_title}". ` +
      "The scar above is that older one — 'scar' and 'path' are not this call's own.",
  ];
  parts.push(
    r.dropped.length > 0
      ? `Your ${r.dropped.join(", ")} ${r.dropped.length === 1 ? "is" : "are"} ` +
          "not stored anywhere: the merge kept the older wording."
      : "Nothing you sent was lost — the merged scar already said it."
  );
  parts.push(
    "If this was a different failure, the merge was wrong and the lesson you " +
      "just wrote now exists nowhere. Read scar.title / scar.mistake at 'path': " +
      "when they describe something else, edit that file back and re-record with " +
      "wording that does not restate the other scar's."
  );
  return parts.join(" ");
}

/**
 * Validate raw MCP arguments and persist the personal scar.
 * Throws (never returns an error envelope) on invalid input, matching the
 * other tool handlers in this repo.
 */
export async function handleRecordFailure(
  args: unknown
): Promise<RecordFailureResult> {
  const a = (args ?? {}) as Record<string, unknown>;

  const title = typeof a.title === "string" ? a.title.trim() : "";
  const mistake = typeof a.mistake === "string" ? a.mistake.trim() : "";
  if (!title) {
    throw new Error("kira_record_failure requires a non-empty 'title'.");
  }
  if (!mistake) {
    throw new Error("kira_record_failure requires a non-empty 'mistake'.");
  }

  const severity = a.severity;
  if (severity !== undefined && severity !== "warning" && severity !== "critical") {
    throw new Error(
      `Invalid severity "${String(severity)}". Must be "warning" or "critical".`
    );
  }
  if (a.keywords !== undefined && !Array.isArray(a.keywords)) {
    throw new Error("'keywords' must be an array of strings.");
  }
  if (a.contexts !== undefined && !Array.isArray(a.contexts)) {
    throw new Error("'contexts' must be an array of strings.");
  }

  const input: RecordFailureInput = {
    title,
    mistake,
    instead: typeof a.instead === "string" ? a.instead : undefined,
    summary: typeof a.summary === "string" ? a.summary : undefined,
    keywords: Array.isArray(a.keywords)
      ? a.keywords.filter((x): x is string => typeof x === "string")
      : undefined,
    contexts: Array.isArray(a.contexts)
      ? a.contexts.filter((x): x is string => typeof x === "string")
      : undefined,
    severity: severity as ScarSeverity | undefined,
  };

  const redactions = describeScarRedactions(input);
  const malformed = describeGluedFields(input);
  const { scar, fold } = await recordPersonalScarDetailed(input);
  return {
    ack: true,
    scar,
    path: personalScarPath(scar.id),
    stored: "local-only",
    ...(redactions && { redactions: { ...redactions, note: redactionNote(redactions) } }),
    ...(malformed && { malformed: { ...malformed, note: malformedNote(malformed) } }),
    ...(fold && { folded: { ...fold, note: foldNote(fold) } }),
  };
}
