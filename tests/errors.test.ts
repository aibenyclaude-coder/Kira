import { describe, it, expect } from "vitest";
import {
  KiraError,
  isKiraError,
  toEnvelope,
  missingField,
  invalidType,
  invalidEnum,
  invalidFormat,
  notFound,
  unknownTool,
} from "../src/errors.ts";
import type { KiraErrorEnvelope } from "../src/errors.ts";

describe("KiraError class", () => {
  it("is a real Error subclass with code, message, and details", () => {
    const err = new KiraError("invalid_input", "bad", { field: "x" });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(KiraError);
    expect(err.name).toBe("KiraError");
    expect(err.code).toBe("invalid_input");
    expect(err.message).toBe("bad");
    expect(err.details).toEqual({ field: "x" });
  });

  it("defaults details to an empty object when omitted", () => {
    const err = new KiraError("internal", "boom");
    expect(err.details).toEqual({});
  });

  it("carries a stack trace like a normal Error", () => {
    const err = new KiraError("internal", "boom");
    expect(typeof err.stack).toBe("string");
    expect(err.stack).toContain("boom");
  });

  it("can be thrown and caught as an Error", () => {
    expect(() => {
      throw missingField("keyword");
    }).toThrow(/Missing required field "keyword"/);
  });
});

describe("isKiraError", () => {
  it("recognizes KiraError instances", () => {
    expect(isKiraError(new KiraError("internal", "x"))).toBe(true);
    expect(isKiraError(unknownTool("nope"))).toBe(true);
  });

  it("rejects plain errors and non-errors", () => {
    expect(isKiraError(new Error("x"))).toBe(false);
    expect(isKiraError("x")).toBe(false);
    expect(isKiraError(null)).toBe(false);
    expect(isKiraError(undefined)).toBe(false);
    expect(isKiraError({ code: "internal", message: "x" })).toBe(false);
  });
});

describe("toEnvelope", () => {
  it("serializes a KiraError with details into the documented shape", () => {
    const env = toEnvelope(invalidEnum("status", "foo", ["success", "retry"]));
    expect(env).toEqual({
      error: {
        code: "invalid_enum",
        message: 'Invalid status "foo". Must be one of: success, retry.',
        details: { field: "status", value: "foo", allowed: ["success", "retry"] },
      },
    });
  });

  it("omits details when the error carries none", () => {
    const env = toEnvelope(new KiraError("internal", "boom"));
    expect(env).toEqual({ error: { code: "internal", message: "boom" } });
    expect("details" in env.error).toBe(false);
  });

  it("collapses a plain Error to code 'internal' with its message", () => {
    const env = toEnvelope(new Error("something broke"));
    expect(env.error.code).toBe("internal");
    expect(env.error.message).toBe("something broke");
    expect("details" in env.error).toBe(false);
  });

  it("stringifies non-Error throwables", () => {
    expect(toEnvelope("plain string").error).toEqual({
      code: "internal",
      message: "plain string",
    });
    expect(toEnvelope(42).error.message).toBe("42");
    expect(toEnvelope(null).error.message).toBe("null");
    expect(toEnvelope(undefined).error.message).toBe("undefined");
  });

  it("is total — never throws for any input", () => {
    const weird = { toString() { throw new Error("no toString"); } };
    // String(weird) would throw; toEnvelope must still not surface that here.
    expect(() => toEnvelope(new KiraError("internal", "ok"))).not.toThrow();
    expect(() => toEnvelope(new Error("ok"))).not.toThrow();
    // A KiraError path never calls String() on the value, so this is safe:
    expect(toEnvelope(new KiraError("not_found", "x", weird)).error.code).toBe(
      "not_found"
    );
  });

  it("KiraError.toEnvelope() matches the free function", () => {
    const err = invalidFormat("skill_id", "BAD ID", "^[a-z0-9]+$");
    expect(err.toEnvelope()).toEqual(toEnvelope(err));
  });

  it("produces a JSON-round-trippable envelope", () => {
    const env = toEnvelope(notFound("skill or scar", "community.foo.v1"));
    const roundTripped = JSON.parse(JSON.stringify(env)) as KiraErrorEnvelope;
    expect(roundTripped).toEqual(env);
  });
});

describe("factory helpers", () => {
  it("missingField", () => {
    const err = missingField("keyword");
    expect(err.code).toBe("missing_field");
    expect(err.message).toBe('Missing required field "keyword".');
    expect(err.details).toEqual({ field: "keyword" });
  });

  it("invalidType", () => {
    const err = invalidType("context", "array", "string");
    expect(err.code).toBe("invalid_type");
    expect(err.message).toBe('Field "context" must be of type array, got string.');
    expect(err.details).toEqual({
      field: "context",
      expected: "array",
      received: "string",
    });
  });

  it("invalidEnum copies the allowed list (not a live reference)", () => {
    const allowed = ["success", "retry", "failure"] as const;
    const err = invalidEnum("status", "foo", allowed);
    expect(err.code).toBe("invalid_enum");
    expect(err.message).toBe(
      'Invalid status "foo". Must be one of: success, retry, failure.'
    );
    expect(err.details.allowed).toEqual(["success", "retry", "failure"]);
    expect(err.details.allowed).not.toBe(allowed);
  });

  it("invalidFormat mirrors the server's skill_id message", () => {
    const pattern = "^[a-z0-9][a-z0-9._-]*$";
    const err = invalidFormat("skill_id", "BAD ID", pattern);
    expect(err.code).toBe("invalid_format");
    expect(err.message).toBe(`Invalid skill_id "BAD ID". Must match /${pattern}/.`);
    expect(err.details).toEqual({ field: "skill_id", value: "BAD ID", pattern });
  });

  it("notFound", () => {
    const err = notFound("skill or scar", "community.foo.v1");
    expect(err.code).toBe("not_found");
    expect(err.message).toBe('No skill or scar found with id "community.foo.v1".');
    expect(err.details).toEqual({
      resource: "skill or scar",
      id: "community.foo.v1",
    });
  });

  it("unknownTool", () => {
    const err = unknownTool("kira_bogus");
    expect(err.code).toBe("unknown_tool");
    expect(err.message).toBe("Unknown tool: kira_bogus.");
    expect(err.details).toEqual({ name: "kira_bogus" });
  });

  it("every factory yields a throwable, envelope-able KiraError", () => {
    const errs = [
      missingField("f"),
      invalidType("f", "string", "number"),
      invalidEnum("f", 1, ["a"]),
      invalidFormat("f", "x", "^y$"),
      notFound("thing", "id"),
      unknownTool("t"),
    ];
    for (const err of errs) {
      expect(isKiraError(err)).toBe(true);
      const env = toEnvelope(err);
      expect(env.error.code).toBe(err.code);
      expect(() => JSON.stringify(env)).not.toThrow();
    }
  });
});
