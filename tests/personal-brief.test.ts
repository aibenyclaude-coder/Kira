import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// personal-brief.ts reads PERSONAL_SCARS_DIR (via personal-scars.ts → consent.ts)
// at module load, so we point KIRA_HOME at a fresh temp dir and re-import the
// module registry for each test — the same pattern as record-failure.test.ts.
let tmp: string;
let scarsDir: string;

async function fresh() {
  vi.resetModules();
  const tool = await import("../src/tools/personal-brief.ts");
  return tool;
}

/**
 * Write a personal scar straight to disk with a controlled `updated_at`, so
 * recency ordering and context filtering are tested against real on-disk data
 * (not the write path in personal-scars.ts, which stamps its own timestamp).
 */
function writeScar(overrides: Record<string, unknown>): string {
  const id = String(overrides.id);
  const scar = {
    id,
    keywords: [],
    contexts: [],
    title: "a failure",
    summary: "a failure",
    severity: "warning",
    mistake: "did the wrong thing",
    instead: "do the right thing",
    hit_count: 1,
    source: "personal",
    version: "1.0.0",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
  mkdirSync(scarsDir, { recursive: true });
  writeFileSync(join(scarsDir, `${id}.json`), JSON.stringify(scar, null, 2));
  return id;
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "kira-brief-test-"));
  process.env.KIRA_HOME = tmp;
  scarsDir = join(tmp, "personal-scars");
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  delete process.env.KIRA_HOME;
  vi.restoreAllMocks();
});

