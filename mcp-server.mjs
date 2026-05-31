#!/usr/bin/env node
/**
 * mcp-server.mjs (ROOT)
 * KLik Burger — MCP Server (stdio)
 *
 * Tool registry: read + write + admin + report modules under ./mcp/tools/
 *
 * Permission levels (MCP_PERMISSION_LEVEL):
 *   read   — safe reads only (DEFAULT)
 *   write  — reads + create/update
 *   admin  — reads + write + delete/void/shift
 *   owner  — all tools
 *
 * Run: node mcp-server.mjs
 * Credentials: GOOGLE_APPLICATION_CREDENTIALS or firebase-service-account.json;
 *   or FIRESTORE_EMULATOR_HOST for emulator (see mcp/lib/admin-init.mjs).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { readTools } from "./mcp/tools/read/index.mjs";
import { writeTools } from "./mcp/tools/write/index.mjs";
import { adminTools } from "./mcp/tools/admin/index.mjs";
import { reportTools } from "./mcp/tools/report/index.mjs";
import { getConfiguredLevel } from "./mcp/middleware/permission-gate.mjs";
import { isFullFirestoreAccessEnabled } from "./mcp/lib/validators.mjs";

const server = new McpServer({
  name: "klikburger-mcp",
  version: "2.0.0"
});

const configuredLevel = getConfiguredLevel();

console.error("[MCP] KLik Burger MCP Server v2.0.0 starting...");
console.error("[MCP] Permission level: " + String(configuredLevel).toUpperCase());
console.error(
  "[MCP] Full Firestore (generic tools): " +
    (isFullFirestoreAccessEnabled() ? "ON (MCP_FULL_FIRESTORE_ACCESS)" : "OFF (allowlist)")
);
console.error("[MCP] Environment: " + (process.env.FIRESTORE_EMULATOR_HOST ? "EMULATOR" : "PRODUCTION"));

const ALL_TOOLS = [...readTools, ...writeTools, ...adminTools, ...reportTools];

/** MCP SDK expects Zod (or Zod raw shape) for inputSchema — accept arbitrary JSON args per tool. */
const MCP_TOOL_ARGS = z.any();

for (const tool of ALL_TOOLS) {
  server.registerTool(
    tool.name,
    {
      description: tool.description,
      inputSchema: MCP_TOOL_ARGS
    },
    async function (args) {
      try {
        var input = args !== undefined && args !== null && typeof args === "object" && !Array.isArray(args) ? args : {};
        var result = await tool.handler(input);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
        };
      } catch (err) {
        var msg = err && err.message ? err.message : String(err);
        var isPermission = msg.indexOf("[PERMISSION DENIED]") !== -1;
        console.error("[MCP ERROR] " + tool.name + ": " + msg);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: false,
                  error: msg,
                  tool: tool.name,
                  hint: isPermission
                    ? "Increase MCP_PERMISSION_LEVEL to use this tool."
                    : "Check input parameters."
                },
                null,
                2
              )
            }
          ],
          isError: true
        };
      }
    }
  );
}

console.error(
  "[MCP] Registered " +
    ALL_TOOLS.length +
    " tools — Read: " +
    readTools.length +
    " | Write: " +
    writeTools.length +
    " | Admin: " +
    adminTools.length +
    " | Report: " +
    reportTools.length
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[MCP] Server connected via stdio. Ready.");
