import { describe, it, expect } from "vitest";
import {
  buildPremortem,
  KIRA_PREMORTEM_TOOL,
  RECOVERY_MINUTES,
} from "../src/tools/premortem.ts";
import { loadAllScars } from "../src/index-loader.ts";
import type { Scar, ScarSeverity } from "../src/types.ts";

function scar(
  overrides: Partial<Scar> & Pick<Scar, "id" | "keywords" | "hit_count" | "severity">
): Scar {
  return {
    contexts: [],
    title: overrides.id,
    summary: "s",
    mistake: "m",
    instead: "i",
    version: "1.0.0",
    updated_at: "2026-04-11T00:00:00Z",
    ...overrides,
  } as Scar;
}

// Three scars sharing an exact keyword, distinct hit_counts + severities.
const A = scar({ id: "scar.alpha.v1", title: "Alpha", keywords: ["alpha deploy"], hit_count: 10, severity: "critical" });
const B = scar({ id: "scar.bravo.v1", title: "Bravo", keywords: ["alpha deploy"], hit_count: 5, severity: "warning" });
const C = scar({ id: "scar.charlie.v1", title: "Charlie", keywords: ["alpha deploy"], hit_count: 1, severity: "critical" });
const UNRELATED = scar({ id: "scar.zzz.v1", title: "Zzz", keywords: ["totally unrelated topic"], hit_count: 99, severity: "critical" });
const SYNTHETIC = [A, B, C, UNRELATED];

describe("kira_premortem tool descriptor", () => {
  it("is named kira_premortem", () => {
    expect(KIRA_PREMORTEM_TOOL.name).toBe("kira_premortem");
  });

  it("is a read-only, non-destructive tool", () => {
    expect(KIRA_PREMORTEM_TOOL.annotations.readOnlyHint).toBe(true);
    expect(KIRA_PREMORTEM_TOOL.annotations.destructiveHint).toBe(false);
  });

  it("requires a goal argument", () => {
    expect(KIRA_PREMORTEM_TOOL.inputSchema.required).toContain("goal");
    expect(KIRA_PREMORTEM_TOOL.inputSchema.properties).toHaveProperty("goal");
    expect(KIRA_PREMORTEM_TOOL.inputSchema.properties).toHaveProperty("top_k");
  });
});

describe("buildPremortem — matching & ranking", () => {
  it("returns only scars whose keywords match the goal", () => {
    const r = buildPremortem(SYNTHETIC, { goal: "alpha deploy" });
    const ids = r.hotspots.map((h) => h.id);
    expect(ids).toContain("scar.alpha.v1");
    expect(ids).toContain("scar.bravo.v1");
    expect(ids).toContain("scar.charlie.v1");
    expect(ids).not.toContain("scar.zzz.v1");
    expect(r.matched_count).toBe(3);
  });

  it("ranks hotspots by hit_count descending", () => {
    const r = buildPremortem(SYNTHETIC, { goal: "alpha deploy" });
    const hits = r.hotspots.map((h) => h.hit_count);
    expect(hits).toEqual([10, 5, 1]);
    expect(r.hotspots[0]!.id).toBe("scar.alpha.v1");
  });

  it("echoes the goal and returned_count", () => {
    const r = buildPremortem(SYNTHETIC, { goal: "alpha deploy" });
    expect(r.goal).toBe("alpha deploy");
    expect(r.returned_count).toBe(3);
    expect(r.returned_count).toBe(r.hotspots.length);
  });

  it("is deterministic across calls", () => {
    const a = buildPremortem(SYNTHETIC, { goal: "alpha deploy" });
    const b = buildPremortem(SYNTHETIC, { goal: "alpha deploy" });
    expect(a).toEqual(b);
  });

  it("does not mutate the input scar array", () => {
    const before = SYNTHETIC.map((s) => s.id);
    buildPremortem(SYNTHETIC, { goal: "alpha deploy" });
    expect(SYNTHETIC.map((s) => s.id)).toEqual(before);
  });
});

