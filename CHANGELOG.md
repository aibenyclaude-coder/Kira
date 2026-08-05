# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.11.0] - 2026-08-06

### Added
- **`kira_personal_brief` now asks.** Recording a failure is automatic and sharing it is one call away, but nothing ever prompted — so a personal store grows to hundreds while the shared catalog stays the size of what one maintainer remembered to promote. The brief now names up to 3 of your own scars that would also fire on someone else's machine, says why each one, and hands you the exact `kira_share_scar(...)` call. It is a suggestion: nothing is uploaded, and the reasoning is returned so you can disagree on the spot.

  The filter is deliberately narrow. Naming a public surface (npm, git, ffmpeg, …) is necessary but nowhere near sufficient — measured over 196 real personal scars, 150 of them mention some public tool, and "share 150 scars" is the same silence with extra steps. A candidate also has to carry weight the author already recorded: `severity: "critical"`, or `hit_count > 1` (it recurred, so the lesson demonstrably does not stick on its own). That takes 196 → 31. Anything naming a path, a private host, or "this machine" is excluded outright, whatever its severity.
- **A local ledger of prepared submissions** (`~/.kira/shared-prepared.json`). `kira_share_scar` uploads nothing by design, so acceptance is not observable from this machine — which left the prompt with no memory and made it re-suggest its own strongest candidate in every future session, permanently occupying a slot. The ledger records the one fact that *is* observable: a submission was prepared, and when. A corrupt or missing ledger reads as empty rather than throwing.

### Fixed
- A JavaScript `\b` next to a CJK character never matches, so the private-marker check silently never fired on Japanese text — "うちの本番機だけで再現する" was judged shareable. Caught by the test that feeds it exactly that.

## [0.10.0] - 2026-08-06

### Added
- **Task tags.** Skills and scars carry an optional `tasks` field naming the activity they fire before — `release`, `deploy`, `code-review`, `debug`, `test`, `setup`, `automation`, `packaging`, `git-workflow`, `media-processing`, `browser-automation`, `dependency-upgrade`, `data-migration`. All 45 shipped scars are tagged.
- **Naming an activity returns its whole bundle.** `kira_lookup("release")` now answers with every scar that fires during a release, not the few whose keywords happen to overlap the word. Aliases cover Japanese (`リリース`, `デプロイ`, `移行`), and ASCII aliases match on word boundaries so `test` fires on "run the test" but not on `testsrc` or `@latest`.

  Measured on the shipped corpus against scars actually needed while performing each task on this repo: **5/17 → 16/17**. `"release"` went 1→4 of 5; `"code review"` went 0→3 of 3. The knowledge was already present — the activity name was simply not a way to reach it.

### Changed
- The MCP `initialize` instructions are written as situation → action rather than as a tool manual. A manual explains how to call the tools once the agent has decided to; deciding to look is the step that gets skipped. The triggers now name the moments — starting a named activity, doing something hard to undo, returning to an area that has burned someone, acting on an unverified guess — and point at recording and sharing afterwards.

### Fixed
- The task bundle is appended, never interleaved, so an existing caller's results stay a **prefix** of the new ones. Found by the personal-scar recall test: `kira_premortem` re-ranks and truncates to `top_k`, so merging the bundle by severity let a shipped critical evict the caller's own recorded failure — the one thing personal recall exists to prevent. Callers that truncate pass `tasks: false`; `kira_premortem` now does.

## [0.9.0] - 2026-08-06

The corpus grew by 18 scars, but the larger change is that the corpus now actually
reaches the agent: two thirds of this release is retrieval and sanitizer correctness.
Measured against real query logs, the retrieval fixes turn previously **empty**
responses into hits without losing a single existing match.

