import { describe, it, expect } from "vitest";
import { z } from "zod";

// Mirror of worker/src/index.ts schema. Kept in tests because client doesn't
// validate with zod (it constructs payloads from typed input), but we still
// want to assert the shape evolves in lockstep.
const PayloadSchema = z.object({
  v: z.literal(1),
  skill_id: z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/),
  status: z.enum(["success", "retry", "failure"]),
  client_id: z.string().uuid(),
  kira_version: z.string().min(1).max(32),
  ts: z.string().datetime({ offset: true }),
  env: z.object({
    os: z.enum(["linux", "darwin", "win32", "other"]),
    node_major: z.number().int().min(0).max(99),
    tier: z.enum(["free", "pro"]),
  }),
  detail: z
    .object({
      note: z.string().max(500).optional(),
      context: z.string().max(2000).optional(),
    })
    .optional(),
});

const valid = {
  v: 1,
  skill_id: "community.deploy-vercel-nextjs.v1",
  status: "success",
  client_id: "00000000-0000-4000-8000-000000000001",
  kira_version: "0.5.0",
  ts: "2026-05-10T00:00:00.000Z",
  env: { os: "linux", node_major: 20, tier: "free" },
};

describe("ReportPayloadV1 schema", () => {
  it("accepts a basic-level payload", () => {
    expect(PayloadSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts a full-level payload with detail", () => {
    const r = PayloadSchema.safeParse({
      ...valid,
      detail: { note: "ok", context: "nextjs" },
    });
    expect(r.success).toBe(true);
  });

  it("rejects v=2", () => {
    expect(PayloadSchema.safeParse({ ...valid, v: 2 }).success).toBe(false);
  });

  it("rejects illegal skill_id chars", () => {
    expect(
      PayloadSchema.safeParse({ ...valid, skill_id: "BAD ID with spaces" }).success
    ).toBe(false);
  });

  it("rejects oversize note", () => {
    expect(
      PayloadSchema.safeParse({
        ...valid,
        detail: { note: "x".repeat(501) },
      }).success
    ).toBe(false);
  });

  it("rejects missing client_id", () => {
    const { client_id: _, ...rest } = valid;
    expect(PayloadSchema.safeParse(rest).success).toBe(false);
  });
});
