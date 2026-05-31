#!/usr/bin/env node
/**
 * mcp-server.mjs  (ROOT — replaces existing file)
 * KLik Burger — Production MCP Server
 *
 * Full tool registry: 13 read + 6 write + 5 admin + 4 report = 28 tools
 *
 * Permission levels (set via env MCP_PERMISSION_LEVEL):
 *   read   — safe reads only (DEFAULT)
 *   write  — reads + create/update
 *   admin  — reads + write + delete/void/shift
 *   owner  — all tools
 *
 * Usage:
 *   MCP_PERMISSION_LEVEL=write node mcp-server.mjs
 *
 * Credentials:
 *   GOOGLE_APPLICATION_CREDENTIALS=./firebase-service-account.json
 *   (or FIRESTORE_EMULATOR_HOST=localhost:8080 for local dev)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { readTools }   from './mcp/tools/read/index.mjs';
import { writeTools }  from './mcp/tools/write/index.mjs';
import { adminTools }  from './mcp/tools/admin/index.mjs';
import { reportTools } from './mcp/tools/report/index.mjs';
import { getConfiguredLevel } from './mcp/middleware/permission-gate.mjs';

// ─── Server init ──────────────────────────────────────────────────────────────

const server = new McpServer({
  name:    'klikburger-mcp',
  version: '2.0.0',
});

const configuredLevel = getConfiguredLevel();

console.error(`[MCP] KLik Burger MCP Server v2.0.0 starting...`);
console.error(`[MCP] Permission level: ${configuredLevel.toUpperCase()}`);
console.error(`[MCP] Environment: ${process.env.FIRESTORE_EMULATOR_HOST ? 'EMULATOR' : 'PRODUCTION'}`);

// ─── Tool registration ────────────────────────────────────────────────────────

const ALL_TOOLS = [
  ...readTools,    // always registered; permission=read
  ...writeTools,   // registered; gated internally by checkPermission
  ...adminTools,   // registered; gated internally
  ...reportTools,  // registered; gated internally
];

for (const tool of ALL_TOOLS) {
  server.tool(
    tool.name,
    tool.description,
    tool.inputSchema ?? { type: 'object', properties: {} },
    async (input) => {
      try {
        const result = await tool.handler(input ?? {});
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        // Permission denials and validation errors are thrown — surface cleanly
        const isPermission = err.message?.includes('[PERMISSION DENIED]');
        console.error(`[MCP ERROR] ${tool.name}: ${err.message}`);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: err.message,
              tool: tool.name,
              hint: isPermission
                ? `Increase MCP_PERMISSION_LEVEL to use this tool.`
                : 'Check input parameters.',
            }, null, 2),
          }],
          isError: true,
        };
      }
    }
  );
}

console.error(`[MCP] Registered ${ALL_TOOLS.length} tools:`);
console.error(`      Read:   ${readTools.length}  | Write: ${writeTools.length}  | Admin: ${adminTools.length}  | Report: ${reportTools.length}`);

// ─── Transport ────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('[MCP] Server connected via stdio. Ready.');