### Added
- 18 community scars harvested from real failures since 0.8.2. Corpus: **38 skills / 45 scars** (was 38 / 27).
  - Web platform and browser tooling: `backdrop-filter` fixed containing block, Cloudflare Pages soft-404 without `404.html`, chrome-devtools MCP serving stale CSS, Cloudflare quick-scan importing edge IPs, DNS-cutover misdiagnosed as a deploy failure, quoted-printable link corruption over email MCP, browsermcp following the last connected tab, `xdotool type` garbled by an active IME (#177, #178, #179, #193).
  - Agent execution discipline: `gh` table output parsed by column index, a threshold tuned to a single example, scheduled automation created without a layer inventory, a health check gated on an unverified command, multi-ref `git push --delete` partial success, rebasing a conflicting PR branch committing you to a force-push, a lead naming a branch no shipped input reaches, a green test suite pinning the bug in place (#175, #180, #182, #185, #190).
  - Packaging and investigation: a new asset directory missing from the ship manifest, and a hand-written fixture whose granularity does not match the real model output (#229).
- `kira_record_failure` now reports when its scar was folded into an existing one, and what the sanitizer rewrote, so the caller can re-record instead of silently losing the text (#203, #223).
- Route misses are logged, so the flywheel can see route gaps the same way it sees skill gaps (#191).

### Fixed
- **Retrieval.** A lexical scar hit no longer suppresses a closer near-scar (#228). A mixed-script query is scored only on the script the item can actually match, so a Japanese query no longer sinks a scar that documents the exact trap (#227). Tier-3 overlap counts distinct words and tokenizes the way tier 2 does; two halves of one identifier no longer count as an overlap (#219, #220, #221). Tier-2 keywords match at word boundaries rather than as raw substrings (#184). Past tense folds in the stemmer, so a scar's own title retrieves it (#224). A compound context tag matches on the words it is built from, and the context filter applies only where the requested tags discriminate (#225, #226). Strong near-scars surface when a skill matched but no scar did (#183). `kira_route` merges personal scars like `kira_lookup` and `kira_premortem` already did, picks a route by match quality rather than `readdir` order, and settles a tie by id (#186, #187, #189).
- **Sanitizer.** Systemd template units are no longer read as email addresses, package specs are no longer eaten by the email redactor, shell expansions inside key/value spans are no longer redacted, and env values carrying no credential material are left alone. The two pattern lists are now compared entry by entry (#209, #211, #216, #217, #218).
- **Dedup.** Personal-scar dedup is scored per field so a verbose recurrence still folds, and cross-script comparison no longer produces false folds or overwrites the `instead` of the scar it merged into (#181, #195, #188, #192).
- `kira_premortem` no longer ranks a warning above a critical (#208). `kira_share_scar` no longer publishes a fix its author had already replaced (#207). `kira_status` no longer reports a consent path that does not exist (#213). A missing keyword or goal is rejected instead of answered as the empty string (#215). `KIRA_LOG_LEVEL` and redact-on-log now actually govern stderr (#214). Community scar candidates get a collision-free id (#204). The caller is told when a tool call's parameters arrived glued together (#210).
- Flywheel Loop B can cluster real demand again (0 candidates in 3 of 3 weekly runs before the fix), and the digest no longer blames a flag that is never the cause (#205, #206).
- Removed an aggregation pipeline that read a path nothing writes (#212).

### Changed
- CI gates the corpus counts advertised in `README.md` and the launch objections doc against the corpus itself — the npm page had been claiming 12 scars while shipping 27 (#202, #222).
- CI gates `server.json` against `package.json` on every push, not at tag time. A stale second manifest had half-released v0.8.2: npm published, the MCP registry rejected it as a duplicate version, and the registry served 0.8.1 for 15 days with every dashboard green (#201).

### Security
- `npm audit` cleared to 0 across five advisory waves: body-parser, `@hono/node-server`, fast-uri, sharp, and the worker toolchain (#196, #197, #198, #199, #200). Cleared again for this release — fast-uri 3.1.5 (host confusion), hono 4.13.0 (CORS ReDoS), and ip-address 10.4.0 (leading-zero octet SSRF), all transitive through `@modelcontextprotocol/sdk`. Resolved versions verified out of the advisory ranges rather than trusting the bump.

## [0.8.2] - 2026-07-09

### Added
- 7 community scars harvested from real failures since 0.8.1: the parallel-rails release race (#164), 3 web-platform traps from the bbutton-site quality loop (#172), and 3 ffmpeg pitfalls — crop w/h expressions evaluate once, animated-testsrc frame-diff false positives, infinite lavfi source + output-side `-t` hang (#173). Corpus: **38 skills / 27 scars**.
- Multi-stage `Dockerfile` (node:22-alpine) + CI docker handshake gate: the image must start and answer `tools/list` with all 10 tools on every commit (#170).
- `SECURITY.md` (corpus-injection threat model), bug report form, and private vulnerability reporting (#165).
- `glama.json` for Glama profile completion (#171).

### Changed
- Registry publish rail waits for npm availability before validating — fixes the parallel-rails race it now ships a scar about (#164).
- Worker deploy rail materializes the D1 database id from a repo secret; placeholder de-landmined (#166).
- Docs: positioning vs memory servers + launch-day objection prep (#167); install guidance pins `npx kira-mcp@latest` with stale-cache troubleshooting (#166).

## [0.8.1] - 2026-07-06

### Added
- 5 community scars and 4 process skills harvested from this repo's own release night: piped-gate, push-race, write-without-read, merge-compile-gate, UTC-misread, npm-404-is-auth, nested-package-install, credential-CI three gates (v1.0.1), plus `cut-a-release`, `delegate-to-subagents`, `npm-trusted-publishing` and `mcp-registry-publish` skills. Corpus: **38 skills / 20 scars**.
- Listed in the official **MCP Server Registry** (`io.github.aibenyclaude-coder/kira`) via a new OIDC publish rail — PulseMCP/Smithery ingest automatically.

### Changed
- README: tools table 9→10, fresh v0.8.0-story demo.gif, npm search keywords; USAGE.md documents the personal failure loop and drops a leftover fabricated figure; examples/TROUBLESHOOTING say ten tools.
- Release rails hardened: ref gates, tag-ancestry checks, pinned + checksum-verified toolchains in every credential-holding job.


## [0.8.0] - 2026-07-06

### Added
- `kira_share_scar` (F4 v1, 10th tool) — promote a personal scar into a community submission: re-sanitizes, generalizes to the community shape, and returns a prefilled GitHub issue URL + `gh` fallback. The tool uploads NOTHING; submitting stays an explicit human act.
- Scar submission intake: issue form (`scar-submission.yml`), an intake bot that validates submissions with the exact rules the shipped corpus passes (`scripts/validate-entry.mjs` + sanitizer no-op gate), and auto-labeling (`valid-scar` / `invalid-scar`).
- Corpus quality gate in CI: every shipped skill/scar must pass the submission validator (`tests/corpus-lint.test.ts`) — the poisoning/leak defense for text that gets injected into agents' contexts.
- "scars absorbed" README badge backed by `docs/stats.json` (deterministic; CI fails if stale so the badge can never lie).
- **Reciprocity (F5): share a scar, or subscribe, or wait.** New `contributor` tier (earned: one accepted scar = a signed key), `KIRA_KEY` env (legacy `KIRA_PRO_KEY` still honored), and a tier-gated corpus feed: `GET /v1/corpus/{skills,scars}.json` on the worker serves the fresh feed to contributor/supporter keys and the 90-day-delayed commons to everyone else. Free tier stays zero-phone-home by default (opt-in via `KIRA_REMOTE_URL`). Enforcement starts in grace mode — see `RECIPROCITY.md`.
- `scripts/sign-key.mjs` (maintainer key issuance, private key via env only) and `scripts/gen-corpus.mjs` (deterministic `docs/corpus.json` bundle the feed serves; CI-freshness-checked).

### Changed
- Key verification standardized on proper ES256 (raw ieee-p1363 signatures) in both the client (`src/license.ts`) and the worker (WebCrypto). Pre-standard DER-signed keys — none were ever issued — would no longer verify.
- Telemetry wire format unchanged: `contributor` reports as `free` on the wire (earned status is a distribution entitlement, not a telemetry class).

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

[Unreleased]: https://github.com/aibenyclaude-coder/Kira/compare/v0.11.0...HEAD
[0.11.0]: https://github.com/aibenyclaude-coder/Kira/releases/tag/v0.11.0
[0.10.0]: https://github.com/aibenyclaude-coder/Kira/releases/tag/v0.10.0
[0.9.0]: https://github.com/aibenyclaude-coder/Kira/releases/tag/v0.9.0
[0.8.2]: https://github.com/aibenyclaude-coder/Kira/releases/tag/v0.8.2
[0.8.1]: https://github.com/aibenyclaude-coder/Kira/releases/tag/v0.8.1
[0.8.0]: https://github.com/aibenyclaude-coder/Kira/releases/tag/v0.8.0
[0.7.0]: https://github.com/aibenyclaude-coder/Kira/releases/tag/v0.7.0
[0.6.0]: https://github.com/aibenyclaude-coder/Kira/releases/tag/v0.6.0
[0.5.0]: https://github.com/aibenyclaude-coder/Kira/releases/tag/v0.5.0
[0.4.1]: https://github.com/aibenyclaude-coder/Kira/releases/tag/v0.4.1
[0.4.0]: https://github.com/aibenyclaude-coder/Kira/releases/tag/v0.4.0
