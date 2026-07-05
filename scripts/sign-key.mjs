/**
 * Issue a Kira key (contributor / pro) — maintainer tool.
 *
 * The private key NEVER enters the repo: pass its path via KIRA_SIGNING_KEY.
 * Signatures are standard ES256 (raw ieee-p1363), matching src/license.ts
 * and worker/src/corpus.ts verification.
 *
 * Usage:
 *   KIRA_SIGNING_KEY=~/secrets/kira-pro-v1.key.pem \
 *     node scripts/sign-key.mjs --tier contributor --sub <github-username> [--days 365] [--email x@y]
 *
 * Contributor issuance policy (RECIPROCITY.md): one accepted scar = 12
 * months; first 1,000 contributors get exp far-future (pass --days 36500).
 */
import { readFileSync } from "node:fs";
import { sign } from "node:crypto";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const tier = arg("tier");
const sub = arg("sub");
const days = Number(arg("days", "365"));
const email = arg("email", "");
const keyPath = process.env.KIRA_SIGNING_KEY;

if (!keyPath || !tier || !sub || !["contributor", "pro"].includes(tier)) {
  console.error(
    "usage: KIRA_SIGNING_KEY=<private.pem> node scripts/sign-key.mjs --tier contributor|pro --sub <id> [--days 365] [--email x@y]"
  );
  process.exit(1);
}

const privateKey = readFileSync(keyPath, "utf-8");
const now = Math.floor(Date.now() / 1000);
const claims = {
  sub,
  ...(email ? { email } : {}),
  tier,
  iss: "kira.sh",
  iat: now,
  exp: now + Math.floor(days * 86400),
};

const b64u = (b) => Buffer.from(b).toString("base64url");
const h = b64u(JSON.stringify({ alg: "ES256", kid: "kira-pro-v1" }));
const p = b64u(JSON.stringify(claims));
const sig = sign("sha256", Buffer.from(`${h}.${p}`), {
  key: privateKey,
  dsaEncoding: "ieee-p1363",
});

console.log(`${h}.${p}.${b64u(sig)}`);
console.error(
  `[sign-key] tier=${tier} sub=${sub} exp=${new Date(claims.exp * 1000).toISOString()}\n` +
    "[sign-key] Hand this to the user: export KIRA_KEY=<token> (env of their MCP server)."
);
