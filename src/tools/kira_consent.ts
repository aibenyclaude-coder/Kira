/**
 * `kira_consent` MCP tool — set or query telemetry consent.
 *
 * Levels:
 *  - "off"   : nothing leaves the machine (still appended to local log)
 *  - "basic" : skill_id, status, anonymous client_id, version, env hints
 *  - "full"  : basic + sanitized note/context (free text from agent)
 *
 * Transitioning to "off" regenerates the anonymous client_id so re-opting-in
 * starts a new identity.
 */
import { setConsent, loadConsent } from "../consent.js";
import type { ConsentLevel, ConsentState } from "../types.js";

export const KIRA_CONSENT_TOOL = {
  name: "kira_consent",
  description:
    "Set the telemetry consent level for kira_report. " +
    "level='off' disables all uploads (local log still written). " +
    "level='basic' uploads only anonymous core (skill_id, status, anonymous UUID, version, OS family, Node major). " +
    "level='full' additionally uploads sanitized free-text note/context. " +
    "Call with no arguments to query the current state. " +
    "See PRIVACY.md for the exact wire format and redaction rules.",
  inputSchema: {
    type: "object",
    properties: {
      level: {
        type: "string",
        enum: ["off", "basic", "full"],
        description: "New consent level. Omit to query without changing.",
      },
    },
    required: [],
  },
  annotations: {
    title: "Kira Consent",
    // Persists ~/.kira/consent.json; not a pure read.
    readOnlyHint: false,
    // Setting a level cannot harm the user's environment or external state;
    // worst case the user re-runs to flip back. Not destructive.
    destructiveHint: false,
    // Calling with the same level twice converges on the same end state
    // (modulo a regenerated client_id when transitioning to "off").
    idempotentHint: true,
    openWorldHint: false,
  },
} as const;

interface KiraConsentArgs {
  level?: ConsentLevel;
}

export async function handleKiraConsent(
  args: KiraConsentArgs | undefined
): Promise<ConsentState> {
  const level = args?.level;
  if (level === undefined) return loadConsent();
  if (!["off", "basic", "full"].includes(level)) {
    throw new Error(`Invalid level "${level}". Must be off, basic, or full.`);
  }
  return setConsent(level, "tool");
}
