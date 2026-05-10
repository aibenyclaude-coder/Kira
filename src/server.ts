import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { loadAllSkills, loadAllScars } from "./index-loader.js";
import { loadRoutes, resolveRoute } from "./route.js";
import { lookup, indexItems } from "./lookup.js";
import { record, logMissingKeyword } from "./report.js";
import { verifyProKey } from "./license.js";
import { startFlusher, shutdownFlush } from "./telemetry.js";
import { KIRA_CONSENT_TOOL, handleKiraConsent } from "./tools/kira_consent.js";
import { KIRA_STATUS_TOOL, buildStatus } from "./tools/kira_status.js";
import type { Skill, Scar, ReportStatus, ConsentLevel } from "./types.js";
import type { KiraTier } from "./license.js";

const TOOLS = [
  {
    name: "kira_lookup",
    description:
      "Look up skills (how to do it) AND scars (what to avoid) for a given keyword. " +
      "Returns matching skills (community first, then vendor) and scars (critical first, then by frequency). " +
      "The agent MUST: " +
      "1. Read ALL returned scars first — these are past failures. Avoid repeating them. " +
      "2. Read returned skills and choose the best fit for the project context. " +
      "3. ANNOUNCE the chosen skill's 'declaration' field to the user BEFORE executing. " +
      "4. Follow the skill's instructions step by step, watching for scar patterns.",
    inputSchema: {
      type: "object",
      properties: {
        keyword: {
          type: "string",
          description:
            "The firing keyword or phrase (e.g., 'deploy vercel', 'add auth'). Case-insensitive.",
        },
        context: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional project context tags for disambiguation (e.g., ['nextjs', 'typescript']).",
        },
      },
      required: ["keyword"],
    },
  },
  {
    name: "kira_report",
    description:
      "Report the outcome of applying a Kira skill. " +
      "ALWAYS call this after completing (or failing) a task guided by a Kira skill. " +
      "Statuses: 'success' = worked first try, 'retry' = needed extra attempts, 'failure' = gave up. " +
      "For 'retry' and 'failure', include a note describing what went wrong — " +
      "this feeds the scar system so other agents don't repeat the same mistake.",
    inputSchema: {
      type: "object",
      properties: {
        skill_id: {
          type: "string",
          description: "The id of the skill that was applied.",
        },
        status: {
          type: "string",
          enum: ["success", "retry", "failure"],
        },
        note: {
          type: "string",
          description:
            "What went wrong (for retry/failure). This becomes a scar for future agents. Sent to the telemetry server only when consent level is 'full'.",
        },
        context: {
          type: "string",
          description:
            "Optional sanitized snippet of agent context (project type, framework, etc.). Sent only when consent level is 'full'.",
        },
      },
      required: ["skill_id", "status"],
    },
  },
  {
    name: "kira_route",
    description:
      "Plan a complete route for a goal. Instead of looking up individual skills, " +
      "describe what you want to achieve (e.g., 'build a web app', 'add payments') " +
      "and Kira returns an ordered sequence of steps, each with its Skill and Scars. " +
      "Use this FIRST when the user describes a broad goal rather than a specific task. " +
      "Then execute each step in order, calling kira_report after each one.",
    inputSchema: {
      type: "object",
      properties: {
        goal: {
          type: "string",
          description:
            "The user's goal in natural language (e.g., 'build a nextjs app', 'add payments', 'deploy my app').",
        },
        context: {
          type: "array",
          items: { type: "string" },
          description:
            "Project context tags (e.g., ['nextjs', 'typescript']).",
        },
      },
      required: ["goal"],
    },
  },
  {
    name: "kira_get",
    description:
      "Get the full instructions for a specific skill or scar by ID. " +
      "Call this AFTER kira_lookup to retrieve the step-by-step instructions " +
      "for the skill you've chosen. lookup returns summaries (no instructions) " +
      "to save tokens — use this tool to get the full details.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description:
            "The skill or scar ID (e.g., 'community.setup-stripe-nextjs.v1' or 'scar.vercel-env-vars-missing.v1').",
        },
      },
      required: ["id"],
    },
  },
  KIRA_CONSENT_TOOL,
  KIRA_STATUS_TOOL,
];

