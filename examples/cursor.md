# Kira in Cursor

## Config file

| Scope | File | When |
|---|---|---|
| **Project** | `.cursor/mcp.json` in the repo | Share Kira with the repo (commit it). |
| **Global** | `~/.cursor/mcp.json` | Every project on your machine. |

Both use the same `mcpServers` shape.

## Minimal config

`.cursor/mcp.json`:

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

## With environment variables

Every variable is optional. Set them in the server's `env` block:

```json
{
  "mcpServers": {
    "kira": {
      "command": "npx",
      "args": ["kira-mcp"],
      "env": {
        "KIRA_TELEMETRY": "full",
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

`full` uploads **sanitized** free-text notes (secrets/paths/identifiers
redacted locally before write). Use `basic` (default) for anonymous core only,
or `off` for local log only. See [../PRIVACY.md](../PRIVACY.md).

## Verify

1. Open **Cursor Settings → MCP** (or **Tools & Integrations → MCP**).
2. `kira` should show a green dot and list six tools
   (`kira_lookup`, `kira_route`, `kira_get`, `kira_report`, `kira_consent`,
   `kira_status`).
3. If it stays grey, hit the refresh icon or restart Cursor — `npx` downloads
   `kira-mcp` on the first launch.

Once connected, Kira auto-fires: the agent looks up skills and scars before
acting, with no prompting from you.
