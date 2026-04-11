/**
 * Kira Pro license verification.
 *
 * JWT (ES256) verification using Node.js crypto — zero external dependencies.
 * Public key ships with npm package. Private key stays on the signing server.
 *
 * Invalid/expired/missing key → "free" tier (never an error).
 */
import { createVerify } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export type KiraTier = "free" | "pro";

interface ProClaims {
  sub: string;
  email: string;
  tier: "pro";
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

/**
 * Verify a KIRA_PRO_KEY JWT and return the effective tier.
 * Any failure → "free" (graceful degradation, never breaks the agent).
 */
export function verifyProKey(key: string | undefined): KiraTier {
  if (!key) return "free";

  try {
    const parts = key.split(".");
    if (parts.length !== 3) return "free";

    const [headerB64, payloadB64, signatureB64] = parts;

    // Decode header to find kid
    const header = decodeJwtPart<{ alg: string; kid?: string }>(headerB64);
    if (header.alg !== "ES256") return "free";

    const kid = header.kid ?? "kira-pro-v1";
    const publicKeyPem = PUBLIC_KEYS[kid];
    if (!publicKeyPem) return "free";

    // Verify signature
    const verifier = createVerify("SHA256");
    verifier.update(`${headerB64}.${payloadB64}`);
    const signatureValid = verifier.verify(
      publicKeyPem,
      base64UrlDecode(signatureB64)
    );
    if (!signatureValid) return "free";

    // Decode and validate claims
    const claims = decodeJwtPart<ProClaims>(payloadB64);
    if (claims.iss !== "kira.sh") return "free";
    if (claims.tier !== "pro") return "free";
    if (claims.exp < Date.now() / 1000) return "free";

    return "pro";
  } catch {
    return "free";
  }
}
