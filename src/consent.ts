/**
 * Telemetry consent state.
 *
 * Resolution precedence:
 *   1. KIRA_TELEMETRY env var (off|basic|full) — never persisted.
 *   2. ~/.kira/consent.json
 *   3. First-run default = "basic" (anonymous core only); detail requires opt-in.
 *
 * client_id is regenerated whenever the level transitions to "off",
 * so re-opting-in starts a new identity.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ConsentLevel, ConsentState } from "./types.js";

export const KIRA_HOME = process.env.KIRA_HOME ?? join(homedir(), ".kira");
export const CONSENT_FILE = join(KIRA_HOME, "consent.json");

function parseEnvLevel(v: string | undefined): ConsentLevel | null {
  if (!v) return null;
  const lower = v.toLowerCase();
  return lower === "off" || lower === "basic" || lower === "full" ? lower : null;
}

function newId(): string {
  return randomUUID();
}

async function readConsentFile(): Promise<ConsentState | null> {
  try {
    const raw = await readFile(CONSENT_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Partial<ConsentState>;
    if (
      parsed?.v === 1 &&
      (parsed.level === "off" || parsed.level === "basic" || parsed.level === "full") &&
      typeof parsed.client_id === "string" &&
      parsed.client_id.length > 0
    ) {
      return parsed as ConsentState;
    }
    return null; // corrupt or unknown shape
  } catch {
    return null;
  }
}

async function writeConsentFile(state: ConsentState): Promise<void> {
  await mkdir(KIRA_HOME, { recursive: true });
  await writeFile(CONSENT_FILE, JSON.stringify(state, null, 2) + "\n", "utf-8");
}

/**
 * Resolve the effective consent state.
 *
 * If KIRA_TELEMETRY is set, returns an in-memory state (not persisted).
 * Otherwise loads from disk; if no file exists, creates a default
 * "basic" state and persists it.
 */
export async function loadConsent(): Promise<ConsentState> {
  const envLevel = parseEnvLevel(process.env.KIRA_TELEMETRY);
  if (envLevel !== null) {
    const onDisk = await readConsentFile();
    return {
      v: 1,
      level: envLevel,
      client_id: onDisk?.client_id ?? newId(),
      decided_at: new Date().toISOString(),
      source: "env",
    };
  }

  const existing = await readConsentFile();
  if (existing) return existing;

  const fresh: ConsentState = {
    v: 1,
    level: "basic",
    client_id: newId(),
    decided_at: new Date().toISOString(),
    source: "default_basic",
  };
  await writeConsentFile(fresh);
  return fresh;
}

/**
 * Update the persisted consent level. Called by the kira_consent MCP tool.
 *
 * - Transitioning to "off" generates a new client_id so future opt-ins
 *   are not linkable to past activity.
 * - Env var is NOT modified by this function — runtime overrides still
 *   take precedence per resolution rules.
 */
export async function setConsent(
  level: ConsentLevel,
  source: ConsentState["source"] = "tool"
): Promise<ConsentState> {
  const current = (await readConsentFile()) ?? null;
  const next: ConsentState = {
    v: 1,
    level,
    client_id: level === "off" || !current ? newId() : current.client_id,
    decided_at: new Date().toISOString(),
    source,
  };
  await writeConsentFile(next);
  return next;
}

/**
 * Has the user been shown the consent prompt at least once?
 * The MCP server returns the prompt text on the first kira_report call
 * and then marks the state to suppress repeats.
 *
 * Env override (KIRA_TELEMETRY=...) counts as a deliberate choice, so we
 * suppress the prompt in that case. No file → not seen. File present with
 * source="default_basic" → not seen yet (auto-created at first launch).
 * Any other source means the user has acknowledged.
 */
export async function hasSeenPrompt(): Promise<boolean> {
  if (parseEnvLevel(process.env.KIRA_TELEMETRY) !== null) return true;
  const state = await readConsentFile();
  if (!state) return false;
  return state.source !== "default_basic";
}

/**
 * Mark the prompt as seen by promoting source from "default_basic"
 * to "first_run_prompt". Reloads the file (rather than caching the
 * pre-prompt state) so concurrent enqueue→loadConsent calls don't
 * race the file-creation step.
 */
export async function markPromptSeen(): Promise<void> {
  const state = (await readConsentFile()) ?? (await loadConsent());
  if (state.source === "default_basic") {
    await writeConsentFile({ ...state, source: "first_run_prompt" });
  }
}
