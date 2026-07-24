import { describe, it, expect } from "vitest";
import {
  sanitize,
  sanitizeWithReport,
  sanitizePayload,
  NOTE_MAX,
  CONTEXT_MAX,
} from "../src/sanitize.ts";
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
    const long = "X".repeat(1000) + " sk-NOTREALNOTREALNOTREALNOTREALNOT";
    const out = sanitize(long, 100)!;
    expect(out.length).toBe(100);
    expect(out).not.toContain("sk-NOTREALNOTREALNOTREALNOTREALNOT");
  });

  it("is idempotent", () => {
    const input = "sk-NOTREALNOTREALNOTREALNOTREALNOT in /home/u/p";
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
        note: "leaked sk-NOTREALNOTREALNOTREALNOTREALNOT here",
        context: "in /home/alice/proj",
      },
    };
    const out = sanitizePayload(p);
    expect(out.detail?.note).toContain("[REDACTED]");
    expect(out.detail?.note).not.toContain("sk-NOTREAL");
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

describe("sanitizeWithReport", () => {
  it("produces byte-identical text to sanitize()", () => {
    const samples = [
      "env -i HOME=/tmp/x PATH=/usr/bin kira",
      "npm published kira-mcp@0.8.2 successfully",
      "contact alice@example.com from 10.0.0.5",
      "nothing to redact here at all",
      "",
    ];
    for (const s of samples) {
      expect(sanitizeWithReport(s, 4096).text).toBe(sanitize(s, 4096));
    }
  });

  it("reports nothing for clean text", () => {
    const { report } = sanitizeWithReport("plain prose, no secrets", 4096);
    expect(report.hits).toEqual([]);
    expect(report.truncated).toBe(false);
  });

  it("names the rule that fired and counts every span", () => {
    const { report } = sanitizeWithReport("env -i HOME=/tmp/x PATH=/usr/bin", 4096);
    expect(report.hits).toEqual([{ pattern: "env-assignment", count: 2 }]);
  });

  it("no longer eats an npm spec, and says so by reporting nothing", () => {
    // A real corruption found in a live personal-scar store: the lesson said
    // "npm published kira-mcp@0.8.2" and reached disk as "npm published
    // [EMAIL]". A TLD is never all digits, so this is not an address.
    const { text, report } = sanitizeWithReport("npm published kira-mcp@0.8.2", 4096);
    expect(text).toBe("npm published kira-mcp@0.8.2");
    expect(report.hits).toEqual([]);
  });

  it("still reports the systemd-unit false positive it cannot yet tell apart", () => {
    // The other real corruption from the same store. `service` is alphabetic,
    // so it reads as a TLD — deliberately still redacted, and deliberately
    // still REPORTED, so the caller can rephrase rather than trust the lesson.
    expect(
      sanitizeWithReport("cgroup showed iroha-worker@1.service", 4096).report.hits
    ).toEqual([{ pattern: "email", count: 1 }]);
  });

  it("folds rules that share a name into one entry", () => {
    const two = `ghp_${"a".repeat(30)} and github_pat_${"b".repeat(40)}`;
    const { report } = sanitizeWithReport(two, 4096);
    expect(report.hits).toEqual([{ pattern: "github-token", count: 2 }]);
  });

  it("flags truncation separately from redaction", () => {
    const { report } = sanitizeWithReport("X".repeat(200), 100);
    expect(report.truncated).toBe(true);
    expect(report.hits).toEqual([]);
  });

  it("reports nothing on a second pass (idempotent)", () => {
    const once = sanitize("mail alice@example.com, HOME=/tmp/x", 4096)!;
    expect(sanitizeWithReport(once, 4096).report.hits).toEqual([]);
  });

  it("passes undefined through with an empty report", () => {
    const { text, report } = sanitizeWithReport(undefined, 100);
    expect(text).toBeUndefined();
    expect(report).toEqual({ hits: [], truncated: false });
  });
});

describe("worker sanitizer parity", () => {
  // worker/src/sanitize.ts is a deliberate copy (the Worker must build with no
  // dependency on this project), and a hand-maintained duplicate drifts: the
  // pattern list here changed once while the Worker kept redacting the old way,
  // which is a privacy rule enforced differently on each side of the wire.
  it("redacts identically to the client copy", async () => {
    const worker = await import("../worker/src/sanitize.ts");
    const samples = [
      "contact alice@example.com please",
      "wrote to someone@163.com twice",
      "relayed via user@192.168.1.1 today",
      "npm published kira-mcp@0.8.2 ok",
      "cgroup showed iroha-worker@1.service",
      "env -i HOME=/tmp/x PATH=/usr/bin kira",
      "see /home/alice/projects/foo and 10.0.0.5",
      "id 550e8400-e29b-41d4-a716-446655440000 in db",
      "plain prose, no secrets",
    ];
    for (const s of samples) {
      expect(worker.sanitize(s, 4096), s).toBe(sanitize(s, 4096));
    }
  });
});
