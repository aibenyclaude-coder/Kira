# Kira

[![CI](https://github.com/aibenyclaude-coder/Kira/actions/workflows/ci.yml/badge.svg)](https://github.com/aibenyclaude-coder/Kira/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/kira-mcp.svg)](https://www.npmjs.com/package/kira-mcp)
[![npm downloads](https://img.shields.io/npm/dw/kira-mcp.svg)](https://www.npmjs.com/package/kira-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

### Your agent stops repeating its own mistakes.

Every failed retry, every exception, every *"wait — we hit this exact wall last week"* is knowledge your agent throws away when the session ends. Kira keeps it. One MCP install and your agent **records what burned it** (a *scar*), **sees its scars before it works again**, and stops paying for the same mistake twice.

> **Privacy by design.** Personal scars and the lookup-miss log are **local-only — never uploaded, on any tier**. Community telemetry is opt-in and **redacts secrets, paths, and identifiers locally before write AND server-side before storage**. Run `npm run demo:privacy` to see exactly what leaves your machine. Full wire format and opt-out in [PRIVACY.md](./PRIVACY.md).

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

## The loop, in 30 seconds

```text
Monday    agent gates a merge on:  npm run build 2>&1 | tail -1
          exit code comes from tail, not the compiler → broken code reaches main
          └─ kira_record_failure(
               title:   "build gate bypassed: exit code swallowed by pipe to tail",
               instead: "never gate on a piped command without pipefail")

Tuesday   new session, same machine
          └─ session brief: "⚠ You have been burned by this before:
             never gate on a piped command without set -o pipefail"
          agent writes the gate correctly. Zero repeats. Zero wasted tokens.
```

Not a hypothetical — this is the **actual first scar in the database**, recorded by the agent that built this feature, about a mistake it made *while building it*. The next three scars came the same day. The loop works on day one, for a single user, with zero network effects required. [FLYWHEEL.md](./FLYWHEEL.md) documents the full improvement loop.

---

## Tools (9)

| | Tool | What it does |
|---|------|-------------|
| **Personal memory** | `kira_record_failure` | Capture a retry/exception as a personal scar (local-only) |
| | `kira_personal_brief` | Session-start brief of your latest scars — start work already knowing where you got burned |
| | `kira_premortem` | Failure heat-map for a goal *before* starting — "here's where this kind of task has burned you" |
| **Catalog** | `kira_lookup` | Keyword → proven instructions + failure warnings. On a miss, returns scored `near_skills` / `near_scars` instead of a shrug |
| | `kira_get` | Fetch full step-by-step instructions by ID |
| | `kira_route` | Goal → ordered plan with a skill per step |
| **Feedback** | `kira_report` | Report success/retry/failure → feeds the quality loop |
| | `kira_consent` / `kira_status` | Telemetry consent + one-call introspection |

**Auto-firing:** you don't call Kira — Kira's MCP instructions tell your agent when to. Japanese queries are first-class (CJK bigram matching).

### When nothing matches

A lookup miss is not a dead end — it's demand data. Kira returns the closest scored matches, records the miss locally (with *what almost matched*), and the weekly flywheel digest turns repeated misses into alias fixes and new-skill candidates. The catalog learns what people actually ask for.

---

## The catalog layer (community skills & scars)

![Kira Demo](./demo.gif)

34 community skills across deploy / database / auth / payments / UI / testing / CI / infra / mobile / CMS, and 12 community scars — real failure patterns like *"Vercel deploy succeeds but the app crashes: missing env vars"* or *"Auth.js v5 signIn imported from the wrong side"*. `kira_route` turns a goal ("build a web app") into an ordered plan with the right skill and scars per step.

Community scars are where personal scars graduate to: a promotion flow (opt-in, sanitized, human-reviewed) is on the roadmap — see [FLYWHEEL.md](./FLYWHEEL.md) for what ships when.

---

## How it works

```
Your agent hits a wall            Your agent gets a task
    ↓                                 ↓
kira_record_failure()             kira_premortem(goal) / kira_lookup(keyword)
    ↓                                 ↓
~/.kira/personal-scars/           scars first, then instructions
    ↓                                 ↓
next session: brief surfaces      agent announces → executes → kira_report()
your scars before work starts         ↓
    ↓                             misses + failure notes feed the flywheel
never the same mistake twice      → digest → catalog improvements
```

Skills are natural language Markdown — no executable code, no injection risk.

---

## Why not just CLAUDE.md?

| | CLAUDE.md / .cursorrules | Kira |
|---|---|---|
| Setup | Copy per project | Install once |
| Failure memory | You write it by hand, if you remember | `kira_record_failure` — captured at the moment it happens |
| Recall | You re-read it, if you remember | Surfaced automatically at session start / task start |
| Selection | You choose | Agent chooses, scored |
| Updates | Manual | Automatic (flywheel) |
| Works across AI tools | Tool-specific | Any MCP client |

---

## Telemetry

Personal scars (`~/.kira/personal-scars/`) and the miss log (`~/.kira/misses.log`) are **local-only and never uploaded**. Community telemetry is separate and consent-gated:

| Mode (`KIRA_TELEMETRY` env, or `kira_consent` MCP tool) | What leaves your machine |
|---|---|
| `off` | Nothing. Local log only. |
| `basic` *(default)* | Anonymous core: skill ID, status, anonymous UUID, kira version, OS family, Node major version, free/pro tier. **No free text.** |
| `full` | Same as basic plus **sanitized** `note` / `context` (secrets, paths, identifiers redacted). |

Full schema, redaction rules, retention, and opt-out instructions: **[PRIVACY.md](./PRIVACY.md)**.

| Env var | Default | Purpose |
|---|---|---|
| `KIRA_TELEMETRY` | (unset → `basic`) | Override consent level for this process: `off`, `basic`, `full`. |
| `KIRA_TELEMETRY_URL` | `https://kira-telemetry.workers.dev/v1/reports` | Endpoint for batch upload. |
| `KIRA_HOME` | `~/.kira` | Where consent state, personal scars, miss log, and flywheel output live. |

---

## Contributing

The first **1,000 contributors** get permanent free access to all Kira features (including future Pro tier).

See [CONTRIBUTING.md](./CONTRIBUTING.md) for how to add Skills and Scars.

---

## Links

- [npm](https://www.npmjs.com/package/kira-mcp)
- [The Flywheel](./FLYWHEEL.md) — how the improvement loop runs
- [Design Philosophy](./DESIGN.md)
- [Business Plan](./PLAN.md)
- [Usage Guide](./USAGE.md)
- [Troubleshooting](./TROUBLESHOOTING.md)

---

**Where agents shine — by remembering where they got burned.**

*A [B Button Corporation](https://github.com/aibenyclaude-coder) project.*
