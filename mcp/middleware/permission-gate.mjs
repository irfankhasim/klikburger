/**
 * mcp/middleware/permission-gate.mjs
 *
 * Tool-level permission system for MCP.
 * Admin SDK bypasses Firestore rules — so this layer IS the security.
 *
 * How it works:
 *   - Each tool declares a required PERMISSION_LEVEL
 *   - The MCP server reads MCP_PERMISSION_LEVEL env var
 *   - If tool needs higher level than configured → reject
 *
 * Permission levels (least → most privileged):
 *   'read'   — safe reads, no side effects
 *   'write'  — create/update docs (no delete, no financial)
 *   'admin'  — delete, void receipts, close shifts, manage staff
 *   'owner'  — monthly report regen, destructive bulk ops
 *
 * To configure: set MCP_PERMISSION_LEVEL=write in your shell/mcp.json env.
 * Optional: MCP_FULL_FIRESTORE_ACCESS=1 — generic create/update/delete allow
 * any top-level collection (see validators.mjs); use only in trusted setups.
 * Default (if unset): 'read' — safe fallback.
 */

const LEVELS = ['read', 'write', 'admin', 'owner'];

function levelIndex(level) {
  const i = LEVELS.indexOf(level);
  if (i === -1) throw new Error(`Unknown permission level: ${level}`);
  return i;
}

/** Configured level for this MCP server instance */
export function getConfiguredLevel() {
  const raw = process.env.MCP_PERMISSION_LEVEL ?? 'read';
  if (!LEVELS.includes(raw)) {
    console.error(`[MCP] Unknown MCP_PERMISSION_LEVEL '${raw}', falling back to 'read'`);
    return 'read';
  }
  return raw;
}

/**
 * Assert that the configured level is >= required level.
 * Throws with a clear message if denied.
 *
 * @param {'read'|'write'|'admin'|'owner'} required
 * @param {string} toolName — for error messages
 */
export function assertPermission(required, toolName) {
  const configured = getConfiguredLevel();
  if (levelIndex(configured) < levelIndex(required)) {
    throw new Error(
      `[PERMISSION DENIED] Tool '${toolName}' requires level '${required}', ` +
      `but MCP_PERMISSION_LEVEL is '${configured}'. ` +
      `Set MCP_PERMISSION_LEVEL=${required} to enable this tool.`
    );
  }
}

/**
 * Middleware wrapper: call at the top of any tool handler.
 * Usage: checkPermission('write', 'update_staff');
 */
export function checkPermission(required, toolName) {
  assertPermission(required, toolName);
  // Log what level is being used
  console.error(
    `[MCP] Tool '${toolName}' granted at level '${required}' ` +
    `(configured: ${getConfiguredLevel()})`
  );
}
