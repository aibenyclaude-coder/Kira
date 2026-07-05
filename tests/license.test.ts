import { describe, it, expect } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import { verifyKeyWithPem, resolveKiraKey } from "../src/license.ts";

const { privateKey, publicKey } = generateKeyPairSync("ec", {
  namedCurve: "P-256",
});
const PUB_PEM = publicKey.export({ type: "spki", format: "pem" }) as string;

const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64url");

function makeKey(claims: Record<string, unknown>, alg = "ES256"): string {
  const h = b64u(JSON.stringify({ alg, kid: "kira-pro-v1" }));
  const p = b64u(JSON.stringify(claims));
  const sig = sign("sha256", Buffer.from(`${h}.${p}`), {
    key: privateKey,
    dsaEncoding: "ieee-p1363",
  });
  return `${h}.${p}.${b64u(sig)}`;
}

const base = {
  sub: "tester",
  iss: "kira.sh",
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 3600,
};

describe("verifyKeyWithPem", () => {
  it("accepts a contributor key", () => {
    expect(verifyKeyWithPem(makeKey({ ...base, tier: "contributor" }), PUB_PEM)).toBe(
      "contributor"
    );
  });

  it("accepts a pro (supporter) key", () => {
    expect(verifyKeyWithPem(makeKey({ ...base, tier: "pro" }), PUB_PEM)).toBe("pro");
  });

  it("expired keys degrade to free — never an error", () => {
    expect(
      verifyKeyWithPem(makeKey({ ...base, tier: "pro", exp: base.iat - 10 }), PUB_PEM)
    ).toBe("free");
  });

  it("rejects a foreign issuer", () => {
    expect(
      verifyKeyWithPem(makeKey({ ...base, tier: "pro", iss: "evil.example" }), PUB_PEM)
    ).toBe("free");
  });

  it("rejects unknown tiers and non-ES256 headers", () => {
    expect(verifyKeyWithPem(makeKey({ ...base, tier: "root" }), PUB_PEM)).toBe("free");
    expect(verifyKeyWithPem(makeKey({ ...base, tier: "pro" }, "HS256"), PUB_PEM)).toBe(
      "free"
    );
  });

  it("rejects tampered payloads (signature over different bytes)", () => {
    const good = makeKey({ ...base, tier: "pro" });
    const [h, , s] = good.split(".") as [string, string, string];
    const forged = `${h}.${b64u(JSON.stringify({ ...base, tier: "pro", sub: "attacker" }))}.${s}`;
    expect(verifyKeyWithPem(forged, PUB_PEM)).toBe("free");
  });

  it("handles garbage without throwing", () => {
    expect(verifyKeyWithPem("not-a-jwt", PUB_PEM)).toBe("free");
    expect(verifyKeyWithPem(undefined, PUB_PEM)).toBe("free");
    expect(verifyKeyWithPem(makeKey({ ...base, tier: "pro" }), undefined)).toBe("free");
  });
});

describe("resolveKiraKey", () => {
  it("prefers KIRA_KEY and falls back to the legacy KIRA_PRO_KEY", () => {
    expect(resolveKiraKey({ KIRA_KEY: "a", KIRA_PRO_KEY: "b" } as NodeJS.ProcessEnv)).toBe("a");
    expect(resolveKiraKey({ KIRA_PRO_KEY: "b" } as NodeJS.ProcessEnv)).toBe("b");
    expect(resolveKiraKey({} as NodeJS.ProcessEnv)).toBeUndefined();
  });
});
