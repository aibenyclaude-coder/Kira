/**
 * Integration tests for the MCP request handlers wired up in src/server.ts.
 *
 * Rather than reconstruct the handler table (which would drift from the real
 * server), we boot the *actual* startServer() and talk to it through a real
 * MCP Client. The only seam is the transport: StdioServerTransport is mocked
 * so that constructing it hands back one half of an in-process
 * InMemoryTransport linked pair. The Client connects to the other half, so
 * every tools/call round-trips through the genuine ListTools/CallTool
 * dispatch — serialization, argument coercion, error mapping and all — with
 * zero network and zero subprocess.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

// Shared holder populated by the mocked transport constructor. vi.hoisted
// runs before the hoisted vi.mock factory, so the factory can close over it.
const wire = vi.hoisted(() => ({
  clientTransport: null as any,
  ctorCalls: 0,
}));

// Replace the stdio transport with an in-memory linked pair. Returning the
// server half from the constructor swaps it in transparently; the client half
// is stashed for the test to connect to.
vi.mock("@modelcontextprotocol/sdk/server/stdio.js", async () => {
  const { InMemoryTransport } = await import(
    "@modelcontextprotocol/sdk/inMemory.js"
  );
  return {
    StdioServerTransport: class {
      constructor() {
        wire.ctorCalls++;
        const [clientTransport, serverTransport] =
          InMemoryTransport.createLinkedPair();
        wire.clientTransport = clientTransport;
        return serverTransport;
      }
    },
  };
});

// Real IDs / keywords drawn from the shipped skills, scars and routes so the
// assertions exercise the actual matcher, not fixtures.
const SKILL_ID = "community.create-nextjs-app.v1";
const SKILL_KEYWORD = "create nextjs app";
const SCAR_ID = "scar.authjs-v5-signin-wrong-import.v1";
const SCAR_KEYWORD = "authjs";
const ROUTE_GOAL = "add authentication";

const EXPECTED_TOOLS = [
  "kira_lookup",
  "kira_report",
  "kira_route",
  "kira_get",
  "kira_consent",
  "kira_status",
  "kira_record_failure",
  "kira_premortem",
  "kira_personal_brief",
];

let tmp: string;
let client: Client;
let fetchSpy: ReturnType<typeof vi.fn>;

/** Call a tool and JSON-parse its single text content block. */
async function callJson(
  name: string,
  args: Record<string, unknown> = {}
): Promise<any> {
  const res: any = await client.callTool({ name, arguments: args });
  expect(Array.isArray(res.content)).toBe(true);
  expect(res.content[0]?.type).toBe("text");
  return JSON.parse(res.content[0].text);
}

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "kira-server-handlers-"));
  // Route all local state into the temp dir; force the free, offline tier.
  process.env.KIRA_HOME = tmp;
  process.env.KIRA_TELEMETRY = "off";
  delete process.env.KIRA_PRO_KEY;
  delete process.env.KIRA_REMOTE_URL;

  // Any network attempt is a test failure, not a silent skip.
  fetchSpy = vi.fn(() => {
    throw new Error("unexpected network I/O during server-handler test");
  });
  vi.stubGlobal("fetch", fetchSpy);

  // Load server.ts fresh so KIRA_HOME is read from the env set above.
  vi.resetModules();
  const { startServer } = await import("../src/server.ts");
  await startServer();

  client = new Client({ name: "kira-test-client", version: "0.0.0" });
  await client.connect(wire.clientTransport);
});

afterAll(async () => {
  await client?.close();
  vi.unstubAllGlobals();
  rmSync(tmp, { recursive: true, force: true });
  delete process.env.KIRA_HOME;
  delete process.env.KIRA_TELEMETRY;
});

describe("server transport", () => {
  it("boots over the in-process transport, not real stdio", () => {
    expect(wire.ctorCalls).toBe(1);
    expect(wire.clientTransport).not.toBeNull();
  });
});

describe("ListTools handler", () => {
  it("advertises exactly the registered tools", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([...EXPECTED_TOOLS].sort());
  });

  it("each tool exposes an object inputSchema and a title annotation", async () => {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe("object");
      expect((tool as any).annotations?.title).toMatch(/^Kira /);
    }
  });
});

