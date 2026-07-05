/**
 * Structured stderr logger for the Kira MCP server.
 *
 * WHY stderr: this process speaks the MCP protocol over **stdout**
 * (StdioServerTransport). Writing a single stray byte to stdout corrupts the
 * JSON-RPC stream and breaks the client. Every diagnostic line therefore goes
 * to **stderr**, which the client ignores for protocol purposes.
 *
 * WHAT it emits: one JSON object per line (NDJSON), e.g.
 *   {"time":"2026-07-05T00:00:00.000Z","level":"info","msg":"server started","tier":"pro"}
 *
 * REDACTION: every message and every string leaf of the structured fields is
 * passed through the shared `sanitize` scrubber (src/sanitize.ts) before the
 * line is written, so secrets (API keys, JWTs, emails, home paths, …) never
 * reach the log — the same guarantee the telemetry path already provides.
 *
 * LEVELS (via `KIRA_LOG_LEVEL`, default "info"):
 *   silent → nothing is written
 *   info   → info() lines
 *   debug  → info() and debug() lines
 */

import { sanitize } from "./sanitize.js";

/** Configured verbosity threshold. */
export type LogLevel = "silent" | "info" | "debug";

/** Severity a single log call is emitted at (the non-silent subset). */
export type MessageLevel = "info" | "debug";

/** Structured key/value pairs attached to a log line. */
export type LogFields = Record<string, unknown>;

/** Ordering used to gate messages: a call at `msg` emits when rank ≥ rank. */
const LEVEL_RANK: Record<LogLevel, number> = { silent: 0, info: 1, debug: 2 };

/** Length caps bound both regex work and log-line size. */
const MSG_CAP = 2048;
const VALUE_CAP = 4096;
/** Recursion bound for nested field objects — also guards circular refs. */
const MAX_DEPTH = 4;

/** Envelope keys a caller's fields must not overwrite. */
const RESERVED = new Set(["time", "level", "msg"]);

/**
 * Normalize a raw `KIRA_LOG_LEVEL` value. Unknown/empty values fall back to
 * "info" (case-insensitive, surrounding whitespace ignored).
 */
export function parseLogLevel(raw: string | undefined): LogLevel {
  switch ((raw ?? "").trim().toLowerCase()) {
    case "silent":
      return "silent";
    case "debug":
      return "debug";
    case "info":
      return "info";
    default:
      return "info";
  }
}

export interface LoggerOptions {
  /** Threshold. Defaults to `parseLogLevel(process.env.KIRA_LOG_LEVEL)`. */
  level?: LogLevel;
  /** Sink for a fully-formed line (newline included). Defaults to stderr. */
  write?: (line: string) => void;
  /** Timestamp source. Defaults to `() => new Date().toISOString()`. */
  now?: () => string;
  /** Run the redaction scrubber before writing. Defaults to true. */
  redact?: boolean;
}

export class Logger {
  private readonly _level: LogLevel;
  private readonly _write: (line: string) => void;
  private readonly _now: () => string;
  private readonly _redact: boolean;

  constructor(opts: LoggerOptions = {}) {
    this._level = opts.level ?? parseLogLevel(process.env.KIRA_LOG_LEVEL);
    this._write =
      opts.write ??
      ((line) => {
        // Explicitly stderr — stdout is the MCP transport.
        process.stderr.write(line);
      });
    this._now = opts.now ?? (() => new Date().toISOString());
    this._redact = opts.redact ?? true;
  }

  /** The configured threshold. */
  get level(): LogLevel {
    return this._level;
  }

  /** True when a call at `msgLevel` would produce output. */
  isEnabled(msgLevel: MessageLevel): boolean {
    return LEVEL_RANK[this._level] >= LEVEL_RANK[msgLevel];
  }

  info(msg: string, fields?: LogFields): void {
    this.emit("info", msg, fields);
  }

  debug(msg: string, fields?: LogFields): void {
    this.emit("debug", msg, fields);
  }

  private emit(msgLevel: MessageLevel, msg: string, fields?: LogFields): void {
    if (!this.isEnabled(msgLevel)) return;

    const record: Record<string, unknown> = {
      time: this._now(),
      level: msgLevel,
      msg: this.scrubString(msg, MSG_CAP),
    };

    if (fields) {
      for (const [k, v] of Object.entries(fields)) {
        if (RESERVED.has(k)) continue; // never let a field clobber the envelope
        const scrubbed = this.scrubValue(v, 1);
        if (scrubbed !== undefined) record[k] = scrubbed;
      }
    }

    let line: string;
    try {
      line = JSON.stringify(record);
    } catch {
      // Circular/unserializable field slipped past scrubValue — degrade
      // gracefully rather than throw inside a log call.
      line = JSON.stringify({
        time: record.time,
        level: msgLevel,
        msg: record.msg,
        log_error: "serialize_failed",
      });
    }

    this._write(line + "\n");
  }

  private scrubString(s: string, cap: number): string {
    return this._redact ? sanitize(s, cap)! : s;
  }

  /**
   * Redact a structured value recursively. String leaves go through the
   * scrubber; numbers/booleans/null pass through; functions/symbols/undefined
   * are dropped (returned as undefined and omitted by the caller).
   */
  private scrubValue(v: unknown, depth: number): unknown {
    if (v === null) return null;

    switch (typeof v) {
      case "string":
        return this.scrubString(v, VALUE_CAP);
      case "number":
      case "boolean":
        return v;
      case "bigint":
        return v.toString();
      case "undefined":
      case "function":
      case "symbol":
        return undefined;
    }

    if (v instanceof Error) {
      return {
        name: v.name,
        message: this.scrubString(v.message, VALUE_CAP),
      };
    }

    if (depth >= MAX_DEPTH) return "[truncated]";

    if (Array.isArray(v)) {
      return v.map((item) => this.scrubValue(item, depth + 1));
    }

    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      const scrubbed = this.scrubValue(val, depth + 1);
      if (scrubbed !== undefined) out[k] = scrubbed;
    }
    return out;
  }
}

/** Construct a logger; equivalent to `new Logger(opts)`. */
export function createLogger(opts?: LoggerOptions): Logger {
  return new Logger(opts);
}

/**
 * Process-wide default logger. Reads `KIRA_LOG_LEVEL` once at import and
 * writes to stderr. Import this for ordinary server logging.
 */
export const logger = new Logger();
