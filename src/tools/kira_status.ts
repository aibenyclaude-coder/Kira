/**
 * `kira_status` MCP tool — quick "what's available right now" probe.
 *
 * Returns the kira version, free/pro tier, telemetry consent level, counts
 * of loaded skills/scars/routes, and the path of the local report log.
 * Lets agents (and operators) introspect the install in one call instead
 * of running lookup with random keywords to discover what's loaded.
 */
import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConsent } from "../consent.js";
import { REPORTS_LOG, TELEMETRY_URL } from "../telemetry.js";
import type { Skill, Scar, ConsentState } from "../types.js";
import type { KiraTier } from "../license.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_JSON = join(__dirname, "..", "..", "package.json");

function readVersion(): string {
  try {
    return (JSON.parse(readFileSync(PACKAGE_JSON, "utf-8")) as { version?: string })
      .version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export const KIRA_STATUS_TOOL = {
  name: "kira_status",
  description:
    "Report what's currently loaded and configured: kira version, tier (free/pro), " +
    "telemetry consent level, counts of skills/scars/routes available, and where the " +
    "local report log lives. Call this whenever you need to know the install state " +
    "without exhausting the keyword search via lookup.",
  inputSchema: {
    type: "object",
    properties: {},
    required: [],
  },
  annotations: {
    title: "Kira Status",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
} as const;

export interface KiraStatusResult {
  kira_version: string;
  tier: KiraTier;
  consent: ConsentState;
  counts: {
    skills: number;
    scars: number;
    routes: number;
  };
  paths: {
    reports_log: string;
    reports_log_exists: boolean;
    consent_file: string;
    telemetry_url: string;
  };
}

interface BuildArgs {
  tier: KiraTier;
  skills: Skill[];
  scars: Scar[];
  routesCount: number;
}

export async function buildStatus({
  tier,
  skills,
  scars,
  routesCount,
}: BuildArgs): Promise<KiraStatusResult> {
  const consent = await loadConsent();
  return {
    kira_version: readVersion(),
    tier,
    consent,
    counts: {
      skills: skills.length,
      scars: scars.length,
      routes: routesCount,
    },
    paths: {
      reports_log: REPORTS_LOG,
      reports_log_exists: existsSync(REPORTS_LOG),
      consent_file: join(
        process.env.KIRA_HOME ?? `${process.env.HOME}/.kira`,
        "consent.json"
      ),
      telemetry_url: TELEMETRY_URL,
    },
  };
}
