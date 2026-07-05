/**
 * Kira key verification — free / contributor / pro tiers (RECIPROCITY.md).
 *
 * - `contributor` is EARNED: one accepted community scar → a signed key.
 * - `pro` (supporter) is paid.
 * - Both unlock the fresh community feed; everything else is free forever.
 *
 * ES256 JWTs with standard raw (ieee-p1363) signatures, verified with Node
 * crypto — zero external dependencies. The public key ships with the npm
 * package; the private key never leaves the signing machine.
 *
 * Invalid/expired/missing key → "free" tier (never an error).
 */
import { verify as cryptoVerify } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export type KiraTier = "free" | "contributor" | "pro";

interface KeyClaims {
  sub: string;
  email?: string;
  tier: "pro" | "contributor";
  iss: string;
  iat: number;
  exp: number;
}

const PROJECT_ROOT = join(__dirname, "..");

// Load public keys at module init. kid → PEM map.
const PUBLIC_KEYS: Record<string, string> = {};
try {
  PUBLIC_KEYS["kira-pro-v1"] = readFileSync(
    join(PROJECT_ROOT, "src", "keys", "kira-pro-v1.pub.pem"),
    "utf-8"
  );
} catch {
  // Key file missing — all verifications will return "free".
}

function base64UrlDecode(str: string): Buffer {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(padded, "base64");
}

function decodeJwtPart<T>(part: string): T {
  return JSON.parse(base64UrlDecode(part).toString("utf-8")) as T;
}

/** The key env var: KIRA_KEY, with KIRA_PRO_KEY kept as a legacy alias. */
export function resolveKiraKey(
  env: NodeJS.ProcessEnv = process.env
): string | undefined {
  return env.KIRA_KEY ?? env.KIRA_PRO_KEY;
}

/**
 * Verify a Kira key JWT against a specific public key PEM.
 * Exported for tests; production callers use verifyProKey (embedded keys).
 */
export function verifyKeyWithPem(
  key: string | undefined,
  publicKeyPem: string | undefined
): KiraTier {
  if (!key || !publicKeyPem) return "free";

  try {
    const parts = key.split(".");
    if (parts.length !== 3) return "free";

    const [headerB64, payloadB64, signatureB64] = parts;

    const header = decodeJwtPart<{ alg: string; kid?: string }>(headerB64);
    if (header.alg !== "ES256") return "free";

    // Standard ES256: raw r||s signature (ieee-p1363), not DER.
    const signatureValid = cryptoVerify(
      "sha256",
      Buffer.from(`${headerB64}.${payloadB64}`),
      { key: publicKeyPem, dsaEncoding: "ieee-p1363" },
      base64UrlDecode(signatureB64)
    );
    if (!signatureValid) return "free";

    const claims = decodeJwtPart<KeyClaims>(payloadB64);
    if (claims.iss !== "kira.sh") return "free";
    if (claims.exp < Date.now() / 1000) return "free";
    if (claims.tier === "pro") return "pro";
    if (claims.tier === "contributor") return "contributor";
    return "free";
  } catch {
    return "free";
  }
}

/**
 * Verify a Kira key (KIRA_KEY / KIRA_PRO_KEY) and return the effective tier.
 * Name kept from the pro-only era for call-site compatibility.
 */
export function verifyProKey(key: string | undefined): KiraTier {
  if (!key) return "free";
  try {
    const parts = key.split(".");
    if (parts.length !== 3) return "free";
    const header = decodeJwtPart<{ alg: string; kid?: string }>(parts[0]!);
    const kid = header.kid ?? "kira-pro-v1";
    return verifyKeyWithPem(key, PUBLIC_KEYS[kid]);
  } catch {
    return "free";
  }
}
