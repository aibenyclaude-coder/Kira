import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { loadAllSkills, loadAllScars } from "./index-loader.js";
import { loadRoutes, resolveRoute } from "./route.js";
import { lookup, indexItems } from "./lookup.js";
import { record, logMiss } from "./report.js";
import { verifyProKey, resolveKiraKey } from "./license.js";
import { startFlusher, shutdownFlush } from "./telemetry.js";
import { KIRA_CONSENT_TOOL, handleKiraConsent } from "./tools/kira_consent.js";
import { KIRA_STATUS_TOOL, buildStatus, readVersion } from "./tools/kira_status.js";
import { KIRA_PREMORTEM_TOOL, buildPremortem } from "./tools/premortem.js";
import {
  KIRA_RECORD_FAILURE_TOOL,
  handleRecordFailure,
} from "./tools/record-failure.js";
import {
  KIRA_PERSONAL_BRIEF_TOOL,
  handlePersonalBrief,
} from "./tools/personal-brief.js";
import { KIRA_SHARE_SCAR_TOOL, handleShareScar } from "./tools/share-scar.js";
import { loadPersonalScars } from "./personal-scars.js";
import { logger } from "./logger.js";
import type { Skill, Scar, ReportStatus, ConsentLevel } from "./types.js";
import type { KiraTier } from "./license.js";

/**
 * A required string argument, or a thrown error that names what to send.
 *
 * `required` in a tool's inputSchema is a declaration, not an enforcement: the
 * low-level MCP Server does not check arguments against the schema, and the
 * clients calling it do not either. Measured on this machine's own traffic,
 * 2 of 51 real `kira_lookup` calls arrived with no `keyword` at all — one sent
 * `query`, the other `task` — and both reached this handler.
 *
 * `String(args?.x ?? "")` turned that into a query for the empty string, which
 * the matcher then answered on its merits. At the time those two calls landed
 * the empty query matched EVERY item and returned the whole corpus (101,948
 * characters, over the caller's token limit); on today's matcher it matches
 * nothing, so the same mistake now yields an empty result plus a phantom
 * empty-keyword entry in the flywheel's miss log. `kira_premortem` is worse
 * still: an empty goal reports "No known failure patterns match this goal" — a
 * confident all-clear from the tool whose entire job is to warn.
 *
 * Every one of those is silent. The agent cannot tell a mis-named parameter
 * from a corpus with nothing to say, so it reads the answer as fact and moves
 * on. Naming the expected parameter — and the unexpected keys that did arrive —
 * is what lets the next call be right.
 *
 * Only guards the MCP boundary. lookup()/buildPremortem() keep accepting any
 * string, including "", so the fuzz suite still proves they cannot be crashed.
 */
function requireStringArg(
  args: Record<string, unknown> | undefined,
  name: string,
  tool: string
): string {
  const value = args?.[name];
  if (typeof value === "string" && value.trim() !== "") return value;
  const unexpected = Object.keys(args ?? {}).filter((k) => k !== name);
  const received = unexpected.length
    ? ` Received ${unexpected.map((k) => `'${k}'`).join(", ")} instead — ` +
      `re-send that text as '${name}'.`
    : "";
  throw new Error(`${tool} requires a non-empty '${name}' string.${received}`);
}

