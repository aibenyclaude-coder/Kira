/**
 * MCP Server Card per SEP-2127 (draft, modelcontextprotocol/modelcontextprotocol#2127).
 *
 * Served at `/.well-known/mcp/server-card.json`. Aggregators (PulseMCP,
 * Smithery, future Anthropic clients) discover server metadata, tool
 * surface, and policies from this single endpoint.
 *
 * Kira is an stdio MCP server distributed via npm; the canonical card URL
 * declared in package.json points here so that aggregators that crawl by
 * URL can still index us.
 *
 * Updated by hand on every release. The `version` here MUST match
 * package.json's version after `npm version` runs.
 */

export const SERVER_CARD = {
  $schema: "https://static.modelcontextprotocol.io/schemas/2025-12-11/server-card.schema.json",
  name: "io.github.aibenyclaude-coder/kira",
  title: "Kira",
  description:
    "Auto-manages Skills (how to do things) and Scars (failure patterns already learned) for AI coding agents. One MCP install across all your projects, zero per-project config, opt-in privacy-respecting telemetry that improves the catalog over time.",
  websiteUrl: "https://github.com/aibenyclaude-coder/Kira",
  repository: {
    url: "https://github.com/aibenyclaude-coder/Kira.git",
    source: "github",
  },
  version: "0.7.0",
  icons: [
    {
      src: "https://raw.githubusercontent.com/aibenyclaude-coder/Kira/main/demo.gif",
      mimeType: "image/gif",
    },
  ],
  packages: [
    {
      registryType: "npm",
      registryBaseUrl: "https://registry.npmjs.org",
      identifier: "kira-mcp",
      version: "0.7.0",
      runtimeHint: "npx",
      transport: { type: "stdio" },
    },
  ],
  capabilities: {
    tools: { listChanged: false },
  },
  tools: [
    {
      name: "kira_lookup",
      description:
        "Look up skills (how) and scars (what to avoid) for a keyword, optionally filtered by project context.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    {
      name: "kira_route",
      description:
        "Map a high-level goal to an ordered sequence of steps, each with its skill and relevant scars.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    {
      name: "kira_get",
      description: "Fetch full instructions for a skill or scar by ID.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    {
      name: "kira_report",
      description:
        "Record the outcome of applying a skill (success / retry / failure). Local-first; uploads only at the consent level the user set.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    {
      name: "kira_consent",
      description:
        "Set or query the telemetry consent level (off | basic | full). Persisted to ~/.kira/consent.json.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    {
      name: "kira_status",
      description:
        "Report kira version, tier, consent state, and counts of loaded skills/scars/routes.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
  ],
  _meta: {
    "io.github.aibenyclaude-coder.kira/privacy": {
      telemetry_endpoint: "https://kira-telemetry.workers.dev/v1/reports",
      consent_levels: ["off", "basic", "full"],
      default_level: "basic",
      sanitizer:
        "Pure-function regex sanitizer runs on the client before write/send and on the worker before D1 insert. Redacts API keys, JWTs, AWS access keys, long hex, emails, IPs, UUIDs, home/Windows/POSIX paths, and KEY=value assignments.",
      retention_raw_events_days: 180,
      retention_ip_hash_hours: 24,
      privacy_doc: "https://github.com/aibenyclaude-coder/Kira/blob/main/PRIVACY.md",
    },
  },
} as const;
