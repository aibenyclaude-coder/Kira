/**
 * Kira error taxonomy — a structured error class and a JSON error envelope
 * for invalid tool inputs.
 *
 * Today the MCP tool handlers throw bare `Error`s with a human-readable string
 * (see src/server.ts, src/tools/kira_consent.ts). That is fine for a human
 * reading a log, but an agent on the other end of the transport cannot tell
 * "you passed a bad enum value" apart from "the id you asked for doesn't exist"
 * apart from "the server blew up". `KiraError` attaches a stable machine code
 * and a structured `details` bag so callers can branch on the failure kind
 * without string-matching the message.
 *
 * ── JSON error envelope ────────────────────────────────────────────────────
 *
 * `toEnvelope()` serializes any thrown value into a single, stable shape. This
 * is what a tool handler embeds in its result text when an input is rejected:
 *
 *   {
 *     "error": {
 *       "code": "invalid_enum",
 *       "message": "Invalid status \"foo\". Must be one of: success, retry, failure.",
 *       "details": {
 *         "field": "status",
 *         "value": "foo",
 *         "allowed": ["success", "retry", "failure"]
 *       }
 *     }
 *   }
 *
 * Field contract:
 *   error.code     — one of {@link KiraErrorCode}; stable, safe to branch on.
 *   error.message  — human-readable, one line. May echo the offending value.
 *   error.details  — optional object with per-code context (field/value/etc.).
 *                    Omitted from the envelope when empty. Always JSON-safe.
 *
 * Unknown / non-Kira throwables collapse to code "internal" so the envelope is
 * total: {@link toEnvelope} never itself throws and always yields this shape.
 *
 * This module is pure and dependency-free — no I/O, no network, no stdout. It
 * never writes anywhere, so it is safe to use inside the stdio MCP transport.
 */

/**
 * Stable machine-readable failure kinds.
 *
 *   invalid_input  — generic bad argument that no more specific code fits.
 *   missing_field  — a required field was absent or null/undefined.
 *   invalid_type   — a field was present but of the wrong JSON type.
 *   invalid_enum   — a value was not one of the allowed choices.
 *   invalid_format — a string failed its required pattern (e.g. an id regex).
 *   not_found      — a referenced id/resource does not exist.
 *   unknown_tool   — the request named a tool the server does not expose.
 *   internal       — an unexpected error the server did not classify.
 */
export type KiraErrorCode =
  | "invalid_input"
  | "missing_field"
  | "invalid_type"
  | "invalid_enum"
  | "invalid_format"
  | "not_found"
  | "unknown_tool"
  | "internal";

/** JSON-serializable per-error context. Values must survive `JSON.stringify`. */
export type KiraErrorDetails = Record<string, unknown>;

/** The serialized wire shape produced by {@link KiraError.toEnvelope}. */
export interface KiraErrorEnvelope {
  error: {
    code: KiraErrorCode;
    message: string;
    /** Present only when non-empty. */
    details?: KiraErrorDetails;
  };
}

/**
 * A structured, code-tagged error.
 *
 * `message` is inherited from `Error` (human-readable, one line). `code` and
 * `details` add the machine-branchable layer. Prefer the factory helpers below
 * (`missingField`, `invalidEnum`, …) over the constructor so messages and
 * detail keys stay consistent across the codebase.
 */
export class KiraError extends Error {
  readonly code: KiraErrorCode;
  /** Structured context; always an object (empty when none was supplied). */
  readonly details: KiraErrorDetails;

  constructor(code: KiraErrorCode, message: string, details?: KiraErrorDetails) {
    super(message);
    this.name = "KiraError";
    this.code = code;
    this.details = details ?? {};
  }

  /** Serialize into the stable {@link KiraErrorEnvelope} JSON shape. */
  toEnvelope(): KiraErrorEnvelope {
    return toEnvelope(this);
  }
}

/** Type guard: is `value` a {@link KiraError}? */
export function isKiraError(value: unknown): value is KiraError {
  return value instanceof KiraError;
}

/** True when `details` carries at least one own key. */
function hasDetails(details: KiraErrorDetails): boolean {
  return Object.keys(details).length > 0;
}

/**
 * Convert any thrown value into a {@link KiraErrorEnvelope}. Total: never
 * throws. A {@link KiraError} keeps its code and details; a plain `Error`
 * becomes "internal" with its message; anything else is stringified.
 */
export function toEnvelope(err: unknown): KiraErrorEnvelope {
  if (isKiraError(err)) {
    return {
      error: {
        code: err.code,
        message: err.message,
        ...(hasDetails(err.details) ? { details: err.details } : {}),
      },
    };
  }
  if (err instanceof Error) {
    return { error: { code: "internal", message: err.message } };
  }
  return { error: { code: "internal", message: String(err) } };
}

// ── Factory helpers ────────────────────────────────────────────────────────
// Each produces a KiraError with a consistent message and detail shape. The
// messages mirror the phrasing already used by the tool handlers.

/** A required field was absent (undefined / null / empty). */
export function missingField(field: string): KiraError {
  return new KiraError("missing_field", `Missing required field "${field}".`, {
    field,
  });
}

/** A field was present but of the wrong JSON type. */
export function invalidType(
  field: string,
  expected: string,
  received: string
): KiraError {
  return new KiraError(
    "invalid_type",
    `Field "${field}" must be of type ${expected}, got ${received}.`,
    { field, expected, received }
  );
}

/** A value was not one of the allowed choices. */
export function invalidEnum(
  field: string,
  value: unknown,
  allowed: readonly string[]
): KiraError {
  return new KiraError(
    "invalid_enum",
    `Invalid ${field} "${String(value)}". Must be one of: ${allowed.join(", ")}.`,
    { field, value, allowed: [...allowed] }
  );
}

/** A string failed its required pattern (e.g. an id regex). */
export function invalidFormat(
  field: string,
  value: unknown,
  pattern: string
): KiraError {
  return new KiraError(
    "invalid_format",
    `Invalid ${field} "${String(value)}". Must match /${pattern}/.`,
    { field, value, pattern }
  );
}

/** A referenced id/resource does not exist. */
export function notFound(resource: string, id: string): KiraError {
  return new KiraError(
    "not_found",
    `No ${resource} found with id "${id}".`,
    { resource, id }
  );
}

/** The request named a tool the server does not expose. */
export function unknownTool(name: string): KiraError {
  return new KiraError("unknown_tool", `Unknown tool: ${name}.`, { name });
}
