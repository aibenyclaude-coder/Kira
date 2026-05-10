# Kira Telemetry Worker

Cloudflare Worker that receives outcome reports from Kira MCP clients and exposes 30-day aggregate stats per skill.

## Routes

| Method | Path | Description |
|---|---|---|
| `POST` | `/v1/reports` | Ingest a batch (1–100) of `ReportPayloadV1`. Validates with zod, re-runs the sanitizer server-side, inserts into D1. Returns `202 {accepted: n}`. |
| `GET` | `/v1/stats/:skill_id` | 30-day aggregate counts. 5-minute Cloudflare Cache. No raw notes ever leave this endpoint. |
| `GET` | `/v1/health` | `{ok: true}`. |

## Deploy

Requires a Cloudflare account with Workers and D1 enabled.

```bash
# 1. Install
cd worker
npm install

# 2. Create the production D1 database — copy the printed database_id
#    into wrangler.toml.
npx wrangler d1 create kira-events-prod

# 3. Apply schema (remote)
npx wrangler d1 execute kira-events-prod --remote --file=migrations/0001_init.sql

# 4. Set the daily salt (rotate via Cloudflare dashboard later)
echo "<random hex string>" | npx wrangler secret put DAILY_SALT

# 5. Deploy
npx wrangler deploy
```

The `wrangler.toml` shipped here uses `kira-events-dev` and a placeholder
`database_id`. Replace both before deploying to production. Keep the dev
binding in `[env.dev]` if you want both environments side by side.

## Local development

```bash
# 1. Create the local D1 (one-time)
npx wrangler d1 create kira-events-dev

# 2. Apply schema locally
npm run migrate:local

# 3. Run the Worker
npm run dev
# → http://localhost:8787

# 4. Tail D1 contents
npx wrangler d1 execute kira-events-dev --local \
  --command="SELECT id, skill_id, status, note FROM events ORDER BY id DESC LIMIT 5"
```

Point the MCP server at the local Worker:

```bash
KIRA_TELEMETRY_URL=http://localhost:8787/v1/reports \
KIRA_TELEMETRY=full \
node ../dist/index.js
```

## Tests

```bash
npm test
```

Uses `@cloudflare/vitest-pool-workers` with an in-memory D1 — no Cloudflare account needed.

## Retention

The `[triggers] crons` entry runs daily at 03:17 UTC and:

- `DELETE`s rows whose `ts` is older than 180 days
- nullifies `ip_hash` on rows whose `ts` is older than 24 hours

`ip_hash` itself is `SHA-256(ip || daily_salt || utc-date)`. Rotating the salt every 24h means same-IP events on different days do not share the hash.
