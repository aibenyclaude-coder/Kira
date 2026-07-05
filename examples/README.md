# Kira — Client Examples

Copy-paste MCP config for the three most common clients. Each snippet is a
complete, valid config — paste it, restart the client, done.

| Client | Example | Config file |
|---|---|---|
| **Claude Code** | [claude-code.md](./claude-code.md) | `.mcp.json` (project) or `~/.claude/settings.json` (global) |
| **Cursor** | [cursor.md](./cursor.md) | `.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global) |
| **Continue** | [continue.md](./continue.md) | `~/.continue/config.yaml` or `~/.continue/config.json` |

## The minimal snippet

Every client below accepts this shape (key names differ slightly per client —
see each file):

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

No API key, no account, no build step. `npx` fetches `kira-mcp` on first run.

## What your agent gets

Once loaded, Kira exposes **six tools**. You never call them — Kira's MCP
instructions tell the agent to call them automatically before and after tasks.

| Tool | What it does |
|---|---|
| `kira_lookup` | keyword → matching skills (how-to) + scars (past failures) |
| `kira_route` | broad goal → ordered plan, each step with its skill + scars |
| `kira_get` | skill/scar ID → full step-by-step instructions |
| `kira_report` | report `success` / `retry` / `failure` after a task |
| `kira_consent` | set or query telemetry level (`off` / `basic` / `full`) |
| `kira_status` | server tier, loaded skill/scar/route counts, consent state |

## Environment variables

All optional. Set them in the client config's `env` block (shown per client)
or export them in the shell that launches the client. None are required to run.

| Variable | Default | Purpose |
|---|---|---|
| `KIRA_TELEMETRY` | (unset → `basic`) | Consent level for this process: `off`, `basic`, `full`. Overrides the saved consent file. |
| `KIRA_TELEMETRY_URL` | `https://kira-telemetry.workers.dev/v1/reports` | Endpoint for batched outcome uploads. |
| `KIRA_HOME` | `~/.kira` | Where the consent file and local report log live. |
| `KIRA_PRO_KEY` | (none → free tier) | Pro license key. Any invalid/absent value → free tier (never breaks the agent). |
| `KIRA_REMOTE_URL` | (none) | Override URL for the remote skill index. |
| `KIRA_CACHE_TTL_MS` | `3600000` (1h) | TTL for the cached remote skill index. |

Privacy details (what leaves your machine, redaction rules, opt-out):
[../PRIVACY.md](../PRIVACY.md).

## Verify it loaded

You don't need a client to prove the server works. From any shell:

```bash
(printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"kira_lookup","arguments":{"keyword":"deploy vercel","context":["nextjs"]}}}'; \
  sleep 0.5) | npx kira-mcp
```

You should see the `initialize` reply, a `tools/list` listing all six tools,
and a `kira_lookup` result. Inside a client, confirm the same list appears in
the client's MCP panel after a restart.
