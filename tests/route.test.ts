/**
 * Route resolution must not depend on the order the route files came off disk.
 *
 * loadRoutes() feeds resolveRoute() whatever readdir() hands back, and readdir()
 * order is filesystem-defined, not alphabetical — and `routes/` ships inside the
 * npm tarball, so the order a user gets is the order THEIR filesystem produces on
 * extract. Any goal that matches two routes therefore resolved by luck, and the
 * two plans are not interchangeable: "build a saas" is an 11-step plan with
 * billing on one ordering and a 9-step plan with no billing step at all on the
 * other. These tests pin the selection rule instead: exact match beats partial,
 * then the longest matched goal phrase (the most specific signal), then route id.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadRoutes, resolveRoute, type RouteDefinition } from "../src/route.ts";
import { loadAllSkills, loadAllScars } from "../src/index-loader.ts";
import { indexItems } from "../src/lookup.ts";
import type { Skill } from "../src/types.ts";

const ROUTES_DIR = join(__dirname, "..", "routes");

const routes = await loadRoutes();
const rawSkills = await loadAllSkills("free");
const skills = indexItems(rawSkills);
const scars = indexItems(await loadAllScars("free"));

/** Everything about a resolution an agent would actually act on. */
function plan(rs: typeof routes, goal: string): string {
  const res = resolveRoute(rs, skills, scars, { goal });
  return res.step_count === 0
    ? "NO_MATCH"
    : res.steps.map((s) => s.keyword).join(" > ");
}

const COMPOUND_GOALS = [
  "build a web app and add payments",
  "build a saas with stripe",
  "create a web application and add authentication",
  "build a mobile app and add login",
  "setup dev environment then deploy to production",
  "add file uploads and add payments",
  "build a nextjs app, add auth, and go live",
  "build a saas and ship it",
];

describe("route selection is order-independent", () => {
  const shipped = [...new Set(routes.flatMap((r) => r.goals))];
  const goals = [...shipped, ...COMPOUND_GOALS];

  it("resolves every goal the same way no matter how the routes are ordered", () => {
    const forward = [...routes];
    const reversed = [...routes].reverse();
    const rotated = [...routes.slice(3), ...routes.slice(0, 3)];

    const flipped = goals.filter((g) => {
      const a = plan(forward, g);
      return plan(reversed, g) !== a || plan(rotated, g) !== a;
    });

    expect(flipped).toEqual([]);
  });

  it("keeps the billing steps for 'build a saas' under any route ordering", () => {
    for (const rs of [[...routes], [...routes].reverse()]) {
      expect(plan(rs, "build a saas")).toContain("stripe");
    }
  });

  it("prefers the longest matched goal phrase over an incidental short one", () => {
    // "build a nextjs app" (18 chars) is the intent; "go live" (7) is a rider.
    // First-match-wins used to return the deploy route alone, dropping the build.
    for (const rs of [[...routes], [...routes].reverse()]) {
      expect(plan(rs, "build a nextjs app, add auth, and go live")).toContain(
        "create nextjs app"
      );
    }
  });
});

describe("routes/ is internally consistent", () => {
  it("declares each goal phrase in exactly one route", () => {
    const owners = new Map<string, string[]>();
    for (const file of readdirSync(ROUTES_DIR).filter((f) => f.endsWith(".json"))) {
      const route = JSON.parse(readFileSync(join(ROUTES_DIR, file), "utf-8"));
      for (const goal of route.goals) {
        const key = goal.toLowerCase().trim();
        owners.set(key, [...(owners.get(key) ?? []), route.id]);
      }
    }

    const collisions = [...owners]
      .filter(([, ids]) => ids.length > 1)
      .map(([goal, ids]) => `${goal} -> ${ids.join(" + ")}`);

    expect(collisions).toEqual([]);
  });

  it("loads routes in a deterministic order", async () => {
    const a = (await loadRoutes()).map((r) => r.id);
    const b = (await loadRoutes()).map((r) => r.id);
    expect(a).toEqual(b);
    expect(a).toEqual([...a].sort());
  });

  it("loads skills and scars in a deterministic order too", async () => {
    // The twin of the test above. loadRoutes() sorts; readJsonDir() — which
    // feeds every skill and scar — did not, so the SAME luck-of-the-filesystem
    // that used to pick the route was still picking the skill inside it.
    for (const load of [loadAllSkills, loadAllScars]) {
      const ids = (await load("free")).map((x) => x.id);
      expect(ids).toEqual((await load("free")).map((x) => x.id));
      expect(ids).toEqual([...ids].sort());
    }
  });
});

