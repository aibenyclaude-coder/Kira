# Kira in Claude Code

## Config file

Pick one scope:

| Scope | File | When |
|---|---|---|
| **Project** | `.mcp.json` at the repo root | Share Kira with everyone on the repo (commit it). |
| **Global** | `~/.claude/settings.json` | Every project on your machine. |

Both use the same `mcpServers` shape.

## Minimal config

`.mcp.json` (project root):

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

The same block also works pasted under `mcpServers` in
`~/.claude/settings.json` for a global install.

## CLI shortcut

Instead of editing files by hand:

```bash
claude mcp add-json kira '{"command":"npx","args":["kira-mcp"]}'
```

## With environment variables

Every variable is optional. Set them in the server's `env` block so they apply
only to Kira, not your whole shell:

```json
{
  "mcpServers": {
    "kira": {
      "command": "npx",
      "args": ["kira-mcp"],
      "env": {
        "KIRA_TELEMETRY": "basic",
        "KIRA_HOME": "~/.kira"
      }
    }
  }
}
```

| Variable | Default | Purpose |
|---|---|---|
| `KIRA_TELEMETRY` | (unset → `basic`) | Consent level: `off`, `basic`, `full`. |
| `KIRA_TELEMETRY_URL` | `https://kira-telemetry.workers.dev/v1/reports` | Outcome upload endpoint. |
| `KIRA_HOME` | `~/.kira` | Consent file + local report log location. |
| `KIRA_PRO_KEY` | (none → free tier) | Pro license key. |
| `KIRA_REMOTE_URL` | (none) | Override remote skill index URL. |
| `KIRA_CACHE_TTL_MS` | `3600000` | Remote index cache TTL (ms). |

To turn telemetry off entirely, set `"KIRA_TELEMETRY": "off"` (local log only).
See [../PRIVACY.md](../PRIVACY.md).

## Verify

Restart Claude Code, then check the MCP servers list:

```bash
claude mcp list
```

`kira` should appear as connected. In a session, ask the agent to run
`kira_status` — it returns the tier and the loaded skill/scar/route counts.
Kira auto-fires: the agent calls `kira_lookup` / `kira_route` before tasks
without you asking.
