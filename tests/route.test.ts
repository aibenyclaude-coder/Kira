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
import { loadRoutes, resolveRoute } from "../src/route.ts";
import { loadAllSkills, loadAllScars } from "../src/index-loader.ts";
import { indexItems } from "../src/lookup.ts";

const ROUTES_DIR = join(__dirname, "..", "routes");

const routes = await loadRoutes();
const skills = indexItems(await loadAllSkills("free"));
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
});
