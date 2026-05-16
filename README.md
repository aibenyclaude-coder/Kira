# Kira

[![CI](https://github.com/aibenyclaude-coder/Kira/actions/workflows/ci.yml/badge.svg)](https://github.com/aibenyclaude-coder/Kira/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/kira-mcp.svg)](https://www.npmjs.com/package/kira-mcp)
[![npm downloads](https://img.shields.io/npm/dw/kira-mcp.svg)](https://www.npmjs.com/package/kira-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

### Stop your AI from making the same mistake twice.

**The failure database for AI agents.**

Right now, AI agents around the world are independently making the same mistakes — `auth.js v5` server/client import swap, `Clerk` middleware in the wrong directory, `Stripe` webhook signed against a parsed body, missing `'use client'` for hooks. No one records these failures. Every agent rediscovers every bug.

Kira is a neutral third-party layer that captures those failure patterns — **Scars** — and gives every AI agent a vaccination card before it works on your project.

> **Privacy by design.** Personal scars never leave your machine unless you explicitly promote them. Public scars go through a sanitizer that redacts secrets, paths, IPs, and identifiers — locally before write, and again server-side before storage. Run `npm run demo:privacy` to see exactly what leaves your machine. Full wire format and opt-out in [PRIVACY.md](./PRIVACY.md).

---

## Install (10 seconds)

Add this snippet to your MCP host config:

```json
{
  "mcpServers": {
    "kira": {
      "command": "npx",
      "args": ["kira-mcp"]
    }
  }
}
```

That's it. Your agent now has Kira.

<details>
<summary><b>Per-client paths (click)</b></summary>

| Client | Config file |
|---|---|
| **Claude Code** | `~/.claude/settings.json` (global) or `.claude/settings.json` (per-project) |
| **Claude Desktop** | macOS: `~/Library/Application Support/Claude/claude_desktop_config.json` · Windows: `%APPDATA%\Claude\claude_desktop_config.json` |
| **Cursor** | `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (per-project) |
| **Cline / Continue** | extension settings → MCP servers |
| **Windsurf** | `~/.codeium/windsurf/mcp_config.json` |
| **VS Code (MCP preview)** | `.vscode/mcp.json` |
| **Goose** | `~/.config/goose/profiles.yaml` (under `extensions:`) |
| **Zed** | `~/.config/zed/settings.json` (`context_servers`) |

The snippet above works as-is in every one of them — just paste it under `mcpServers` (or the equivalent key for your client).
</details>

---

## What you'll see

Open a Next.js + Auth.js + Stripe project. New session. The agent's first message:

> **Kira brief — 3 known failures for this project type**
>
> 1. **Auth.js v5 signIn/signOut fails because server and client imports are swapped** (critical)
> 2. **Clerk middleware placed in wrong directory — auth silently does nothing** (critical)
> 3. **Next.js App Router component uses Client Hooks without 'use client'** (critical)
>
> _I'll keep these in mind as I work._

That's three retries you don't pay for. Three Slack pings you don't have to send. Three commits that don't need a "fix:" prefix.

---

## Why Scars, not Skills?

Skills (how to do something) are being commoditized fast — Anthropic Skills, OpenAI Skills, and the emerging `SKILL.md` standard mean platform vendors will ship the canonical "how-to" set within their own ecosystems. Third-party skill catalogs get absorbed.

Scars (where things actually break) are different:

- **Vendors can't publish their own failure patterns.** Stripe won't write "here's how 847 agents break our webhooks." Their position prevents it.
- **Failures compound.** Every agent that hits a known scar adds to its hit_count. The same scar that helped 12 users yesterday helps 47 today. A neutral third-party is the only place this can accumulate.
- **Loss aversion beats novelty.** "Stop making this mistake" is a stronger promise than "Get smarter." Humans share regret faster than discovery.

Kira is building the failure pattern database. Skills are the recovery paths attached to each scar. Inverted on purpose.

---

## How it works

| Tool | What it does | Read or write |
|---|---|---|
| `kira_lookup(keyword, context)` | Find scars + skills matching the current task | read |
| `kira_route(goal)` | Get an ordered plan with the scars and skills for each step | read |
| `kira_get(id)` | Fetch a specific scar or skill in full | read |
| `kira_report(skill_id, status, note)` | Tell Kira whether a skill worked, so the system learns | write |
| `kira_consent(level)` | Toggle telemetry (`off` / `basic` / `full`) | write |
| `kira_status()` | Single-call introspection (version / tier / consent / counts) | read |

### Auto-firing

You don't call Kira. **Kira tells your agent to call it** via the MCP `instructions` field. The agent looks up scars before starting any task. You literally do nothing.

---

## What's inside (today)

**12 Scars** — `auth.js` server/client mixup, `Clerk` middleware path, missing `'use client'`, `Stripe` webhook parsed body, `Prisma` stale generate, `Vercel` env var loss, `Supabase` RLS not enabled, `Tailwind v4` PostCSS config, `Vitest` path alias desync, `Drizzle` SQLite vs Postgres dialect, `Docker` no multi-stage build, `Next.js` middleware path.

**34 Skills** as recovery paths attached to scars — Deploy, Database, Auth, Payments, UI, Testing, CI/CD, Infra, Services, Mobile, i18n.

**8 Routes** that thread scars and skills into ordered plans — web-app-nextjs, deploy-production, add-auth, api-stripe, setup-dev-environment, and more.

Scars grow whenever an agent hits a known failure. Skills grow when contributors write a recovery path for a documented scar. The shape: **failures first, fixes second.**

---

## Privacy

- Personal scars stay in `~/.kira/personal-scars/` — never sent anywhere by default.
- Public scars go through a regex-based sanitizer that redacts tokens, JWTs, AWS keys, hex strings, emails, IPs, UUIDs, file paths, and `KEY=value` assignments before leaving your machine. Server-side, the worker re-sanitizes on ingest.
- All free-text (`note`, `context`) is dropped unless you set `kira_consent("full")`.
- Three opt-out paths: `KIRA_TELEMETRY=off`, `kira_consent("off")`, or delete `~/.kira/consent.json`.
- Full wire format examples and retention windows in [PRIVACY.md](./PRIVACY.md).

---

## Roadmap

| Status | Feature |
|---|---|
| done | Skills + Scars + Routes with auto-firing |
| done | Privacy-first telemetry (Phase A) — sanitizer, consent, Cloudflare Worker ingest |
| done | MCP tool annotations + MCP Server Card |
| in-progress | `kira_record_failure` — auto-capture retries as personal scars (no manual report needed) |
| in-progress | `kira_personal_brief` — surface "last session's failures" at start of new session |
| in-progress | `kira_premortem(goal)` — heat map of past failure patterns before a task starts |
| in-progress | Personal-scar → public-scar opt-in promotion flow (3+ hits → "share this?") |
| in-progress | `kira_digest` — end-of-session report of scars consulted + estimated minutes saved |
| planned | Phase B — HMAC signing, rate limit, replay protection on Worker |
| planned | Distributed alarm + reward loop (DESIGN.md §4) |

---

## Contributing

Scars are the highest-value contribution. If you've seen an AI agent fail in a reproducible pattern, write it up — even a one-paragraph description is enough to seed a scar.

See [CONTRIBUTING.md](./CONTRIBUTING.md). Early contributors get permanent Pro tier when paid features launch.

---

## Naming

**Kira** (輝) — Japanese root for *shine*. The tagline used to be *"Where agents shine."* The product turned out to be more about preventing the moments when they don't.

License: MIT.
