# Using Kira

## Run the demo (no MCP client needed)

```bash
cd /Users/beny/Desktop/Kira
npm install
npm run demo
```

The demo runs `lookup` directly, prints the matching Skill, records a
success report, and exercises two negative cases (wrong keyword, wrong context).

## Wire Kira into Claude Code as an MCP server

Add this entry to your MCP client config. For Claude Code, edit
`~/.claude/settings.json` (or your project's `.mcp.json`):

```json
{
  "mcpServers": {
    "kira": {
      "command": "node",
      "args": ["/Users/beny/Desktop/Kira/dist/index.js"]
    }
  }
}
```

Make sure `dist/` exists first:

```bash
npm run build
```

Restart Claude Code. Then in any session:

> Use the kira_lookup tool with keyword "deploy vercel" and context ["nextjs"].

Claude will fetch the Skill from the local index and read it before
executing. The agent is instructed to declare its choice upfront
(the `declaration` field) before running the instructions.

## Add a new community Skill

Drop a new file in `skills/community/<slug>.json`. Schema:

```json
{
  "id": "community.<slug>.v1",
  "keywords": ["firing keyword", "alias"],
  "contexts": ["nextjs", "python", "..."],
  "title": "Human-readable title",
  "summary": "One-line summary.",
  "source": "community",
  "declaration": "What the agent should announce to the user before executing.",
  "instructions": "## Step-by-step markdown instructions\n\n...",
  "version": "1.0.0",
  "updated_at": "2026-04-10T00:00:00Z"
}
```

No rebuild needed — the server re-reads the filesystem on each startup.
(Live hot-reload is a v0.2 feature.)

## Test the MCP server manually

```bash
(printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"kira_lookup","arguments":{"keyword":"deploy vercel","context":["nextjs"]}}}'; \
  sleep 0.5) | node dist/index.js
```

You should see three JSON-RPC responses: `initialize`, `tools/list`, and
the `kira_lookup` result.