describe("buildPremortem — heat map", () => {
  it("scales heat 0–100 relative to the hottest matched scar", () => {
    const r = buildPremortem(SYNTHETIC, { goal: "alpha deploy" });
    const byId = Object.fromEntries(r.hotspots.map((h) => [h.id, h.heat]));
    expect(byId["scar.alpha.v1"]).toBe(100); // 10/10
    expect(byId["scar.bravo.v1"]).toBe(50); //  5/10
    expect(byId["scar.charlie.v1"]).toBe(10); //  1/10
  });

  it("heat is monotonic with hit_count", () => {
    const r = buildPremortem(SYNTHETIC, { goal: "alpha deploy" });
    const heats = r.hotspots.map((h) => h.heat);
    for (let i = 1; i < heats.length; i++) {
      expect(heats[i]!).toBeLessThanOrEqual(heats[i - 1]!);
    }
  });
});

describe("buildPremortem — quantified prevention value", () => {
  it("estimates minutes saved per hotspot by severity", () => {
    const r = buildPremortem(SYNTHETIC, { goal: "alpha deploy" });
    const byId = Object.fromEntries(r.hotspots.map((h) => [h.id, h]));
    expect(byId["scar.alpha.v1"]!.estimated_minutes_saved).toBe(RECOVERY_MINUTES.critical);
    expect(byId["scar.bravo.v1"]!.estimated_minutes_saved).toBe(RECOVERY_MINUTES.warning);
    expect(byId["scar.charlie.v1"]!.estimated_minutes_saved).toBe(RECOVERY_MINUTES.critical);
  });

  it("aggregate estimated_minutes_saved is the sum over returned hotspots", () => {
    const r = buildPremortem(SYNTHETIC, { goal: "alpha deploy" });
    // 2 critical (20 each) + 1 warning (8) = 48
    expect(r.prevention_value.estimated_minutes_saved).toBe(48);
    expect(r.prevention_value.estimated_minutes_saved).toBe(
      r.hotspots.reduce((s, h) => s + h.estimated_minutes_saved, 0)
    );
  });

  it("total_historical_failures sums hit_count", () => {
    const r = buildPremortem(SYNTHETIC, { goal: "alpha deploy" });
    expect(r.prevention_value.total_historical_failures).toBe(16); // 10+5+1
  });

  it("network_minutes_saved weights each scar by hit_count", () => {
    const r = buildPremortem(SYNTHETIC, { goal: "alpha deploy" });
    // 10*20 + 5*8 + 1*20 = 260
    expect(r.prevention_value.network_minutes_saved).toBe(260);
  });

  it("counts critical vs warning hotspots", () => {
    const r = buildPremortem(SYNTHETIC, { goal: "alpha deploy" });
    expect(r.prevention_value.critical_count).toBe(2);
    expect(r.prevention_value.warning_count).toBe(1);
  });

  it("includes a heuristic basis note and a summary", () => {
    const r = buildPremortem(SYNTHETIC, { goal: "alpha deploy" });
    expect(r.prevention_value.basis).toMatch(/estimate/i);
    expect(r.prevention_value.summary).toContain("48 min");
  });
});

