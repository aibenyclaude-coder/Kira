# Troubleshooting

Kira is a stdio MCP server launched by your client with `npx kira-mcp`. Almost every install problem is one of the issues below. Each entry has a **Symptom**, a **Cause**, and a **Fix**.

If none of these help, open an issue at <https://github.com/aibenyclaude-coder/Kira/issues> with the label `bug`.

---

## First: verify the server actually runs

Before debugging your client, confirm Kira starts on its own. This talks to the server over stdio exactly like your MCP client does:

```bash
(printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'; \
  sleep 0.5) | npx kira-mcp
```

You should see JSON-RPC responses for `initialize` and `tools/list`, and the tool list should include all ten tools (as of v0.8.0): `kira_lookup`, `kira_route`, `kira_get`, `kira_report`, `kira_consent`, `kira_status`, `kira_record_failure`, `kira_premortem`, `kira_personal_brief`, `kira_share_scar`.

- **Responses appear** → the server is fine; the problem is client config (issues 3–5, 12).
- **Nothing / an error appears** → the problem is the runtime or the download (issues 1, 2, 6, 7, 10).

---

## 1. `npx: command not found` or the package won't download

**Symptom:** The client logs `command not found: npx`, `could not determine executable to run`, or `404 Not Found - kira-mcp`.

**Cause:** Node.js/npm is not on the `PATH` the client uses, or npm can't reach the registry.

**Fix:**
- Confirm Node ≥ 18 and npm are installed: `node -v && npm -v`.
- GUI clients (Claude Desktop, Cursor) often don't inherit your shell `PATH`. Use an absolute path to `npx`, or install globally (see issue 10) and point `command` at the resolved binary (`which kira-mcp`).
- Verify the package name is exactly `kira-mcp` (not `kira` or `@kira/mcp`).

---

## 2. Node.js is too old

**Symptom:** Startup crashes with `SyntaxError`, `Unexpected token`, `import` errors, or `Unsupported engine`.

**Cause:** Kira requires **Node.js 18 or newer** (see `engines` in `package.json`). Older runtimes don't support the ESM / syntax it ships.

**Fix:** Upgrade Node to an 18+ LTS (20 or 22 recommended). If you use `nvm`, note that GUI clients may pick up the system Node, not your `nvm` default — set `command` to the absolute path of the Node 18+ `npx`.

---

## 3. The tools never appear in your agent

**Symptom:** The client starts but your agent never calls Kira, and `kira_lookup` is not in the available tools.

**Cause:** The client loaded its MCP config at startup and hasn't re-read it since you edited it.

**Fix:** **Fully restart the client** after editing the config (quit and relaunch the desktop app, or reload the window in VS Code/Cursor). A hot-reload of the editor is usually not enough.

---

## 4. Config in the wrong file or under the wrong key

**Symptom:** Restarting doesn't help and no `kira` server shows up at all.

**Cause:** The snippet is in the wrong file for your client, or nested under the wrong key.

