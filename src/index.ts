#!/usr/bin/env node
/**
 * Kira MCP server entry point.
 * Runs over stdio — designed to be spawned by an MCP client
 * (Claude Code, Cline, Cursor, etc.).
 */
import { startServer } from "./server.js";

startServer().catch((err) => {
  // Deliberately NOT the logger: KIRA_LOG_LEVEL=silent must be able to quiet
  // the server's chatter without also erasing the one line that explains why
  // the process is about to exit(1). Every other stderr write in the server
  // goes through logger.info and honours the level.
  // eslint-disable-next-line no-console
  console.error("[kira] Fatal error:", err);
  process.exit(1);
});
