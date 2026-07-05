# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.7.0] - 2026-07-06

### Added
- `kira_record_failure` (F1) — capture a retry/exception as a **personal scar**: private, local-only failure memory under `~/.kira/personal-scars/` (#138).
- `kira_premortem` (F3) — failure heat-map for a goal before the agent starts, ranked by past scar hits (#139).
- `kira_personal_brief` (F2) — SessionStart "magic moment": your most recent personal scars by recency, with a ready-to-print headline (#146).
- **Personal scar recall — the loop is closed.** Scars recorded by `kira_record_failure` now fire everywhere: `kira_lookup` (before shared scars at equal severity), `kira_premortem` heat maps, `kira_get` by id, and `kira_status` counts (`counts.personal_scars`). Recording was write-only before this release.
- `kira_premortem` returns scored `near_scars` when nothing matches strictly — vocabulary mismatch no longer yields a bare "proceed".
- `npm run bench` — lookup/route micro-benchmarks with a regression budget (#143).
- CJK bigram tokenization in `similarity.ts` — Japanese queries now reach near-match scoring and miss clustering (#144).

### Changed
- README repositioned around the personal-scar loop ("your agent stops repeating its own mistakes"); demo tape rewritten with the real first-scar story.
- Re-recording a near-duplicate failure (token-Jaccard ≥ 0.45 over title+mistake) folds into the existing personal scar: `hit_count` counts real recurrences, keywords/contexts union, the newest fix wins, severity escalates to critical. Previously a reworded recurrence created a fresh file and `hit_count` never grew.
- Honest premortem framing: `hit_count` is described as *recorded* (curated seed counts for the shipped corpus, actual local recurrences for personal scars) — renamed `total_historical_failures` → `total_recorded_failures` and `network_minutes_saved` → `recorded_minutes_saved`.
- Flywheel clustering assigns entries to the *most* similar cluster (best-fit) instead of the first past the threshold; the digest is stamped with the local calendar date instead of UTC.

### Fixed
- `logMiss` sanitizes context tags like the keyword — miss-log content can flow into public PR candidates.
- MCP server metadata no longer reports a hardcoded version 0.4.0; it reads package.json.

## [0.6.0] - 2026-07-06

### Added
- **MCP tool annotations** on all six tools (`kira_lookup`, `kira_route`, `kira_get`, `kira_report`, `kira_consent`, `kira_status`) — `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`. Follows the recent Anthropic post on Tool Annotations as Risk Vocabulary; clients can now skip confirmation prompts for the read-only tools and reserve them for the actual mutators.
- **MCP Server Card** at `/.well-known/mcp/server-card.json` (and the legacy `/.well-known/mcp-server-card.json` path) per draft SEP-2127. Includes identity, npm package descriptor, full tool surface with annotations, and a `_meta` block describing the privacy posture (sanitizer summary, retention windows). Cached 10 minutes at the edge.
- `kira_status` MCP tool — single-call introspection of version, tier, consent level, and the counts of loaded skills/scars/routes.
- GitHub Actions CI: client build + tests + skill/scar/route JSON validation, worker tests, and a smoke job that asserts `npm run demo:privacy` redacts every expected pattern. `NO_COLOR=1` honored end-to-end so CI captures plain text.
- README badges (CI status, npm version, npm weekly downloads, license) and a `<details>` block under "Install" with per-client config paths (Claude Code/Desktop, Cursor, Cline, Windsurf, VS Code, Goose, Zed).
- MCP Registry publish prep: `"mcpName": "io.github.aibenyclaude-coder/kira"` in `package.json`, `server.json` at the repo root against the 2025-12-11 schema, and `scripts/registry-publish.md` documenting the `mcp-publisher` flow.
- Maintainer scripts under `scripts/` (`kira-intel.sh` + `kira-intel-issues.py`) for nightly Ollama-powered intel digests and idempotent `needs-skill` issue creation. Excluded from the npm package.
- **Personal-first flywheel** (#137) — near-match detection via `src/similarity.ts`, lookup-miss telemetry, and a local improvement loop that turns repeated misses into skill candidates. Documented in `FLYWHEEL.md`.
- `KiraError` taxonomy + JSON error envelope for invalid tool inputs (#132).
- Structured stderr logger with `KIRA_LOG_LEVEL` and redact-on-log (#134).
- `npm run stats` — local-only, redaction-verified report summary CLI (#142).
- Public type entrypoint `kira-mcp/types` re-exporting `Skill` / `Scar` / `Route` types (#136).
- `examples/` with runnable MCP client configs for Claude Code / Cursor / Continue (#133).
- `TROUBLESHOOTING.md` — top 10 install issues + remediation (#141).
- Registry submission metadata for Glama / OpenTools / mcp.so (#135).
- Tests: property-based fuzz suite for the `kira_lookup` matcher (#131) and in-proc stdio integration tests for all server request handlers (#140).

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

[Unreleased]: https://github.com/aibenyclaude-coder/Kira/compare/v0.7.0...HEAD
[0.7.0]: https://github.com/aibenyclaude-coder/Kira/releases/tag/v0.7.0
[0.6.0]: https://github.com/aibenyclaude-coder/Kira/releases/tag/v0.6.0
[0.5.0]: https://github.com/aibenyclaude-coder/Kira/releases/tag/v0.5.0
[0.4.1]: https://github.com/aibenyclaude-coder/Kira/releases/tag/v0.4.1
[0.4.0]: https://github.com/aibenyclaude-coder/Kira/releases/tag/v0.4.0
