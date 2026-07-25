import { describe, it, expect, vi, afterEach } from "vitest";

/**
 * The server's stderr diagnostics must (a) honour `KIRA_LOG_LEVEL` and (b) pass
 * through the scrubber before they are written.
 *
 * Both were advertised — CHANGELOG #134, "structured stderr logger with
 * KIRA_LOG_LEVEL and redact-on-log" — and neither was reachable: src/logger.ts
 * had ZERO importers, so every diagnostic left via a raw `console.error` that no
 * level could quiet and no scrubber ever saw. Setting KIRA_LOG_LEVEL to any
 * value, including "silent", changed nothing.
 *
 * NEGATIVE CONTROL for this file: restore `console.error(...)` in
 * src/index-loader.ts and BOTH cases below fail — "silent" still writes the
 * line, and the default level writes an unredacted home path. A test that only
 * asserted "something is written" would pass before and after, which is exactly
 * the guard-that-guards-nothing trap.
 *
 * The remote-fetch path is used as the driver because it is the one stderr site
 * reachable from an exported function; src/server.ts's key banner was changed
 * in the same commit and shares the mechanism.
 */

const REMOTE = "https://kira-test.invalid";

interface Capture {
  lines: string[];
}

async function loadSkillsWithFailingFetch(opts: {
  /** undefined = leave KIRA_LOG_LEVEL empty, i.e. the default ("info"). */
  level?: string;
  errorMessage: string;
}): Promise<Capture> {
  vi.resetModules(); // the logger reads KIRA_LOG_LEVEL once, at import
  vi.stubEnv("KIRA_REMOTE_URL", REMOTE);
  // A 1 ms TTL keeps the on-disk cache from ever counting as fresh, so this
  // drives the network path even on a machine that has already cached a corpus.
  vi.stubEnv("KIRA_CACHE_TTL_MS", "1");
  vi.stubEnv("KIRA_LOG_LEVEL", opts.level ?? "");

  const lines: string[] = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    lines.push(String(chunk));
    return true;
  });
  // console.error does NOT route through a spied process.stderr.write here — it
  // holds its own reference to the stream's write. Capturing only the stream
  // would make "silence" unfalsifiable: the old console.error line would sail
  // past the spy to the real stderr and the assertion would pass anyway.
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  });
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error(opts.errorMessage));

  const { loadAllSkills } = await import("../src/index-loader.ts");
  await loadAllSkills("free");

  return { lines };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("KIRA_LOG_LEVEL governs the server's stderr diagnostics", () => {
  it('writes a redacted NDJSON line at the default level', async () => {
    const { lines } = await loadSkillsWithFailingFetch({
      errorMessage: "fetch failed reading /home/testuser/.kira/remote-key",
    });

    const emitted = lines.filter((l) => l.includes("remote fetch errored"));
    expect(emitted).toHaveLength(1);

    const record = JSON.parse(emitted[0]) as Record<string, unknown>;
    expect(record.level).toBe("info");
    expect(record.msg).toBe("remote fetch errored");
    expect(record.endpoint).toBe("skills.json");
    expect(typeof record.time).toBe("string");

    // Redaction actually ran: the home path is gone, the rest survives.
    expect(record.error).not.toContain("/home/testuser");
    expect(record.error).toContain("[USER]");
    expect(record.error).toContain("fetch failed");
  });

  it('writes nothing at all when KIRA_LOG_LEVEL=silent', async () => {
    const { lines } = await loadSkillsWithFailingFetch({
      level: "silent",
      errorMessage: "fetch failed reading /home/testuser/.kira/remote-key",
    });

    expect(lines).toEqual([]);
  });

  it("still returns the local corpus when the remote fetch fails", async () => {
    // The logger swap must not change the degrade-to-local behaviour.
    vi.resetModules();
    vi.stubEnv("KIRA_REMOTE_URL", REMOTE);
    vi.stubEnv("KIRA_CACHE_TTL_MS", "1");
    vi.stubEnv("KIRA_LOG_LEVEL", "silent");
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("boom"));

    const { loadAllSkills } = await import("../src/index-loader.ts");
    const skills = await loadAllSkills("free");

    expect(skills.length).toBeGreaterThan(0);
  });
});
