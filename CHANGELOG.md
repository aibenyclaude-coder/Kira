# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.6.0] - 2026-05-11

### Added
- **MCP tool annotations** on all six tools (`kira_lookup`, `kira_route`, `kira_get`, `kira_report`, `kira_consent`, `kira_status`) — `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`. Follows the recent Anthropic post on Tool Annotations as Risk Vocabulary; clients can now skip confirmation prompts for the read-only tools and reserve them for the actual mutators.
- **MCP Server Card** at `/.well-known/mcp/server-card.json` (and the legacy `/.well-known/mcp-server-card.json` path) per draft SEP-2127. Includes identity, npm package descriptor, full tool surface with annotations, and a `_meta` block describing the privacy posture (sanitizer summary, retention windows). Cached 10 minutes at the edge.
- `kira_status` MCP tool — single-call introspection of version, tier, consent level, and the counts of loaded skills/scars/routes.
- GitHub Actions CI: client build + tests + skill/scar/route JSON validation, worker tests, and a smoke job that asserts `npm run demo:privacy` redacts every expected pattern. `NO_COLOR=1` honored end-to-end so CI captures plain text.
- README badges (CI status, npm version, npm weekly downloads, license) and a `<details>` block under "Install" with per-client config paths (Claude Code/Desktop, Cursor, Cline, Windsurf, VS Code, Goose, Zed).
- MCP Registry publish prep: `"mcpName": "io.github.aibenyclaude-coder/kira"` in `package.json`, `server.json` at the repo root against the 2025-12-11 schema, and `scripts/registry-publish.md` documenting the `mcp-publisher` flow.
- Maintainer scripts under `scripts/` (`kira-intel.sh` + `kira-intel-issues.py`) for nightly Ollama-powered intel digests and idempotent `needs-skill` issue creation. Excluded from the npm package.

## [0.5.0] - 2026-05-10

### Added — Phase A: privacy-first telemetry + Cloudflare Worker backend
- `ReportPayloadV1` wire schema: anonymous core (skill_id, status, anonymous client_id, kira version, OS family, Node major, tier) plus an optional `detail` layer that carries free-text `note`/`context` only when consent is `full`.
- `src/sanitize.ts` — pure-function, dependency-free, idempotent sanitizer that redacts OpenAI/Stripe/GitHub/Slack tokens, JWTs, AWS access keys, long hex, emails, IPs, UUIDs, home/Windows/POSIX paths, and `KEY=value` assignments. Length-capped at 500/2000 before regex passes.
- `src/consent.ts` — `~/.kira/consent.json` state with `KIRA_TELEMETRY` env override, defaults to `basic` on first run, regenerates the anonymous client_id whenever the level transitions to `off`.
- `src/telemetry.ts` — local NDJSON log + 20-event/5-min batch flush + 1/5/25-min exponential backoff for 5xx, drop on 4xx, gzip when body >1KB, best-effort flush on SIGTERM/SIGINT.
- `kira_consent` MCP tool — round-trips the level (`off`/`basic`/`full`).
- `npm run demo:privacy` — colorized before/after for every redaction pattern.
- Cloudflare Worker (`worker/`) — `POST /v1/reports` (zod-validated, server-side re-sanitization, D1 batch insert), `GET /v1/stats/:skill_id` (30-day aggregate, 5-min cache, no raw notes ever), daily retention cron (180-day raw events, 24-h `ip_hash` lifetime, daily salt rotation).
- Vitest suite — 40 client cases (sanitizer fixtures, schema accept/reject, consent state machine, telemetry queue) and 6 worker cases (`@cloudflare/vitest-pool-workers` against in-memory D1).
- `PRIVACY.md` — full wire-format examples, redaction reference, retention windows, three opt-out paths (`KIRA_TELEMETRY=off`, `kira_consent`, delete `~/.kira/consent.json`).
- `CONTRIBUTING.md` rules for editing the sanitizer pair (client + worker copies must move together; fixtures must use placeholder shapes).

### Changed
- `kira_report` now accepts an optional `context` field in addition to `note`. Both pass through the sanitizer regardless of consent level (so the local log stays redacted), and travel over the wire only when consent is `full`.
- `package.json` adds `zod` plus dev deps `vitest` / `@vitest/coverage-v8` / `@cloudflare/vitest-pool-workers`.

### Security
- Anonymous-by-default: skill ID and status leave the machine, but free text never does without explicit opt-in.
- Defense in depth: identical sanitizer patterns run on the client before write/send and on the worker before insert. A planted secret has to bypass two independent regex passes.

## [0.4.1] - 2026-04-XX
- Hotfix release. See git history for details.

## [0.4.0] - 2026-04-XX
- Initial public release with 31 skills, 12 scars, 7 routes, and three core MCP tools (`kira_lookup`, `kira_route`, `kira_report`).

[Unreleased]: https://github.com/aibenyclaude-coder/Kira/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/aibenyclaude-coder/Kira/releases/tag/v0.6.0
[0.5.0]: https://github.com/aibenyclaude-coder/Kira/releases/tag/v0.5.0
[0.4.1]: https://github.com/aibenyclaude-coder/Kira/releases/tag/v0.4.1
[0.4.0]: https://github.com/aibenyclaude-coder/Kira/releases/tag/v0.4.0
