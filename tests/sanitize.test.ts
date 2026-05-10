import { describe, it, expect } from "vitest";
import { sanitize, sanitizePayload, NOTE_MAX, CONTEXT_MAX } from "../src/sanitize.ts";
import type { ReportPayloadV1 } from "../src/types.ts";
import fixtures from "./fixtures/redaction-cases.json" with { type: "json" };

describe("sanitize patterns", () => {
  for (const c of fixtures.cases) {
    it(`redacts: ${c.name}`, () => {
      const out = sanitize(c.input, 4096)!;
      if ("expectContains" in c && c.expectContains) {
        expect(out).toContain(c.expectContains);
      }
      if ("expectNotContains" in c && c.expectNotContains) {
        expect(out).not.toContain(c.expectNotContains);
      }
    });
  }

  for (const c of fixtures.negative_cases) {
    it(`leaves untouched: ${c.name}`, () => {
      const out = sanitize(c.input, 4096)!;
      if ("expectEqual" in c && c.expectEqual) {
        expect(out).toBe(c.expectEqual);
      }
      if ("expectContains" in c && c.expectContains) {
        expect(out).toContain(c.expectContains);
      }
    });
  }
});

describe("sanitize edge cases", () => {
  it("returns undefined for undefined input", () => {
    expect(sanitize(undefined, 100)).toBeUndefined();
  });

  it("truncates to maxLen before applying patterns", () => {
    // Use uppercase non-hex filler to avoid triggering any redaction pattern.
    const long = "X".repeat(1000) + " sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ012345";
    const out = sanitize(long, 100)!;
    expect(out.length).toBe(100);
    expect(out).not.toContain("sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ012345");
  });

  it("is idempotent", () => {
    const input = "sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ012345 in /home/u/p";
    const once = sanitize(input, 4096)!;
    const twice = sanitize(once, 4096)!;
    expect(twice).toBe(once);
  });
});

describe("sanitizePayload", () => {
  const base: ReportPayloadV1 = {
    v: 1,
    skill_id: "community.deploy-vercel-nextjs.v1",
    status: "success",
    client_id: "00000000-0000-4000-8000-000000000001",
    kira_version: "0.5.0",
    ts: "2026-05-10T00:00:00.000Z",
    env: { os: "linux", node_major: 20, tier: "free" },
  };

  it("passes through when no detail layer", () => {
    expect(sanitizePayload(base)).toEqual(base);
  });

  it("redacts note and context", () => {
    const p: ReportPayloadV1 = {
      ...base,
      detail: {
        note: "leaked sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ012345 here",
        context: "in /home/alice/proj",
      },
    };
    const out = sanitizePayload(p);
    expect(out.detail?.note).toContain("[REDACTED]");
    expect(out.detail?.note).not.toContain("sk-ABCDEFG");
    expect(out.detail?.context).toContain("/[USER]");
  });

  it("respects field length caps", () => {
    expect(NOTE_MAX).toBe(500);
    expect(CONTEXT_MAX).toBe(2000);
    const p: ReportPayloadV1 = {
      ...base,
      detail: { note: "x".repeat(1000), context: "y".repeat(5000) },
    };
    const out = sanitizePayload(p);
    expect(out.detail?.note?.length).toBe(NOTE_MAX);
    expect(out.detail?.context?.length).toBe(CONTEXT_MAX);
  });
});