**Fix:** Use the exact path for your client from the [per-client table in the README](./README.md#install-10-seconds), and make sure the server sits under the `mcpServers` object (or your client's equivalent key):

```json
{
  "mcpServers": {
    "kira": { "command": "npx", "args": ["kira-mcp"] }
  }
}
```

---

## 5. Invalid JSON in the config

**Symptom:** *All* MCP servers silently disappear, not just Kira.

**Cause:** A trailing comma, missing quote, or duplicate key makes the whole config file invalid, so the client discards it.

**Fix:** Validate the file before restarting:

```bash
python3 -c "import json,sys; json.load(open(sys.argv[1]))" /path/to/your/mcp-config.json
```

Fix any reported error. Common culprits: a trailing comma after the last entry, or merging Kira into an existing `mcpServers` block and leaving a stray `}`.

---

## 6. First launch hangs or times out

**Symptom:** The first connection times out or shows "server did not respond"; a later retry works.

**Cause:** On a cold cache, `npx` downloads `kira-mcp` before starting it. That first download can exceed the client's MCP startup timeout.

**Fix:** Warm the cache once from a terminal so the download is already done when the client launches:

```bash
npx kira-mcp   # Ctrl-C once it starts waiting for input
```

Then restart your client. For a permanently fast start, install globally (issue 10).

---

## 7. `npx` runs a stale, cached version

**Symptom:** A bug you expected to be fixed is still present, or `kira_status` reports an old version.

**Cause:** `npx` reuses a previously cached copy of the package instead of fetching the latest.

**Fix:** Pin to the latest explicitly in `args`:

```json
{ "command": "npx", "args": ["kira-mcp@latest"] }
```

Or clear the npx cache and let it re-download: `npm cache clean --force`. Call the `kira_status` tool to confirm the running version afterward.

---

## 8. The server "disconnects" immediately after starting

**Symptom:** The client reports the server exited or the connection closed right after `initialize`, often with a JSON parse error.

**Cause:** stdio is the MCP transport — the server communicates over **stdout**, so anything else printed there corrupts the protocol. This happens when you wrap the command in a shell script or Node loader that prints banners, or when a `.bashrc`/`.profile` echoes text on non-interactive shells.

**Fix:** Launch `npx kira-mcp` directly, with no wrapper that writes to stdout. Kira itself only writes logs to **stderr**, so keep it that way. If you must wrap it, redirect any diagnostic output to stderr (`>&2`). Test with the smoke command at the top — malformed lines before the first JSON-RPC response point at stdout pollution.

---

## 9. `EACCES` / permission denied writing `~/.kira`

**Symptom:** Errors mentioning `~/.kira`, `consent.json`, `reports.log`, or `EACCES`/`EROFS` on startup.

**Cause:** Kira stores consent state and the local report log under `~/.kira`. In a sandboxed or read-only-`HOME` environment (some containers/CI), that directory can't be created or written.

**Fix:** Point Kira at a writable directory with `KIRA_HOME`:

```json
{
  "command": "npx",
  "args": ["kira-mcp"],
  "env": { "KIRA_HOME": "/tmp/kira" }
}
```

---

## 10. Offline, behind a proxy, or on a private registry

**Symptom:** `npx` fails with `ETIMEDOUT`, `ECONNREFUSED`, `407`, or `404` in a locked-down network.

**Cause:** `npx` needs to reach the npm registry to resolve/download `kira-mcp` at launch.

**Fix:** Install once while you have access, then run the installed binary instead of `npx`:

```bash
npm install -g kira-mcp
```

```json
{ "command": "kira-mcp", "args": [] }
```

If a corporate proxy or mirror is required, set `HTTP_PROXY`/`HTTPS_PROXY` (or `npm config set registry <url>`) before installing.

---

## 11. Windows: `npx` not found or path errors

**Symptom:** On Windows the client can't spawn `npx`, or fails with spaces in the path.

**Cause:** Some clients don't resolve `npx` (a `.cmd` shim) the way a shell does.

**Fix:** Use the `cmd /c` form the client expects:

```json
{ "command": "cmd", "args": ["/c", "npx", "kira-mcp"] }
```

Or install globally (issue 10) and set `command` to the absolute path of `kira-mcp.cmd`.

---

## 12. A second MCP server is also named `kira`

**Symptom:** Tools behave unexpectedly, or the client warns about a duplicate server name.

**Cause:** Two entries under `mcpServers` share the key `kira`, so one shadows the other.

**Fix:** Give each server a unique key. The key is just a label — Kira works under any name:

```json
{ "mcpServers": { "kira-prod": { "command": "npx", "args": ["kira-mcp"] } } }
```

---

## 13. You want to turn telemetry off

**Symptom:** You'd rather nothing leave your machine, even the redacted anonymous outcome data.

**Cause:** Kira defaults to `basic` telemetry (anonymous core fields only — see [PRIVACY.md](./PRIVACY.md)).

**Fix:** Set the consent level to `off`. Nothing is uploaded; the local log still records what *would* have been sent so you can audit it.

```json
{ "command": "npx", "args": ["kira-mcp"], "env": { "KIRA_TELEMETRY": "off" } }
```

Or call the `kira_consent` tool with `{"level":"off"}` to persist it to `~/.kira/consent.json`. Full opt-out precedence is documented in [PRIVACY.md](./PRIVACY.md).

---

## 14. `kira_lookup` returns nothing for my keyword

**Symptom:** The server runs, but a lookup comes back with zero skills and zero scars.

**Cause:** No skill matches that keyword yet. Matching is fuzzy but still needs a skill whose keywords/contexts overlap your query.

**Fix:** Try a broader or more canonical keyword (e.g. `deploy` instead of `ship it to prod`), and pass a `context` such as `["nextjs"]`. Confirm the corpus loads with `npm run demo`, which prints every available keyword. If the topic is genuinely missing, contribute a skill — see [CONTRIBUTING.md](./CONTRIBUTING.md).

---

**Still stuck?** Run the smoke test at the top, capture the stderr output, and file an issue at <https://github.com/aibenyclaude-coder/Kira/issues>.