/**
 * The same defect as above, one layer down. The tests at the top pin WHICH ROUTE
 * a goal resolves to; these pin WHICH SKILL each step of that route hands the
 * agent. Two skills can claim a step's keyword outright — "add auth" is declared
 * by BOTH setup-authjs-nextjs and setup-clerk-nextjs — and the schema carries no
 * popularity or success signal to rank them, because they are not better and
 * worse, they are alternatives. resolveRoute picked with .find(), i.e. whichever
 * one readdir() happened to hand back first, and dropped the other in silence.
 * So the agent was told "use Auth.js" as though it were THE answer, and on a
 * filesystem that enumerated the other file first it was told "use Clerk".
 */
describe("step skill selection is order-independent", () => {
  /** Every (route, step) -> skill decision an agent would act on. */
  const decisions = (order: (s: Skill[]) => Skill[]): string[] => {
    const indexed = indexItems(order([...rawSkills]));
    return routes.flatMap((r) =>
      resolveRoute(routes, indexed, scars, { goal: r.goals[0]! }).steps.map(
        (s) => `${r.id}/${s.keyword} -> ${s.skill?.id ?? "NONE"}`
      )
    );
  };

  it("gives every step the same skill no matter how the skills came off disk", () => {
    const forward = decisions((s) => s);

    expect(decisions((s) => [...s].reverse())).toEqual(forward);
    expect(decisions((s) => [...s.slice(7), ...s.slice(0, 7)])).toEqual(forward);
  });

  it("surfaces the coequal alternative instead of dropping it", () => {
    const res = resolveRoute(routes, skills, scars, { goal: "add authentication" });
    const step = res.steps.find((s) => s.keyword === "add auth")!;

    expect(step.skill?.id).toBe("community.setup-authjs-nextjs.v1");
    expect(step.alternatives.map((a) => a.id)).toEqual([
      "community.setup-clerk-nextjs.v1",
    ]);
  });

  it("offers no alternatives when a single skill claims the step keyword", () => {
    const res = resolveRoute(routes, skills, scars, { goal: "add authentication" });
    const step = res.steps.find((s) => s.keyword === "prisma")!;

    expect(step.skill?.id).toBe("community.setup-prisma-nextjs.v1");
    expect(step.alternatives).toEqual([]);
  });

  it("keeps the tiered ranking when no skill claims the keyword outright", () => {
    // The tempting simplification is to id-sort every candidate the lookup
    // returned. That would promote a weak word-overlap match over a strong
    // containment one whenever its id happens to sort earlier: lookup's tiers
    // ARE the ranking, and only an exact-keyword tie is a genuine tie. Ties get
    // sorted; the rest keeps the order lookup ranked it in.
    const skill = (over: Partial<Skill>): Skill => ({
      id: "community.x.v1",
      keywords: [],
      contexts: [],
      title: "x",
      summary: "x",
      source: "community",
      declaration: "x",
      instructions: "x",
      version: "1.0.0",
      updated_at: "2026-01-01T00:00:00Z",
      ...over,
    });
    // Sorts LAST by id, but contains the step keyword at a word boundary (tier 2).
    const strong = skill({ id: "community.zz.v1", keywords: ["deploy vercel app"] });
    // Sorts FIRST by id, but only overlaps two words with it (tier 3).
    const weak = skill({ id: "community.aa.v1", keywords: ["vercel deploy"] });
    const route: RouteDefinition = {
      id: "route.fixture.v1",
      goals: ["ship it"],
      contexts: [],
      title: "t",
      description: "d",
      steps: [{ order: 1, keyword: "deploy vercel", description: "d" }],
    };

    const res = resolveRoute([route], indexItems([weak, strong]), [], {
      goal: "ship it",
    });

    expect(res.steps[0]!.skill?.id).toBe("community.zz.v1");
    expect(res.steps[0]!.alternatives).toEqual([]);
  });
});
