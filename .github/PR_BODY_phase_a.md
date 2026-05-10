# Phase A: privacy-first telemetry + Cloudflare Worker backend

## Why

Kira is built on a flywheel: agents apply Skills → report outcomes → the data
flows back to improve the index. The flywheel only spins if **users trust the
pipe enough to leave it on**. Until this PR, `kira_report` wrote to a local
file and stopped — there was no transport, no consent layer, no sanitization.

Adding "post to a server" is the easy part. The hard part is convincing the
person reading this PR that we will not leak their secrets, paths, or project
names if they enable it.

This PR ships the easy part *and* the hard part.

## What landed

**Client (`src/`)**
- `sanitize.ts` — pure-function, dependency-free, idempotent. Redacts OpenAI/Stripe/GitHub/Slack tokens, JWTs, AWS access keys, long hex, emails, IPs, UUIDs, home/Windows/deep POSIX paths, and `KEY=value` assignments. Length caps applied first.
- `types.ts` — `ReportPayloadV1` (anonymous core + optional detail), `ReportLogEntry`, `ConsentState`.
- `consent.ts` — `~/.kira/consent.json` state, `KIRA_TELEMETRY` env override, regenerates the anonymous UUID on opt-out so re-opting-in starts a new identity.
- `telemetry.ts` — local-first NDJSON log, batch flush every 20 entries OR 5 minutes, exponential backoff (1/5/25 min), 4xx drop, 5xx retry, gzip body >1KB, SIGTERM best-effort flush.
- `tools/kira_consent.ts` — new MCP tool: `{level: "off"|"basic"|"full"}`.
- `report.ts` + `server.ts` — wired into the existing `kira_report` flow. First call returns a one-time `consent_notice` describing what is sent and how to opt out.

**Worker (`worker/`)**
- `POST /v1/reports` — zod schema → re-runs sanitizer → D1 batch insert → `202 {accepted: n}`. Defense-in-depth re-sanitization is asserted by tests.
- `GET /v1/stats/:skill_id` — 30-day aggregate counts only, 5-minute Cloudflare cache, never returns raw notes.
- D1 schema with skill+ts and client+ts indexes, `ip_hash = SHA-256(ip ‖ daily_salt ‖ utc-date)` dropped after 24 h, raw rows deleted after 180 days via `crons` trigger.

**Tests (vitest, 46 cases)**
- `sanitize.test.ts` — fixture-driven redaction (16 patterns, positive + negative), idempotency, length cap.
- `schema.test.ts` — zod accepts/rejects.
- `consent.test.ts` — first-run defaults to `basic`, env overrides without persisting, opt-out regenerates UUID, corrupt file falls back, `kira_consent` tool round-trips.
- `telemetry.test.ts` — `off` writes locally but never queues, `basic` queues without `detail`, `full` queues with sanitized `detail`, 5xx retries / 4xx drops.
- `worker/tests/worker.test.ts` (`@cloudflare/vitest-pool-workers`) — valid POST inserts, malformed JSON 400, oversize batch 400, **server re-sanitizes a planted secret**, stats endpoint, unknown route 404.

**Docs**
- `PRIVACY.md` (new) — wire format examples (basic + full), redaction table, before/after, retention, three opt-out mechanisms, contact.
- `README.md` — Telemetry section + env var table.
- `CONTRIBUTING.md` — guidance for editing the sanitizer pair.

## See it in action

```bash
npm install && npm run demo:privacy
```

prints colored before/after for OpenAI keys, GitHub tokens, JWTs, paths, IPs,
emails — so anyone reviewing this PR (or thinking about installing) can verify
the redaction without trusting the README.

```text
OpenAI API key
  before: deploy failed; OPENAI_KEY=sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ012345 broke
  after:  deploy failed; OPENAI_KEY=[REDACTED] broke

GitHub token + home path
  before: wrangler login error in /home/alice/projects/my-app with ghp_abcdefghijklmnopqrstuvwxyz0123456789
  after:  wrangler login error in /[USER]/projects/my-app with [REDACTED]
```

## Verification

```bash
# Client
npm install
npm run build           # tsc clean
npm test                # 40/40
npm run demo            # full skill index loads
npm run demo:privacy    # color before/after

# Worker (uses miniflare in-memory D1, no CF account needed)
cd worker && npm install && npm test    # 6/6

# End-to-end with a planted secret
KIRA_TELEMETRY=full node -e "
  import('./dist/report.js').then(({record}) => record({
    skill_id: 'community.test.v1',
    status: 'retry',
    note: 'sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ012345 in /home/alice/proj at 192.168.1.42'
  }, 'free').then(r => console.log(r)));
"
tail -1 ~/.kira/reports.log | jq .detail
# → { "note": "[REDACTED] in /[USER]/proj at [IP]" }
```

## Out of scope (deferred to later phases)

- **Phase B** — HMAC-signed reports, per-`client_id` rate limit, replay protection, abuse heuristics.
- **Phase C** — `author` + `signature` fields on Skill JSON, publisher branching when community-improved variants land.
- **Phase D** — failure-cluster mining from `events` → new Scar candidates pipeline.

Each is a discrete PR; this one keeps the scope at "open the pipe, but only with consent and sanitization in place."

## File-by-file

**Add**: `src/sanitize.ts`, `src/consent.ts`, `src/telemetry.ts`, `src/tools/kira_consent.ts`, `src/demo-redaction.ts`, `tests/*` (4 files + fixtures), `vitest.config.ts`, `worker/` (entire directory), `PRIVACY.md`.

**Modify**: `src/types.ts`, `src/report.ts`, `src/server.ts`, `package.json`, `README.md`, `CONTRIBUTING.md`, `.gitignore`.

**Leave alone**: `src/index-loader.ts`, `src/license.ts`, all existing skill/scar JSON.

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)
