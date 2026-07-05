import { describe, it, expect, vi, afterEach } from "vitest";
import { Logger, createLogger, parseLogLevel } from "../src/logger.ts";

const FIXED_TIME = "2026-07-05T00:00:00.000Z";
const now = () => FIXED_TIME;

// A fake secret shaped to trip the `sk-` sanitizer pattern (>=20 trailing chars).
const FAKE_KEY = "sk-NOTREALNOTREALNOTREALNOTREALNOT";

/** Capture emitted lines instead of touching a real stream. */
function capture() {
  const lines: string[] = [];
  const write = (line: string) => {
    lines.push(line);
  };
  return { lines, write };
}

/** Parse the single JSON record on line `i` (strips the trailing newline). */
function record(lines: string[], i = 0): Record<string, unknown> {
  return JSON.parse(lines[i]!.replace(/\n$/, ""));
}

describe("parseLogLevel", () => {
  it("recognizes the three canonical levels", () => {
    expect(parseLogLevel("silent")).toBe("silent");
    expect(parseLogLevel("info")).toBe("info");
    expect(parseLogLevel("debug")).toBe("debug");
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(parseLogLevel(" DEBUG ")).toBe("debug");
    expect(parseLogLevel("Silent")).toBe("silent");
  });

  it("defaults unknown / empty / undefined to info", () => {
    expect(parseLogLevel(undefined)).toBe("info");
    expect(parseLogLevel("")).toBe("info");
    expect(parseLogLevel("verbose")).toBe("info");
  });
});

describe("level gating", () => {
  it("silent writes nothing at all", () => {
    const { lines, write } = capture();
    const log = new Logger({ level: "silent", write, now });
    log.info("hello");
    log.debug("world");
    expect(lines).toHaveLength(0);
    expect(log.isEnabled("info")).toBe(false);
    expect(log.isEnabled("debug")).toBe(false);
  });

  it("info emits info() but suppresses debug()", () => {
    const { lines, write } = capture();
    const log = new Logger({ level: "info", write, now });
    log.debug("suppressed");
    expect(lines).toHaveLength(0);
    log.info("shown");
    expect(lines).toHaveLength(1);
    expect(record(lines).level).toBe("info");
    expect(record(lines).msg).toBe("shown");
    expect(log.isEnabled("info")).toBe(true);
    expect(log.isEnabled("debug")).toBe(false);
  });

  it("debug emits both info() and debug()", () => {
    const { lines, write } = capture();
    const log = new Logger({ level: "debug", write, now });
    log.info("a");
    log.debug("b");
    expect(lines).toHaveLength(2);
    expect(record(lines, 0).level).toBe("info");
    expect(record(lines, 1).level).toBe("debug");
    expect(log.isEnabled("debug")).toBe(true);
  });

  it("exposes the configured level", () => {
    expect(new Logger({ level: "debug", write: () => {} }).level).toBe("debug");
  });
});

describe("structured output", () => {
  it("emits one valid JSON object per line, newline-terminated", () => {
    const { lines, write } = capture();
    const log = new Logger({ level: "info", write, now });
    log.info("server started", { tier: "pro", port: 8787, ok: true });

    expect(lines).toHaveLength(1);
    expect(lines[0]!.endsWith("\n")).toBe(true);
    expect(lines[0]!.match(/\n/g)).toHaveLength(1); // exactly one line

    const r = record(lines);
    expect(r).toMatchObject({
      time: FIXED_TIME,
      level: "info",
      msg: "server started",
      tier: "pro",
      port: 8787,
      ok: true,
    });
  });

  it("uses the injected clock for the time field", () => {
    const { lines, write } = capture();
    new Logger({ level: "info", write, now: () => "2000-01-01T00:00:00.000Z" }).info("x");
    expect(record(lines).time).toBe("2000-01-01T00:00:00.000Z");
  });

  it("never lets caller fields clobber the envelope", () => {
    const { lines, write } = capture();
    const log = new Logger({ level: "info", write, now });
    log.info("real message", { msg: "fake", level: "debug", time: "hacked" });
    const r = record(lines);
    expect(r.msg).toBe("real message");
    expect(r.level).toBe("info");
    expect(r.time).toBe(FIXED_TIME);
  });
});