const TOOLS = [
  {
    name: "kira_lookup",
    description:
      "Look up skills (how to do it) AND scars (what to avoid) for a given keyword. " +
      "Returns matching skills (community first, then vendor) and scars (critical first; " +
      "your own recorded failures before shared ones, then by frequency). Personal scars " +
      "recorded by kira_record_failure on this machine fire here too. " +
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
    annotations: {
      title: "Kira Lookup",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
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
    annotations: {
      title: "Kira Report",
      // Mutates remote state (telemetry queue + central D1 when consent=basic|full)
      // and the local NDJSON log; not a pure read.
      readOnlyHint: false,
      destructiveHint: false,
      // Same (skill_id, status) submitted twice are recorded as two distinct
      // events by design (frequency is signal), so this is not idempotent.
      idempotentHint: false,
      // Reaches the kira-telemetry Worker over the network when consent != off.
      openWorldHint: true,
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
    annotations: {
      title: "Kira Route",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
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
    annotations: {
      title: "Kira Get",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  KIRA_CONSENT_TOOL,
  KIRA_STATUS_TOOL,
  KIRA_PREMORTEM_TOOL,
  KIRA_RECORD_FAILURE_TOOL,
  KIRA_PERSONAL_BRIEF_TOOL,
  KIRA_SHARE_SCAR_TOOL,
];

export async function startServer(): Promise<void> {
  const tier: KiraTier = verifyProKey(resolveKiraKey());
  if (tier !== "free") {
    logger.info(
      tier === "pro"
        ? "Supporter key verified. Fresh community feed enabled."
        : "Contributor key verified — thanks for sharing a scar. Fresh community feed enabled.",
      { tier }
    );
  }

  const server = new Server(
    {
      name: "kira",
      version: readVersion(),
    },
    {
      capabilities: {
        tools: {},
      },
      /**
       * Written as situation → action, not as a tool manual.
       *
       * A manual tells a capable agent HOW to call the tools once it has already
       * decided to; it never fires, because deciding to look is the step that
       * gets skipped. The triggers below name the moments instead — and those
       * moments are recognisable from the work itself, before anything breaks.
       * Named activities ("release", "code review", "移行") return the whole
       * bundle for that activity, which is why the first trigger is a task name
       * rather than a symptom.
       */
      instructions:
        "Kira gives you the failures other engineers already hit (scars) and the procedures that " +
        "survived them (skills), so you do not pay for the same mistake twice.\n\n" +
        "CALL kira_lookup BEFORE YOU ACT, in these moments:\n" +
        "• You are about to start a named activity — releasing, deploying, reviewing code, " +
        "upgrading dependencies, migrating data, setting up a project, writing tests, automating " +
        "something, debugging. Pass the activity name itself ('release', 'code review', 'リリース'): " +
        "it returns every scar that fires during that activity, not just keyword matches.\n" +
        "• You are about to do something hard to undo — publishing, deleting, force-pushing, " +
        "editing production config, running a migration.\n" +
        "• You are returning to an area that has burned you or anyone before.\n" +
        "• Your plan rests on a guess about a tool, API, or platform you have not verified today.\n\n" +
        "Read the scars FIRST — they say what NOT to do, and each carries a concrete 'instead'. " +
        "A scar you did not read costs exactly as much as one that was never written.\n\n" +
        "AFTER YOU ACT:\n" +
        "• Retried, threw, or worked around something? Call kira_record_failure. It becomes a " +
        "personal scar (local-only) that fires automatically in your future lookups on this machine. " +
        "Record it while you still remember why it happened — a week later you will only remember that it did.\n" +
        "• If that failure would also bite someone on a different machine or project, call " +
        "kira_share_scar to prepare it for the shared catalog. Nothing is uploaded without you.\n" +
        "• Call kira_report with the outcome so the catalog learns which procedures actually hold.\n\n" +
        "MECHANICS: kira_lookup and kira_route return summaries WITHOUT instructions to save tokens — " +
        "call kira_get(id) for the full text before executing. For a broad goal ('build a web app') " +
        "use kira_route to get ordered steps. Before a task with a history of going wrong, " +
        "kira_premortem(goal) returns a heat map of how it has failed. If lookup returns 0 results, " +
        "read 'near_skills' / 'near_scars' — and read 'near_scars' even when a skill matched, since " +
        "it is the closest warning the catalog has. Every miss is logged locally so the catalog " +
        "learns what was asked for.",
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
      const keyword = requireStringArg(args, "keyword", "kira_lookup");
      const context = Array.isArray(args?.context)
        ? (args.context as string[])
        : undefined;

      // Personal scars (kira_record_failure output) join the corpus on every
      // call — re-read from disk so a failure recorded seconds ago already
      // fires. The directory is a handful of small files; freshness wins.
      const personal = indexItems(await loadPersonalScars());
      const result = lookup(skills, [...scars, ...personal], { keyword, context });

      // Miss log = flywheel loop B input. Near info tells the maintainer
      // whether the fix is "add an alias to skill X" or "a skill is missing".
      if (result.skill_count === 0 && result.scar_count === 0) {
        const near = [...(result.near_skills ?? []), ...(result.near_scars ?? [])].map(
          (n) => ({ id: n.id, score: n.score })
        );
        logMiss(keyword, context ?? [], near).catch(() => {});
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

    if (name === "kira_premortem") {
      const goal = requireStringArg(args, "goal", "kira_premortem");
      const context = Array.isArray(args?.context)
        ? (args.context as string[])
        : undefined;
      const top_k =
        typeof args?.top_k === "number" ? (args.top_k as number) : undefined;

      // The heat map covers shared AND personal scars — your own recorded
      // failures are exactly what a pre-mortem must not miss. Shipped corpus
      // is indexed once at startup; only the tiny personal set per call.
      const personal = indexItems(await loadPersonalScars());
      const result = buildPremortem([...scars, ...personal], {
        goal,
        context,
        top_k,
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

    if (name === "kira_record_failure") {
      const result = await handleRecordFailure(args);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    if (name === "kira_personal_brief") {
      const result = await handlePersonalBrief(args);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    if (name === "kira_share_scar") {
      const result = await handleShareScar(args);
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
      const goal = requireStringArg(args, "goal", "kira_route");
      const context = Array.isArray(args?.context)
        ? (args.context as string[])
        : undefined;

      // The route is the FIRST call the instructions above tell an agent to
      // make for a broad goal — and it was the one recall path blind to this
      // machine's own recorded failures. kira_lookup and kira_premortem both
      // merge personal scars; route passed the bare shared corpus, so the
      // ranking rule in lookup() ("at equal severity your own recorded
      // failures come first") described a branch route could never reach.
      // Each step resolves through the same lookup(), so merging here is all
      // it takes. Same freshness contract as kira_lookup: re-read per call.
      const personal = indexItems(await loadPersonalScars());
      const result = resolveRoute(routes, skills, [...scars, ...personal], {
        goal,
        context,
      });

      // route is the FIRST call the instructions above tell an agent to make
      // for a broad goal, yet it was the one recall path blind to its own
      // misses while those instructions promise "every miss is recorded".
      // A goal that maps to no route is the loudest demand signal there is —
      // it asks the maintainer to author a whole ROUTE — so log it, tagged
      // kind:"route" so the flywheel counts it as a route gap and never mixes
      // it into the lookup-miss clusters that drive skill/alias candidates.
      // near is empty: matchRoute reports only a match or nothing, and the
      // goal string is the signal a route author needs.
      if (result.step_count === 0) {
        logMiss(goal, context ?? [], [], "route").catch(() => {});
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

    if (name === "kira_get") {
      const id = String(args?.id ?? "");
      // Personal scars are addressable by id too (they appear in lookup).
      const personal = id.startsWith("scar.personal.")
        ? await loadPersonalScars()
        : [];

      const skill = skills.find((s) => s.id === id) ?? null;
      const scar =
        scars.find((s) => s.id === id) ??
        personal.find((p) => p.id === id) ??
        null;

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
        ? rawScars.find((s) => s.id === id) ??
          personal.find((p) => p.id === id) ??
          null
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