describe("buildPersonalBrief", () => {
  it("returns a clean-slate brief when no scars exist yet", async () => {
    const { buildPersonalBrief } = await fresh();
    const brief = await buildPersonalBrief();

    expect(brief.total).toBe(0);
    expect(brief.count).toBe(0);
    expect(brief.scars).toEqual([]);
    expect(brief.read).toBe("local-only");
    expect(brief.source_dir).toBe(scarsDir);
    expect(brief.headline).toMatch(/clean slate/i);
  });

  it("reads ~/.kira/personal-scars/ and returns scars most-recent-first", async () => {
    const { buildPersonalBrief } = await fresh();
    writeScar({ id: "scar.personal.old.00000001.v1", updated_at: "2026-01-01T00:00:00.000Z" });
    writeScar({ id: "scar.personal.mid.00000002.v1", updated_at: "2026-03-01T00:00:00.000Z" });
    writeScar({ id: "scar.personal.new.00000003.v1", updated_at: "2026-06-01T00:00:00.000Z" });

    const brief = await buildPersonalBrief();
    expect(brief.total).toBe(3);
    expect(brief.count).toBe(3);
    expect(brief.scars.map((s) => s.id)).toEqual([
      "scar.personal.new.00000003.v1",
      "scar.personal.mid.00000002.v1",
      "scar.personal.old.00000001.v1",
    ]);
  });

  it("caps the result at the default limit (top-N by recency)", async () => {
    const { buildPersonalBrief } = await fresh();
    for (let i = 0; i < 8; i++) {
      const mm = String(i + 1).padStart(2, "0");
      writeScar({
        id: `scar.personal.n${i}.0000000${i}.v1`,
        updated_at: `2026-${mm}-01T00:00:00.000Z`,
      });
    }

    const brief = await buildPersonalBrief();
    // Default limit is 5; total still reflects everything on disk.
    expect(brief.total).toBe(8);
    expect(brief.count).toBe(5);
    // The newest (2026-08) must be first; the oldest three are dropped.
    expect(brief.scars[0].updated_at).toBe("2026-08-01T00:00:00.000Z");
    expect(brief.scars.map((s) => s.updated_at)).not.toContain("2026-01-01T00:00:00.000Z");
  });

  it("honors an explicit limit", async () => {
    const { buildPersonalBrief } = await fresh();
    writeScar({ id: "scar.personal.a.00000001.v1", updated_at: "2026-01-01T00:00:00.000Z" });
    writeScar({ id: "scar.personal.b.00000002.v1", updated_at: "2026-02-01T00:00:00.000Z" });
    writeScar({ id: "scar.personal.c.00000003.v1", updated_at: "2026-03-01T00:00:00.000Z" });

    const brief = await buildPersonalBrief({ limit: 2 });
    expect(brief.count).toBe(2);
    expect(brief.scars.map((s) => s.id)).toEqual([
      "scar.personal.c.00000003.v1",
      "scar.personal.b.00000002.v1",
    ]);
  });

  it("clamps a limit of 0 up to at least 1", async () => {
    const { buildPersonalBrief } = await fresh();
    writeScar({ id: "scar.personal.a.00000001.v1", updated_at: "2026-01-01T00:00:00.000Z" });
    writeScar({ id: "scar.personal.b.00000002.v1", updated_at: "2026-02-01T00:00:00.000Z" });

    const brief = await buildPersonalBrief({ limit: 0 });
    expect(brief.count).toBe(1);
    expect(brief.scars[0].id).toBe("scar.personal.b.00000002.v1");
  });

  it("filters by context, always keeping untagged (universal) scars", async () => {
    const { buildPersonalBrief } = await fresh();
    writeScar({
      id: "scar.personal.next.00000001.v1",
      updated_at: "2026-03-01T00:00:00.000Z",
      contexts: ["nextjs"],
    });
    writeScar({
      id: "scar.personal.py.00000002.v1",
      updated_at: "2026-02-01T00:00:00.000Z",
      contexts: ["python"],
    });
    writeScar({
      id: "scar.personal.any.00000003.v1",
      updated_at: "2026-01-01T00:00:00.000Z",
      contexts: [],
    });

    const brief = await buildPersonalBrief({ contexts: ["nextjs"] });
    const ids = brief.scars.map((s) => s.id);
    // total counts everything on disk; count reflects the post-filter set.
    expect(brief.total).toBe(3);
    expect(ids).toContain("scar.personal.next.00000001.v1");
    expect(ids).toContain("scar.personal.any.00000003.v1"); // untagged = universal
    expect(ids).not.toContain("scar.personal.py.00000002.v1");
  });

  it("matches contexts case-insensitively", async () => {
    const { buildPersonalBrief } = await fresh();
    writeScar({
      id: "scar.personal.next.00000001.v1",
      updated_at: "2026-03-01T00:00:00.000Z",
      contexts: ["NextJS"],
    });
    const brief = await buildPersonalBrief({ contexts: ["nextjs"] });
    expect(brief.scars.map((s) => s.id)).toEqual(["scar.personal.next.00000001.v1"]);
  });

  it("reports 'none match' in the headline when a context filter excludes all", async () => {
    const { buildPersonalBrief } = await fresh();
    writeScar({
      id: "scar.personal.py.00000001.v1",
      updated_at: "2026-01-01T00:00:00.000Z",
      contexts: ["python"],
    });
    const brief = await buildPersonalBrief({ contexts: ["nextjs"] });
    expect(brief.total).toBe(1);
    expect(brief.count).toBe(0);
    expect(brief.headline).toMatch(/none match/i);
  });

  it("skips corrupt and non-JSON files instead of failing", async () => {
    const { buildPersonalBrief } = await fresh();
    writeScar({ id: "scar.personal.good.00000001.v1", updated_at: "2026-01-01T00:00:00.000Z" });
    mkdirSync(scarsDir, { recursive: true });
    writeFileSync(join(scarsDir, "broken.json"), "{ not valid json");
    writeFileSync(join(scarsDir, "README.txt"), "not a scar");

    const brief = await buildPersonalBrief();
    expect(brief.count).toBe(1);
    expect(brief.scars[0].id).toBe("scar.personal.good.00000001.v1");
  });

  it("counts critical scars in the headline", async () => {
    const { buildPersonalBrief } = await fresh();
    writeScar({
      id: "scar.personal.crit.00000001.v1",
      updated_at: "2026-01-01T00:00:00.000Z",
      severity: "critical",
    });
    const brief = await buildPersonalBrief();
    expect(brief.headline).toMatch(/1 critical/);
  });

  it("never touches the network", async () => {
    const { buildPersonalBrief } = await fresh();
    writeScar({ id: "scar.personal.a.00000001.v1", updated_at: "2026-01-01T00:00:00.000Z" });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await buildPersonalBrief();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("never writes to stdout (stdout is the MCP transport)", async () => {
    const { buildPersonalBrief } = await fresh();
    writeScar({ id: "scar.personal.a.00000001.v1", updated_at: "2026-01-01T00:00:00.000Z" });
    const stdoutSpy = vi.spyOn(process.stdout, "write");
    await buildPersonalBrief();
    expect(stdoutSpy).not.toHaveBeenCalled();
  });
});

describe("handlePersonalBrief", () => {
  it("returns a brief for well-formed (or empty) args", async () => {
    const { handlePersonalBrief } = await fresh();
    writeScar({ id: "scar.personal.a.00000001.v1", updated_at: "2026-01-01T00:00:00.000Z" });
    const brief = await handlePersonalBrief({});
    expect(brief.read).toBe("local-only");
    expect(brief.count).toBe(1);
  });

  it("passes limit and contexts through to the brief", async () => {
    const { handlePersonalBrief } = await fresh();
    writeScar({
      id: "scar.personal.next.00000001.v1",
      updated_at: "2026-02-01T00:00:00.000Z",
      contexts: ["nextjs"],
    });
    writeScar({
      id: "scar.personal.py.00000002.v1",
      updated_at: "2026-03-01T00:00:00.000Z",
      contexts: ["python"],
    });
    const brief = await handlePersonalBrief({ limit: 1, contexts: ["nextjs"] });
    expect(brief.scars.map((s) => s.id)).toEqual(["scar.personal.next.00000001.v1"]);
  });

  it("drops non-string entries in contexts", async () => {
    const { handlePersonalBrief } = await fresh();
    writeScar({
      id: "scar.personal.next.00000001.v1",
      updated_at: "2026-02-01T00:00:00.000Z",
      contexts: ["nextjs"],
    });
    // 42 is filtered out, leaving ["nextjs"].
    const brief = await handlePersonalBrief({ contexts: ["nextjs", 42] });
    expect(brief.scars.map((s) => s.id)).toEqual(["scar.personal.next.00000001.v1"]);
  });

  it("throws when limit is not a number", async () => {
    const { handlePersonalBrief } = await fresh();
    await expect(handlePersonalBrief({ limit: "5" })).rejects.toThrow(/limit/);
  });

  it("throws when contexts is not an array", async () => {
    const { handlePersonalBrief } = await fresh();
    await expect(handlePersonalBrief({ contexts: "nextjs" })).rejects.toThrow(/contexts/);
  });
});

describe("KIRA_PERSONAL_BRIEF_TOOL descriptor", () => {
  it("is a well-formed, local-only, read-only MCP tool", async () => {
    const { KIRA_PERSONAL_BRIEF_TOOL } = await fresh();
    expect(KIRA_PERSONAL_BRIEF_TOOL.name).toBe("kira_personal_brief");
    expect(KIRA_PERSONAL_BRIEF_TOOL.inputSchema.type).toBe("object");
    // Read-only surfacing of local scars; must not advertise network reach.
    expect(KIRA_PERSONAL_BRIEF_TOOL.annotations.readOnlyHint).toBe(true);
    expect(KIRA_PERSONAL_BRIEF_TOOL.annotations.openWorldHint).toBe(false);
    expect(KIRA_PERSONAL_BRIEF_TOOL.annotations.title).toMatch(/^Kira /);
  });
});