describe("redaction before write", () => {
  it("redacts secrets in the message", () => {
    const { lines, write } = capture();
    const log = new Logger({ level: "info", write, now });
    log.info(`booting with ${FAKE_KEY} loaded`);
    const r = record(lines);
    expect(r.msg).toContain("[REDACTED]");
    expect(lines[0]).not.toContain("sk-NOTREAL");
  });

  it("redacts secrets and home paths in structured fields", () => {
    const { lines, write } = capture();
    const log = new Logger({ level: "info", write, now });
    log.info("auth", {
      token: FAKE_KEY,
      home: "/home/alice/projects/app",
      email: "bob@example.com",
      port: 8080,
    });
    const r = record(lines);
    expect(r.token).toBe("[REDACTED]");
    expect(r.home).toContain("[USER]");
    expect(r.home).not.toContain("alice");
    expect(r.email).toBe("[EMAIL]");
    expect(r.port).toBe(8080); // non-string leaves pass through untouched
    expect(lines[0]).not.toContain("sk-NOTREAL");
    expect(lines[0]).not.toContain("bob@example.com");
  });

  it("redacts nested string leaves", () => {
    const { lines, write } = capture();
    const log = new Logger({ level: "info", write, now });
    log.info("nested", { meta: { creds: { key: FAKE_KEY } } });
    const r = record(lines) as { meta: { creds: { key: string } } };
    expect(r.meta.creds.key).toBe("[REDACTED]");
    expect(lines[0]).not.toContain("sk-NOTREAL");
  });

  it("serializes Error values with a redacted message", () => {
    const { lines, write } = capture();
    const log = new Logger({ level: "info", write, now });
    log.info("caught", { err: new Error(`boom ${FAKE_KEY}`) });
    const r = record(lines) as { err: { name: string; message: string } };
    expect(r.err.name).toBe("Error");
    expect(r.err.message).toContain("[REDACTED]");
    expect(lines[0]).not.toContain("sk-NOTREAL");
  });

  it("passes secrets through when redaction is disabled", () => {
    const { lines, write } = capture();
    const log = new Logger({ level: "info", write, now, redact: false });
    log.info(FAKE_KEY, { token: FAKE_KEY });
    expect(record(lines).msg).toBe(FAKE_KEY);
    expect(record(lines).token).toBe(FAKE_KEY);
  });
});

describe("robustness", () => {
  it("bounds deep nesting instead of recursing forever", () => {
    const { lines, write } = capture();
    const log = new Logger({ level: "info", write, now });
    log.info("deep", { a: { b: { c: { d: { e: "too deep" } } } } });
    expect(lines[0]).toContain("[truncated]");
    expect(lines[0]).not.toContain("too deep");
  });

  it("does not throw on circular structures", () => {
    const { lines, write } = capture();
    const log = new Logger({ level: "info", write, now });
    const cyclic: Record<string, unknown> = { name: "root" };
    cyclic.self = cyclic;
    expect(() => log.info("cycle", { cyclic })).not.toThrow();
    expect(lines).toHaveLength(1);
    // The emitted line is itself valid JSON.
    expect(() => record(lines)).not.toThrow();
  });

  it("drops functions and undefined field values", () => {
    const { lines, write } = capture();
    const log = new Logger({ level: "info", write, now });
    log.info("drop", { fn: () => 1, missing: undefined, kept: "yes" });
    const r = record(lines);
    expect("fn" in r).toBe(false);
    expect("missing" in r).toBe(false);
    expect(r.kept).toBe("yes");
  });
});

describe("stream routing", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes to stderr and never stdout by default", () => {
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    // No `write` option → exercises the real default sink.
    const log = new Logger({ level: "info", now });
    log.info("to stderr", { k: "v" });

    expect(stderrSpy).toHaveBeenCalledTimes(1);
    expect(stdoutSpy).not.toHaveBeenCalled();

    const written = String(stderrSpy.mock.calls[0]![0]);
    expect(written.endsWith("\n")).toBe(true);
    expect(JSON.parse(written.replace(/\n$/, "")).msg).toBe("to stderr");
  });
});

describe("createLogger", () => {
  it("is equivalent to the constructor", () => {
    const { lines, write } = capture();
    const log = createLogger({ level: "info", write, now });
    log.info("via factory");
    expect(record(lines).msg).toBe("via factory");
  });
});
