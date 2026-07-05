#!/usr/bin/env node
/**
 * Kira MCP server entry point.
 * Runs over stdio — designed to be spawned by an MCP client
 * (Claude Code, Cline, Cursor, etc.).
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { startServer } from "./server.js";
import {
  KIRA_RECORD_FAILURE_TOOL,
  handleRecordFailure,
} from "./tools/record-failure.js";

/**
 * Register `kira_record_failure` on the shared MCP Server.
 *
 * The tool list and dispatcher live in server.ts. This entry point decorates
 * `Server.prototype.setRequestHandler` at the composition root: when server.ts
 * installs its `tools/list` and `tools/call` handlers, we wrap them to
 *   (a) advertise kira_record_failure in the tool list, and
 *   (b) route its calls to handleRecordFailure,
 * delegating every other tool (and every other request schema) to the original
 * handler untouched. The patch is installed before startServer() runs, so the
 * wrappers are in place by the time the handlers are registered.
 */
function registerRecordFailureTool(): void {
  type Handler = (req: any, extra: any) => any;
  const proto = Server.prototype as unknown as {
    setRequestHandler: (schema: unknown, handler: Handler) => void;
  };
  const original = proto.setRequestHandler;

  proto.setRequestHandler = function (
    this: unknown,
    schema: unknown,
    handler: Handler
  ): void {
    if (schema === ListToolsRequestSchema) {
      const wrapped: Handler = async (req, extra) => {
        const res = await handler(req, extra);
        return { ...res, tools: [...(res?.tools ?? []), KIRA_RECORD_FAILURE_TOOL] };
      };
      return original.call(this, schema, wrapped);
    }
    if (schema === CallToolRequestSchema) {
      const wrapped: Handler = async (req, extra) => {
        if (req?.params?.name === "kira_record_failure") {
          const result = await handleRecordFailure(req.params.arguments);
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }
        return handler(req, extra);
      };
      return original.call(this, schema, wrapped);
    }
    return original.call(this, schema, handler);
  };
}

registerRecordFailureTool();

startServer().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[kira] Fatal error:", err);
  process.exit(1);
});
