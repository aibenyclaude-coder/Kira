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
- **Scars**: "847 agents forgot env vars — run `vercel env ls` first"

Fuzzy matching works — "deploy", "database", "auth" all resolve correctly.

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

## Run the demo (no MCP client needed)

```bash
npx kira-mcp --demo
```

Or from source:
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
| `KIRA_REMOTE_URL` | (none) | URL for remote skill index auto-updates |
| `KIRA_PRO_KEY` | (none) | Pro license key (coming soon) |

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for how to add Skills and Scars.