describe("kira_lookup handler", () => {
  it("returns matching skill summaries without instructions", async () => {
    const res = await callJson("kira_lookup", { keyword: SKILL_KEYWORD });
    expect(res.skill_count).toBeGreaterThan(0);
    const skill = res.skills.find((s: any) => s.id === SKILL_ID);
    expect(skill).toBeDefined();
    // lookup returns summaries — full instructions are only via kira_get.
    expect("instructions" in skill).toBe(false);
    expect(skill.title).toBeTruthy();
  });

  it("returns scars with mistake/instead/severity for a matching keyword", async () => {
    const res = await callJson("kira_lookup", { keyword: SCAR_KEYWORD });
    expect(res.scar_count).toBeGreaterThan(0);
    const scar = res.scars.find((s: any) => s.id === SCAR_ID);
    expect(scar).toBeDefined();
    expect(scar.mistake).toBeTruthy();
    expect(scar.instead).toBeTruthy();
    expect(["warning", "critical"]).toContain(scar.severity);
  });

  it("returns 0 counts plus suggestions when nothing matches", async () => {
    const res = await callJson("kira_lookup", {
      keyword: "qwertyzxcv nonsense keyword",
    });
    expect(res.skill_count).toBe(0);
    expect(res.scar_count).toBe(0);
    expect(Array.isArray(res.suggestions)).toBe(true);
    expect(res.suggestions.length).toBeGreaterThan(0);
  });

  it("honors the context filter", async () => {
    // The authjs scar is tagged nextjs+typescript; a disjoint context excludes it.
    const res = await callJson("kira_lookup", {
      keyword: SCAR_KEYWORD,
      context: ["python"],
    });
    expect(res.scars.some((s: any) => s.id === SCAR_ID)).toBe(false);
  });
});

describe("kira_route handler", () => {
  it("resolves an ordered, skill-bearing route for a known goal", async () => {
    const res = await callJson("kira_route", {
      goal: ROUTE_GOAL,
      context: ["nextjs"],
    });
    expect(res.goal).toBe(ROUTE_GOAL);
    expect(res.step_count).toBeGreaterThan(0);
    expect(res.steps).toHaveLength(res.step_count);
    expect(res.coverage).toMatch(/\d+\/\d+ steps have skills/);
    for (const step of res.steps) {
      expect(typeof step.order).toBe("number");
      expect(step.keyword).toBeTruthy();
      expect(Array.isArray(step.scars)).toBe(true);
    }
    // A real route should resolve at least one step to a skill.
    expect(res.steps.some((s: any) => s.skill !== null)).toBe(true);
  });

  it("reports no coverage for an unknown goal", async () => {
    const res = await callJson("kira_route", {
      goal: "totally unknown goal that matches nothing",
    });
    expect(res.step_count).toBe(0);
    expect(res.steps).toEqual([]);
    expect(res.coverage).toBe("no matching route found");
  });
});

describe("kira_get handler", () => {
  it("returns the full skill including instructions", async () => {
    const res = await callJson("kira_get", { id: SKILL_ID });
    expect(res.scar).toBeNull();
    expect(res.skill.id).toBe(SKILL_ID);
    expect(typeof res.skill.instructions).toBe("string");
    expect(res.skill.instructions.length).toBeGreaterThan(0);
  });

  it("returns the full scar for a scar id", async () => {
    const res = await callJson("kira_get", { id: SCAR_ID });
    expect(res.skill).toBeNull();
    expect(res.scar.id).toBe(SCAR_ID);
    expect(res.scar.mistake).toBeTruthy();
    expect(res.scar.instead).toBeTruthy();
  });

  it("returns an error object for an unknown id", async () => {
    const res = await callJson("kira_get", { id: "no.such.id.v1" });
    expect(res.skill ?? null).toBeNull();
    expect(res.scar ?? null).toBeNull();
    expect(res.error).toMatch(/No skill or scar found/);
  });
});

describe("kira_report handler", () => {
  it("acks a valid report and persists it to the local log", async () => {
    const res = await callJson("kira_report", {
      skill_id: SKILL_ID,
      status: "success",
    });
    expect(res.ack).toBe(true);
    expect(Number.isNaN(Date.parse(res.recorded_at))).toBe(false);

    // Local-first: the report is appended to KIRA_HOME/reports.log.
    const logPath = join(tmp, "reports.log");
    expect(existsSync(logPath)).toBe(true);
    expect(readFileSync(logPath, "utf-8")).toContain(SKILL_ID);
  });

  it("rejects an illegally-shaped skill_id", async () => {
    await expect(
      client.callTool({
        name: "kira_report",
        arguments: { skill_id: "BAD ID with spaces", status: "success" },
      })
    ).rejects.toThrow(/Invalid skill_id/);
  });

  it("rejects an out-of-enum status", async () => {
    await expect(
      client.callTool({
        name: "kira_report",
        arguments: { skill_id: SKILL_ID, status: "bogus" },
      })
    ).rejects.toThrow(/Invalid status/);
  });
});

