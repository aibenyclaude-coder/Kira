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
  recordPersonalScar,
  personalScarPath,
  describeScarRedactions,
  type PersonalScar,
  type RecordFailureInput,
  type ScarRedactionReport,
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
  const scar = await recordPersonalScar(input);
  return {
    ack: true,
    scar,
    path: personalScarPath(scar.id),
    stored: "local-only",
    ...(redactions && { redactions: { ...redactions, note: redactionNote(redactions) } }),
  };
}