describe("buildPremortem — top_k", () => {
  it("defaults to at most 5 hotspots", () => {
    const many: Scar[] = Array.from({ length: 25 }, (_, i) =>
      scar({
        id: `scar.many-${i}.v1`,
        title: `Many ${i}`,
        keywords: ["many trap"],
        hit_count: i,
        severity: i % 2 === 0 ? "critical" : "warning",
      })
    );
    const r = buildPremortem(many, { goal: "many trap" });
    expect(r.returned_count).toBe(5);
    expect(r.matched_count).toBe(25);
  });

  it("honors an explicit top_k", () => {
    const r = buildPremortem(SYNTHETIC, { goal: "alpha deploy", top_k: 1 });
    expect(r.returned_count).toBe(1);
    expect(r.hotspots[0]!.id).toBe("scar.alpha.v1"); // highest hit_count
  });

  it("clamps top_k to a maximum of 20", () => {
    const many: Scar[] = Array.from({ length: 25 }, (_, i) =>
      scar({
        id: `scar.many-${i}.v1`,
        title: `Many ${i}`,
        keywords: ["many trap"],
        hit_count: i,
        severity: "critical",
      })
    );
    const r = buildPremortem(many, { goal: "many trap", top_k: 999 });
    expect(r.returned_count).toBe(20);
    expect(r.matched_count).toBe(25);
  });

  it("clamps a non-positive top_k up to 1", () => {
    const r = buildPremortem(SYNTHETIC, { goal: "alpha deploy", top_k: 0 });
    expect(r.returned_count).toBe(1);
  });

  it("ignores a non-numeric top_k and uses the default", () => {
    const r = buildPremortem(SYNTHETIC, {
      goal: "alpha deploy",
      top_k: NaN,
    });
    expect(r.returned_count).toBe(3); // only 3 match, under the default 5
  });
});

describe("buildPremortem — context filter", () => {
  const E = scar({ id: "scar.echo.v1", title: "Echo", keywords: ["shared kw"], contexts: ["nextjs"], hit_count: 3, severity: "critical" });
  const F = scar({ id: "scar.foxtrot.v1", title: "Foxtrot", keywords: ["shared kw"], contexts: ["python"], hit_count: 3, severity: "critical" });
  const both = [E, F];

  it("narrows the heat map to the given context", () => {
    const r = buildPremortem(both, { goal: "shared kw", context: ["nextjs"] });
    expect(r.hotspots.map((h) => h.id)).toEqual(["scar.echo.v1"]);
  });

  it("returns both when no context is supplied", () => {
    const r = buildPremortem(both, { goal: "shared kw" });
    expect(r.matched_count).toBe(2);
  });
});

describe("buildPremortem — no matches", () => {
  it("returns an empty, zero-valued heat map with proceed advice", () => {
    const r = buildPremortem(SYNTHETIC, { goal: "nonexistent quux frobnicate" });
    expect(r.hotspots).toHaveLength(0);
    expect(r.matched_count).toBe(0);
    expect(r.returned_count).toBe(0);
    expect(r.prevention_value.estimated_minutes_saved).toBe(0);
    expect(r.prevention_value.network_minutes_saved).toBe(0);
    expect(r.advice).toMatch(/proceed/i);
  });
});

describe("buildPremortem — real scar corpus", () => {
  it("surfaces the vercel env-vars trap for a deploy goal", async () => {
    const scars = await loadAllScars();
    const r = buildPremortem(scars, {
      goal: "deploy vercel",
      context: ["nextjs"],
    });
    expect(r.matched_count).toBeGreaterThan(0);
    const ids = r.hotspots.map((h) => h.id);
    expect(ids).toContain("scar.vercel-env-vars-missing.v1");
    // vercel scar has the highest hit_count in the corpus → hottest.
    expect(r.hotspots[0]!.heat).toBe(100);
    expect(r.prevention_value.estimated_minutes_saved).toBeGreaterThan(0);
  });

  it("produces a valid response shape from real data", async () => {
    const scars = await loadAllScars();
    const r = buildPremortem(scars, { goal: "add prisma database" });
    for (const h of r.hotspots) {
      expect(typeof h.title).toBe("string");
      expect(h.heat).toBeGreaterThanOrEqual(0);
      expect(h.heat).toBeLessThanOrEqual(100);
      expect((["critical", "warning"] as ScarSeverity[]).includes(h.severity)).toBe(true);
      expect(h.estimated_minutes_saved).toBeGreaterThan(0);
    }
  });
});
