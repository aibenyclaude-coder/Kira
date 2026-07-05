# Using Kira

## Quick Start (recommended)

Add to your MCP config and you're done:

**Claude Code** (`~/.claude/settings.json`):
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

**Cursor** (`.cursor/mcp.json`):
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

**Cline** (VS Code settings → Cline MCP Servers):
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

Restart your client. Kira auto-fires — your agent will call `kira_lookup` before every task without you doing anything.

## What your agent gets

### kira_lookup — find the right skill

Your agent calls:
```
kira_lookup("deploy vercel", context: ["nextjs"])
```

Returns:
- **Skill**: Step-by-step deployment instructions
- **Scars**: real recorded failures, e.g. *"Vercel deploy succeeds but the app crashes — missing env vars. Run `vercel env ls` first."*
- **Your own scars first**: failures recorded on this machine (see below) outrank shared ones at equal severity

Fuzzy matching works — "deploy", "database", "auth" all resolve correctly, and Japanese queries are first-class (CJK bigram matching). On a total miss you get scored `near_skills` / `near_scars` instead of a shrug.

### kira_route — plan multi-step goals

Your agent calls:
```
kira_route("build a web app")
```

Returns 8 ordered steps, each with its skill and warnings:
1. Tailwind CSS v4
2. shadcn/ui
3. ESLint
4. Prisma + Scar: "don't forget prisma generate"
5. Clerk Auth + Scar: "middleware goes in root, not app/"
6. Vitest
7. GitHub Actions CI
8. Vercel Deploy + Scar: "check env vars before --prod"

### kira_report — feed the quality system

After each task, your agent calls:
```
kira_report("community.deploy-vercel-nextjs.v1", "success")
```

Status options: `success`, `retry`, `failure`. This data drives quality scoring and future Scar generation.

## The personal failure loop (the part that works on day one)

No network, no community required — your agent stops repeating **its own** mistakes:

```
kira_record_failure(title, mistake, instead)   ← the moment something burns
kira_personal_brief()                          ← session start: "here's where you got burned"
kira_premortem("deploy the worker")            ← before a task: failure heat-map for THIS goal
kira_share_scar(scar_id)                       ← optional: promote your scar to everyone
```

- Personal scars live in `~/.kira/personal-scars/` — **local-only, never uploaded, on any tier**.
- Re-recording a similar failure merges into the existing scar (`hit_count` counts real recurrences).
- Personal scars fire automatically in `kira_lookup`, `kira_premortem`, `kira_get` and `kira_status`.
- Sharing is always an explicit act: `kira_share_scar` only *prepares* a submission (sanitized twice); you click submit. Accepted scars earn contributor status — see [RECIPROCITY.md](./RECIPROCITY.md).

## Run the demo (no MCP client needed)

```bash
git clone https://github.com/aibenyclaude-coder/Kira.git
cd Kira
npm install
npm run demo
```

The demo exercises `kira_lookup`, `kira_route`, and `kira_report` with sample queries.

## Test the MCP server manually

```bash
(printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"kira_lookup","arguments":{"keyword":"deploy vercel","context":["nextjs"]}}}'; \
  sleep 0.5) | npx kira-mcp
```

You should see three JSON-RPC responses: `initialize`, `tools/list`, and the `kira_lookup` result.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `KIRA_KEY` | (none) | Contributor / supporter key — unlocks the fresh community feed ([RECIPROCITY.md](./RECIPROCITY.md)) |
| `KIRA_REMOTE_URL` | (none) | Opt-in corpus feed URL for the free tier (90-day-delayed commons) |
| `KIRA_PRO_KEY` | (none) | Legacy alias of `KIRA_KEY` |
| `KIRA_HOME` | `~/.kira` | Personal scars, consent state, miss log, flywheel output |
| `KIRA_TELEMETRY` | `basic` | `off` / `basic` / `full` — see [PRIVACY.md](./PRIVACY.md) |

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for how to add Skills and Scars.
