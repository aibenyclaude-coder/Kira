# Kira in Continue

Continue accepts either YAML (`~/.continue/config.yaml`, the current default)
or JSON (`~/.continue/config.json`). Both are shown below — use whichever your
install already has.

> **Note:** unlike Claude Code and Cursor, Continue's `mcpServers` is a **JSON
> array of objects** (each with a `name`), not an object keyed by name.

## Config file

| Scope | File |
|---|---|
| **Global** | `~/.continue/config.yaml` or `~/.continue/config.json` |
| **Project / block** | `.continue/mcpServers/kira.yaml` |

## Minimal config (JSON)

`~/.continue/config.json`:

```json
{
  "mcpServers": [
    {
      "name": "kira",
      "command": "npx",
      "args": ["kira-mcp"]
    }
  ]
}
```

## Minimal config (YAML)

`~/.continue/config.yaml`:

```yaml
mcpServers:
  - name: kira
    command: npx
    args:
      - kira-mcp
```

## With environment variables

Every variable is optional. Continue reads them from the entry's `env` field:

```json
{
  "mcpServers": [
    {
      "name": "kira",
      "command": "npx",
      "args": ["kira-mcp"],
      "env": {
        "KIRA_TELEMETRY": "basic",
        "KIRA_HOME": "~/.kira"
      }
    }
  ]
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

Set `"KIRA_TELEMETRY": "off"` to keep everything local. See
[../PRIVACY.md](../PRIVACY.md).

## Legacy config.json (older Continue)

Pre-migration installs nest the server under `experimental`:

```json
{
  "experimental": {
    "modelContextProtocolServers": [
      {
        "transport": {
          "type": "stdio",
          "command": "npx",
          "args": ["kira-mcp"],
          "env": {}
        }
      }
    ]
  }
}
```

If your `config.json` already has an `mcpServers` key, use the modern form
above instead.

## Verify

1. Reload Continue (or restart the IDE).
2. Open the Continue **agent/tools** panel — Kira's ten tools should be
   selectable (`kira_lookup`, `kira_route`, `kira_get`, `kira_report`,
   `kira_consent`, `kira_status`).
3. First launch downloads `kira-mcp` via `npx`; give it a few seconds.

Kira auto-fires once loaded: the agent consults skills and scars before acting.
