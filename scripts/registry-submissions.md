# Third-party registry submissions

The **canonical** MCP Server Registry publish flow lives in
[`registry-publish.md`](./registry-publish.md). Several aggregators mirror that
registry automatically (see [Downstream listings](./registry-publish.md#downstream-listings-auto)).

This document tracks the directories that do **not** ingest the canonical
registry automatically — they need a manual submission, or they index a direct
submission faster than they pick up the registry mirror. Maintainer-only.

> **Verify before submitting.** Aggregator submission flows change often. Treat
> the submission URLs below as a starting point and confirm the live form/endpoint
> before pasting the payload. Update the **Status** and **Last checked** fields in
> the same commit you submit.

## Shared metadata (single source of truth)

Every entry below reuses these values. They must stay in sync with
`server.json` and `package.json` — never hand-edit a payload to diverge from them.

| Field | Value | Source |
|---|---|---|
| Registry name / id | `io.github.aibenyclaude-coder/kira` | `server.json:name`, `package.json:mcpName` |
| Display name | Kira | — |
| npm package | `kira-mcp` | `package.json:name` |
| Version | `0.5.0` | `server.json:version`, `package.json:version` |
| Description | Auto-manages Skills (how to do it) and Scars (failures already learned) for AI coding agents. One MCP install, zero per-project config. | `server.json:description` |
| Repository | <https://github.com/aibenyclaude-coder/Kira> | `server.json:repository.url` |
| Website | <https://github.com/aibenyclaude-coder/Kira> | `server.json:websiteUrl` |
| Install command | `npx kira-mcp` | `server.json:packages[0].runtimeHint` |
| Transport | `stdio` | `server.json:packages[0].transport.type` |
| License | MIT | `package.json:license` |
| Tags / keywords | `mcp`, `ai`, `agent`, `skills`, `claude`, `cursor`, `cline`, `model-context-protocol` | `package.json:keywords` |

Environment variables (all optional; free tier works with none set):

| Variable | Secret | Purpose |
|---|---|---|
| `KIRA_TELEMETRY` | no | Consent level: `off` \| `basic` \| `full`. Default `basic`. |
| `KIRA_TELEMETRY_URL` | no | Override telemetry ingest endpoint. |
| `KIRA_HOME` | no | Consent state + local report log location. Default `~/.kira`. |
| `KIRA_PRO_KEY` | **yes** | ES256 JWT for the Pro tier. Free tier works without it. |

## Status summary

`Status` legend: `not-submitted` → `pending` (submitted, awaiting index) → `listed` (live) → `rejected`.

| Registry | Submission URL | Status | Last checked |
|---|---|---|---|
| Glama | <https://glama.ai/mcp/servers> | `not-submitted` | 2026-07-05 |
| OpenTools | <https://opentools.com/registry> | `not-submitted` | 2026-07-05 |
| mcp.so | <https://mcp.so/submit> | `not-submitted` | 2026-07-05 |

---

## 1. Glama

- **Submission URL:** <https://glama.ai/mcp/servers>
- **Method:** Glama crawls public GitHub repos and auto-discovers MCP servers.
  Listing appears without any submission once the repo is public. To control how
  the entry renders (maintainers, categories), add a `glama.json` at the repo
  root — Glama reads it on the next crawl. Use the "Add server" flow on the
  directory page to trigger an immediate index instead of waiting for the crawler.
- **Payload** — `glama.json` at repo root (adds no runtime dependency; not shipped
  in the npm package). The `$schema` URL is authoritative — validate against it
  before committing:

  ```json
  {
    "$schema": "https://glama.ai/mcp/schema/glama.json",
    "maintainers": ["aibenyclaude-coder"]
  }
  ```

  Discovery relies on the repo's existing `README.md` and `server.json`; no
  package block is duplicated here.
- **Status:** `not-submitted` (as of 2026-07-05)

## 2. OpenTools

- **Submission URL:** <https://opentools.com/registry>
- **Method:** OpenTools maintains an open registry of MCP servers. Submit via the
  registry's "Submit a server" flow (or the PR-based entry in its registry repo,
  if the form links to one). Confirm the current mechanism on the page before
  submitting.
- **Payload** — registry entry fields (map to whatever the live form/schema asks):

  ```json
  {
    "name": "Kira",
    "id": "io.github.aibenyclaude-coder/kira",
    "description": "Auto-manages Skills and Scars for AI coding agents. One MCP install, zero per-project config.",
    "repository": "https://github.com/aibenyclaude-coder/Kira",
    "homepage": "https://github.com/aibenyclaude-coder/Kira",
    "install": {
      "npm": "kira-mcp",
      "command": "npx",
      "args": ["kira-mcp"],
      "transport": "stdio"
    },
    "license": "MIT",
    "categories": ["ai", "agent", "developer-tools"],
    "tags": ["mcp", "skills", "claude", "cursor", "cline"]
  }
  ```

- **Status:** `not-submitted` (as of 2026-07-05)

## 3. mcp.so

- **Submission URL:** <https://mcp.so/submit>
- **Method:** Community directory. Paste the public GitHub repo URL into the
  submit form; mcp.so scrapes `README.md` and `server.json` for the rest. Manual
  fields below only override what it cannot infer.
- **Payload** — submit-form fields:

  ```json
  {
    "name": "Kira",
    "github_url": "https://github.com/aibenyclaude-coder/Kira",
    "npm": "kira-mcp",
    "description": "Where agents shine — auto-manages Skills and Scars for AI agents via MCP.",
    "command": "npx kira-mcp",
    "transport": "stdio",
    "tags": ["mcp", "ai", "agent", "skills", "claude", "cursor", "cline"]
  }
  ```

- **Status:** `not-submitted` (as of 2026-07-05)

---

## Already covered elsewhere (no action here)

These mirror the canonical registry automatically once
[`registry-publish.md`](./registry-publish.md) is completed — do **not**
double-submit:

- <https://registry.modelcontextprotocol.io/> — canonical
- <https://www.pulsemcp.com/> — mirrors the registry (has a form for faster indexing)
- <https://smithery.ai/> — mirrors
- <https://github.com/punkpeye/awesome-mcp-servers> — manual PR (see `registry-publish.md`)

## On every version bump

When `server.json` / `package.json` version changes, refresh each listed entry:

1. Re-run the canonical publish (`registry-publish.md`) first — mirrors follow.
2. For each `listed` registry above, update the version shown (re-crawl for Glama,
   re-submit or edit for OpenTools / mcp.so).
3. Update the **Shared metadata** table and each **Status** / **Last checked**
   field in this file so it stays the source of truth.
