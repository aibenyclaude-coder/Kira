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

export interface RouteDefinition {
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
    // readdir order is filesystem-defined, not alphabetical. Sort so the loaded
    // order is at least stable; matchRoute must not depend on it either way.
    files = (await readdir(ROUTES_DIR)).sort();
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

interface GoalMatch {
  route: RouteDefinition;
  exact: boolean;
  /** Length of the route goal phrase that matched — longer means more specific. */
  phraseLength: number;
}

/** A route is eligible when no context is requested, or one of its contexts is. */
function contextAllows(
  route: RouteDefinition,
  normalizedContexts: string[]
): boolean {
  if (normalizedContexts.length === 0) return true;
  return route.contexts.some((c) => normalizedContexts.includes(c.toLowerCase()));
}

/**
 * Rank two matches: an exact goal beats a partial one, then the longest matched
 * phrase wins (a goal saying "build a nextjs app ... and go live" is asking for
 * the build, not just the deploy), and route id settles true ties. Every term is
 * a property of the match itself, never of where the route sat in the array.
 */
function outranks(a: GoalMatch, b: GoalMatch): boolean {
  if (a.exact !== b.exact) return a.exact;
  if (a.phraseLength !== b.phraseLength) return a.phraseLength > b.phraseLength;
  return a.route.id < b.route.id;
}

function matchRoute(
  routes: RouteDefinition[],
  goal: string,
  contexts: string[]
): RouteDefinition | null {
  const normalizedGoal = goal.toLowerCase().trim();
  const normalizedContexts = contexts.map((c) => c.toLowerCase());

  let best: GoalMatch | null = null;
  for (const route of routes) {
    if (!contextAllows(route, normalizedContexts)) continue;

    for (const rawGoal of route.goals) {
      const g = rawGoal.toLowerCase().trim();
      const exact = g === normalizedGoal;
      if (!exact && !normalizedGoal.includes(g)) continue;

      const match: GoalMatch = { route, exact, phraseLength: g.length };
      if (best === null || outranks(match, best)) best = match;
    }
  }

  return best?.route ?? null;
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

    // Skills that claim this step's keyword OUTRIGHT. More than one can: "add
    // auth" is declared by both the Auth.js and the Clerk skill, and nothing in
    // the schema ranks them, because they are not better and worse — they are
    // alternatives. Picking with .find() meant picking by array order, i.e. by
    // whatever readdir() handed back, so the plan an agent got for "add
    // authentication" depended on the filesystem it read the corpus off, and the
    // skill not picked vanished without a trace. Settle a real tie by id so the
    // answer is reproducible, and pass the runners-up to the agent, the only
    // party here that can see which stack the project is already on.
    const stepKw = stepDef.keyword.toLowerCase();
    const claimed = result.skills
      .filter((s) => s.keywords.some((k) => k.toLowerCase() === stepKw))
      .sort((a, b) => a.id.localeCompare(b.id));

    // Below an outright claim there is no tie to settle: lookup's tiers ARE the
    // ranking (exact > containment > word overlap), so leave that order alone. A
    // weaker match is not an alternative, either — it is just a weaker match.
    return {
      order: stepDef.order,
      keyword: stepDef.keyword,
      skill: claimed[0] ?? result.skills[0] ?? null,
      alternatives: claimed.slice(1),
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
