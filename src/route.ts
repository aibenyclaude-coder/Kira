import { readFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  Skill,
  Scar,
  RouteStep,
  RouteRequest,
  RouteResponse,
} from "./types.js";
import { lookup, type Indexed } from "./lookup.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROUTES_DIR = join(__dirname, "..", "routes");

interface RouteDefinition {
  id: string;
  goals: string[];
  contexts: string[];
  title: string;
  description: string;
  steps: Array<{
    order: number;
    keyword: string;
    description: string;
  }>;
}

// ── Load route definitions ─────────────────────────────────────────────

export async function loadRoutes(): Promise<RouteDefinition[]> {
  const routes: RouteDefinition[] = [];
  let files: string[];
  try {
    files = await readdir(ROUTES_DIR);
  } catch {
    return [];
  }

  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const raw = await readFile(join(ROUTES_DIR, file), "utf-8");
    routes.push(JSON.parse(raw) as RouteDefinition);
  }
  return routes;
}

// ── Match goal to route ────────────────────────────────────────────────

function matchRoute(
  routes: RouteDefinition[],
  goal: string,
  contexts: string[]
): RouteDefinition | null {
  const normalizedGoal = goal.toLowerCase().trim();
  const normalizedContexts = contexts.map((c) => c.toLowerCase());

  // Exact goal match
  for (const route of routes) {
    if (route.goals.some((g) => g.toLowerCase() === normalizedGoal)) {
      if (normalizedContexts.length === 0) return route;
      if (route.contexts.some((c) => normalizedContexts.includes(c.toLowerCase()))) {
        return route;
      }
    }
  }

  // Partial goal match (goal contains a route goal phrase)
  for (const route of routes) {
    if (route.goals.some((g) => normalizedGoal.includes(g.toLowerCase()))) {
      if (normalizedContexts.length === 0) return route;
      if (route.contexts.some((c) => normalizedContexts.includes(c.toLowerCase()))) {
        return route;
      }
    }
  }

  return null;
}

// ── Build route response ───────────────────────────────────────────────

/**
 * Given a goal, find the matching route definition and resolve
 * each step to its Skill + Scars via lookup.
 *
 * Returns an ordered list of steps, each with the resolved Skill
 * and any relevant Scars. The agent follows these in order.
 */
export function resolveRoute(
  routes: RouteDefinition[],
  allSkills: (Skill & Indexed)[],
  allScars: (Scar & Indexed)[],
  request: RouteRequest
): RouteResponse {
  const contexts = request.context ?? [];
  const matched = matchRoute(routes, request.goal, contexts);

  if (!matched) {
    return {
      goal: request.goal,
      steps: [],
      step_count: 0,
      coverage: "no matching route found",
    };
  }

  const steps: RouteStep[] = matched.steps.map((stepDef) => {
    const result = lookup(allSkills, allScars, {
      keyword: stepDef.keyword,
      context: contexts,
    });

    // When multiple skills match, prefer the one whose keywords
    // most closely match the step keyword (longer overlap = better fit).
    let selectedSkill = result.skills[0] ?? null;
    if (result.skills.length > 1) {
      const stepKw = stepDef.keyword.toLowerCase();
      const exact = result.skills.find((s) =>
        s.keywords.some((k) => k.toLowerCase() === stepKw)
      );
      if (exact) selectedSkill = exact;
    }

    return {
      order: stepDef.order,
      keyword: stepDef.keyword,
      skill: selectedSkill,
      scars: result.scars,
      description: stepDef.description,
    };
  });

  const covered = steps.filter((s) => s.skill !== null).length;
  const total = steps.length;

  return {
    goal: request.goal,
    steps,
    step_count: total,
    coverage: `${covered}/${total} steps have skills`,
  };
}
