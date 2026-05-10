# Publishing Kira to the MCP Server Registry

The official MCP server directory at <https://github.com/modelcontextprotocol/servers> [stopped accepting third-party PRs](https://github.com/modelcontextprotocol/servers/blob/main/CONTRIBUTING.md). All new servers must be published to the **MCP Server Registry** at <https://github.com/modelcontextprotocol/registry>.

This document is the maintainer-only checklist for that submission.

## Prerequisites (one-time)

Already done:

- [x] `package.json` has `"mcpName": "io.github.aibenyclaude-coder/kira"`
- [x] `server.json` exists at the repo root with the registry schema
- [x] `kira-mcp@0.5.0` is published to npm

## Install `mcp-publisher`

```bash
# Linux amd64 (Ubuntu 24.04)
curl -L "https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher_linux_amd64.tar.gz" \
  | sudo tar xz -C /usr/local/bin mcp-publisher
sudo chmod +x /usr/local/bin/mcp-publisher
mcp-publisher --version
```

macOS:

```bash
brew install mcp-publisher
```

## Verify `server.json` against the schema

```bash
mcp-publisher init   # only if you need to regenerate; we already have one
# or, if you want to keep our hand-tuned file, just lint:
mcp-publisher publish --dry-run
```

The dry-run resolves `$schema`, fetches the live registry shape, and validates the file. Any mismatch prints a diff and exits non-zero.

## Authenticate with GitHub

```bash
mcp-publisher login github
```

This prints a device code, opens <https://github.com/login/device> in your browser, and waits for OAuth approval. Token is cached in `~/.config/mcp-publisher/`.

## Publish

```bash
mcp-publisher publish
```

Prints the registry URL on success (typically `https://registry.modelcontextprotocol.io/v0.1/servers/<id>`).

## Verify

```bash
curl -s "https://registry.modelcontextprotocol.io/v0.1/servers?search=kira" | jq .
```

You should see `io.github.aibenyclaude-coder/kira` in the response.

## Bump flow on every release

When publishing a new version, both `package.json:version` and `server.json:version` (and `packages[0].version`) must be updated together. Then:

```bash
npm version patch        # or minor / major — bumps package.json + creates tag
# (manually) update server.json's two version fields to match
npm publish              # to npm
mcp-publisher publish    # to MCP registry
git push origin main --tags
```

Consider scripting the `server.json` bump with a `version` lifecycle hook in `package.json` if this gets tedious.

## Downstream listings (auto)

Once published to the registry, these aggregators ingest automatically:

- <https://registry.modelcontextprotocol.io/> (canonical)
- <https://www.pulsemcp.com/> (mirrors the registry; submit form for faster indexing)
- <https://smithery.ai/> (mirrors)
- <https://github.com/punkpeye/awesome-mcp-servers> (manual PR; CONTRIBUTING.md explains the bot fast-track convention)