describe("kira_consent handler", () => {
  it("queries the effective consent state when called with no level", async () => {
    const res = await callJson("kira_consent", {});
    expect(res.v).toBe(1);
    // KIRA_TELEMETRY=off is an env-sourced override.
    expect(res.level).toBe("off");
    expect(res.source).toBe("env");
    expect(typeof res.client_id).toBe("string");
    expect(res.client_id.length).toBeGreaterThan(0);
  });

  it("persists a new level when one is supplied", async () => {
    const res = await callJson("kira_consent", { level: "full" });
    expect(res.level).toBe("full");
    expect(res.source).toBe("tool");
    expect(existsSync(join(tmp, "consent.json"))).toBe(true);
  });

  it("rejects an invalid level", async () => {
    await expect(
      client.callTool({
        name: "kira_consent",
        arguments: { level: "bogus" },
      })
    ).rejects.toThrow(/Invalid level/);
  });
});

describe("kira_status handler", () => {
  it("reports tier, consent, counts and paths", async () => {
    const res = await callJson("kira_status", {});
    expect(res.tier).toBe("free");
    expect(res.consent.level).toBe("off");
    expect(typeof res.kira_version).toBe("string");
    expect(res.kira_version.length).toBeGreaterThan(0);
    expect(res.counts.skills).toBeGreaterThan(0);
    expect(res.counts.scars).toBeGreaterThan(0);
    expect(res.counts.routes).toBeGreaterThan(0);
    expect(res.paths.reports_log).toContain(tmp);
    expect(typeof res.paths.reports_log_exists).toBe("boolean");
    expect(typeof res.paths.telemetry_url).toBe("string");
  });
});

describe("unknown tool", () => {
  it("rejects a call to an unregistered tool name", async () => {
    await expect(
      client.callTool({ name: "kira_does_not_exist", arguments: {} })
    ).rejects.toThrow(/Unknown tool/);
  });
});

describe("personal scar recall (record_failure output feeds lookup/premortem)", () => {
  let recordedId: string;

  it("kira_record_failure acks local-only and returns the scar", async () => {
    const res = await callJson("kira_record_failure", {
      title: "vitest missing in fresh worktree",
      mistake: "ran the suite in a new worktree without npm ci first",
      instead: "npm ci right after git worktree add",
      keywords: ["worktree setup", "vitest missing"],
    });
    expect(res.ack).toBe(true);
    expect(res.stored).toBe("local-only");
    recordedId = res.scar.id;
    expect(recordedId).toMatch(/^scar\.personal\./);
  });

  it("the recorded failure fires in a subsequent kira_lookup", async () => {
    const res = await callJson("kira_lookup", { keyword: "worktree setup" });
    expect(res.scar_count).toBeGreaterThan(0);
    const mine = res.scars.find((s: any) => s.id === recordedId);
    expect(mine).toBeDefined();
    expect(mine.source).toBe("personal");
    expect(mine.instead).toContain("npm ci");
  });

  it("the recorded failure appears in the kira_premortem heat map", async () => {
    const res = await callJson("kira_premortem", {
      goal: "worktree setup for running the test suite",
    });
    expect(res.hotspots.some((h: any) => h.id === recordedId)).toBe(true);
  });

  it("kira_get resolves the personal scar by id", async () => {
    const res = await callJson("kira_get", { id: recordedId });
    expect(res.skill).toBeNull();
    expect(res.scar.id).toBe(recordedId);
    expect(res.scar.source).toBe("personal");
  });

  it("kira_status counts personal scars separately", async () => {
    const res = await callJson("kira_status", {});
    expect(res.counts.personal_scars).toBeGreaterThanOrEqual(1);
    expect(res.paths.personal_scars_dir).toContain(tmp);
  });
});

describe("network isolation", () => {
  it("never performed any network I/O", () => {
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
