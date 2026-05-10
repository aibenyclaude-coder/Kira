# Announcement copy (drafts you can post)

Three lengths, three audiences. Use the one that fits.

---

## X / Twitter — short

> just shipped Kira v0.5: the MCP server that auto-fires Skills + Scars for
> AI agents now has **privacy-first telemetry**.
>
> sanitizer redacts API keys, paths, emails, IPs *before* the bytes leave
> your machine — and again on the worker, because trust requires
> defense-in-depth.
>
> `npm run demo:privacy` shows the before/after live.
>
> works with Claude Code, Cursor, Cline, Codex, anything that speaks MCP.
>
> github.com/aibenyclaude-coder/Kira

---

## Hacker News — title + first comment

**Title:** Show HN: Kira – privacy-first MCP server with auto-redacting telemetry

**First comment:**

> Author here. Kira is an MCP server that auto-fires Skills (how to do X)
> and Scars (failures other agents already hit) so coding agents stop
> retrying the same mistakes.
>
> The interesting part of this release is the telemetry layer. The flywheel
> only works if users leave it on, and they only leave it on if they trust
> what's on the wire. So:
>
> 1. Anonymous core (skill_id, status, anon UUID, version, OS family) is
>    the default; free-text `note`/`context` requires explicit opt-in via
>    a `kira_consent` MCP tool or `KIRA_TELEMETRY=full`.
> 2. A pure-function sanitizer redacts OpenAI/Stripe/GitHub/Slack tokens,
>    JWTs, AWS keys, long hex, emails, IPs, UUIDs, home/Windows/POSIX
>    paths, and `KEY=value` lines. Idempotent and tested with 16 fixture
>    patterns (positive + negative).
> 3. The same sanitizer runs server-side in the Cloudflare Worker before
>    D1 insert. Defense in depth: a planted secret has to bypass two
>    independent regex passes.
> 4. `npm run demo:privacy` shows colored before/after for every pattern,
>    so reviewers can verify without trusting README claims.
> 5. `ip_hash = SHA-256(ip ‖ daily_salt ‖ utc-date)` is kept 24h then
>    nullified; raw events expire after 180d.
>
> Full wire format and three opt-out paths in PRIVACY.md.
>
> Repo: https://github.com/aibenyclaude-coder/Kira
> PR: <link>
>
> Happy to dig into any of: schema design, sanitizer pattern set, why
> Worker+D1 over Vercel+Postgres, or the cold-start curation problem
> deferred to Phase D.

---

## Reddit r/LocalLLaMA / r/ClaudeAI / r/cursor — medium

**Title:** Kira MCP server now ships sanitized telemetry — see exactly what leaves your machine

> If you're running Claude Code, Cursor, Cline, or Codex via MCP, you
> probably know how brittle agents get when they redo the same mistakes
> across projects. Kira (open source, MIT) keeps a shared library of
> Skills and Scars and auto-fires the right one for each task.
>
> v0.5 adds a privacy-first telemetry layer:
>
> - Anonymous-by-default; free-text fields require opt-in
> - Sanitizer scrubs API keys, paths, IPs, emails BEFORE local write
> - Worker re-runs the sanitizer before storage (defense in depth)
> - 30-day aggregate stats are public per skill; raw notes never are
> - 180-day retention, 24h ip_hash lifetime, daily salt rotation
>
> The flywheel idea: agents that hit a wall (`status=retry/failure`)
> contribute back to the Scars catalog so the *next* agent skips that
> wall. Already 31 skills, 12 scars, 7 routes shipped.
>
> Run `npm run demo:privacy` to see the redaction in your terminal —
> takes 10 seconds.
>
> https://github.com/aibenyclaude-coder/Kira

---

## LinkedIn — long, professional tone

> **Shipping privacy-first telemetry to an open-source MCP server**
>
> AI coding agents are getting genuinely useful, but the gap between "demo
> impressive" and "production trustworthy" is widening, not closing. The
> failure mode isn't capability — it's that nobody wants to send their
> environment variables, file paths, or API keys to a third-party server,
> even by accident.
>
> Kira is an open-source MCP server that I've been building to solve a
> different problem (auto-firing reusable instructions and failure
> patterns for coding agents). This week I shipped the telemetry layer,
> and the design choices say a lot about what enterprise-readiness looks
> like for AI infrastructure:
>
> 1. **Tiered consent.** Anonymous skill/status pairs by default;
>    free-text fields require explicit opt-in via a tool call or env var.
> 2. **Defense in depth.** Sanitizer runs once on the client and again on
>    the receiving Worker. A planted secret would have to bypass two
>    independent regex passes to land in storage.
> 3. **Verifiability.** `npm run demo:privacy` prints colored before/after
>    for every redaction pattern. Reviewers don't have to trust the docs.
> 4. **Time-bounded retention.** 180-day raw events, 24-hour IP hash
>    lifetime, daily salt rotation.
>
> If you ship anything that ingests text from coding agents, the
> sanitizer pattern set in `src/sanitize.ts` is reusable under MIT.
>
> Repo: https://github.com/aibenyclaude-coder/Kira