export async function startServer(): Promise<void> {
  const tier: KiraTier = verifyProKey(process.env.KIRA_PRO_KEY);
  if (tier === "pro") {
    // eslint-disable-next-line no-console
    console.error("[kira] Pro license verified. Real-time updates enabled.");
  }

  const server = new Server(
    {
      name: "kira",
      version: "0.4.0",
    },
    {
      capabilities: {
        tools: {},
      },
      instructions:
        "Kira manages your skills (how to do things) and scars (what to avoid). " +
        "WORKFLOW: " +
        "1. For BROAD GOALS ('build a web app'): call kira_route → get ordered steps. " +
        "2. For SPECIFIC TASKS ('deploy to vercel'): call kira_lookup → get matching skills/scars. " +
        "3. Read scars FIRST to know what NOT to do. " +
        "4. Choose a skill, then call kira_get(skill_id) to get full instructions. " +
        "5. Follow the instructions step by step. " +
        "6. Call kira_report with the outcome (especially 'retry' with a note on what went wrong). " +
        "IMPORTANT: kira_lookup and kira_route return summaries WITHOUT instructions to save tokens. " +
        "Always call kira_get to fetch the full instructions before executing. " +
        "If lookup returns 0 results, check 'suggestions' for alternatives. " +
        "Kira is community-vetted and designed for zero-retry execution.",
    }
  );

  const [rawSkills, rawScars, routes] = await Promise.all([
    loadAllSkills(tier),
    loadAllScars(tier),
    loadRoutes(),
  ]);
  const skills = indexItems(rawSkills);
  const scars = indexItems(rawScars);

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === "kira_lookup") {
      const keyword = String(args?.keyword ?? "");
      const context = Array.isArray(args?.context)
        ? (args.context as string[])
        : undefined;

      const result = lookup(skills, scars, { keyword, context });

      // Log missing keywords for patrol jobs to pick up.
      if (result.skill_count === 0 && result.scar_count === 0) {
        logMissingKeyword(keyword, context ?? []).catch(() => {});
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    if (name === "kira_report") {
      const skill_id = String(args?.skill_id ?? "").slice(0, 200);
      const status = String(args?.status ?? "");
      const note = args?.note ? String(args.note).slice(0, 1000) : undefined;
      const context = args?.context ? String(args.context).slice(0, 4000) : undefined;

      if (!/^[a-z0-9][a-z0-9._-]*$/.test(skill_id)) {
        throw new Error(
          `Invalid skill_id "${skill_id}". Must match /^[a-z0-9][a-z0-9._-]*$/.`
        );
      }
      if (!["success", "retry", "failure"].includes(status)) {
        throw new Error(
          `Invalid status "${status}". Must be one of: success, retry, failure.`
        );
      }

      const result = await record(
        {
          skill_id,
          status: status as ReportStatus,
          note,
          context,
        },
        tier
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    if (name === "kira_consent") {
      const level = args?.level as ConsentLevel | undefined;
      const result = await handleKiraConsent({ level });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    if (name === "kira_status") {
      const result = await buildStatus({
        tier,
        skills: rawSkills,
        scars: rawScars,
        routesCount: routes.length,
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    if (name === "kira_route") {
      const goal = String(args?.goal ?? "");
      const context = Array.isArray(args?.context)
        ? (args.context as string[])
        : undefined;

      const result = resolveRoute(routes, skills, scars, { goal, context });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    if (name === "kira_get") {
      const id = String(args?.id ?? "");

      const skill = skills.find((s) => s.id === id) ?? null;
      const scar = scars.find((s) => s.id === id) ?? null;

      if (!skill && !scar) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: `No skill or scar found with id "${id}"` }),
            },
          ],
        };
      }

      // Return original skill with full instructions (re-read from raw)
      const fullSkill = skill
        ? rawSkills.find((s) => s.id === id) ?? null
        : null;
      const fullScar = scar
        ? rawScars.find((s) => s.id === id) ?? null
        : null;

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ skill: fullSkill, scar: fullScar }, null, 2),
          },
        ],
      };
    }

    throw new Error(`Unknown tool: ${name}`);
  });

  startFlusher();
  const onShutdown = (signal: NodeJS.Signals) => {
    void shutdownFlush().finally(() => {
      process.exit(signal === "SIGTERM" ? 143 : 130);
    });
  };
  process.once("SIGTERM", onShutdown);
  process.once("SIGINT", onShutdown);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
