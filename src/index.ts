#!/usr/bin/env node
/**
 * Kira MCP server entry point.
 * Runs over stdio — designed to be spawned by an MCP client
 * (Claude Code, Cline, Cursor, etc.).
 */
import { startServer } from "./server.js";

startServer().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[kira] Fatal error:", err);
  process.exit(1);
});
