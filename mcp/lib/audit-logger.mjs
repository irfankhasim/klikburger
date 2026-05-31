/**
 * mcp/lib/audit-logger.mjs
 * Writes audit entries to pos_audit_logs (existing collection).
 * Every write tool MUST call auditLog() before returning.
 *
 * Schema mirrors existing audit log pattern in pos-firestore-hub.js.
 */

import { getAdminFirestore } from './admin-init.mjs';
import { COL } from './collections.mjs';

/**
 * @param {object} opts
 * @param {string} opts.action   — tool name, e.g. 'update_staff'
 * @param {string} opts.source   — always 'MCP_AGENT'
 * @param {string} [opts.targetId]  — docId affected
 * @param {string} [opts.targetCollection]
 * @param {object} [opts.payload]   — sanitized input (NO passwords/PINs)
 * @param {'success'|'failure'} opts.status
 * @param {string} [opts.error]   — if status=failure
 * @param {string} [opts.operatorId] — who triggered (if known)
 */
export async function auditLog(opts) {
  const entry = {
    action:            opts.action,
    source:            'MCP_AGENT',
    targetId:          opts.targetId ?? null,
    targetCollection:  opts.targetCollection ?? null,
    payload:           opts.payload ?? null,
    status:            opts.status,
    error:             opts.error ?? null,
    operatorId:        opts.operatorId ?? 'mcp_agent',
    timestamp:         new Date(),
    environment:       process.env.FIRESTORE_EMULATOR_HOST ? 'emulator' : 'production',
  };

  try {
    const db = await getAdminFirestore();
    await db.collection(COL.POS_AUDIT_LOGS).add(entry);
  } catch (e) {
    // Audit failure must NEVER crash the tool — just log to stderr
    console.error('[MCP AUDIT ERROR]', e.message, 'Original entry:', entry);
  }

  // Always echo to stderr for local inspection
  console.error(
    `[AUDIT] ${entry.timestamp.toISOString()} | ${entry.action} | ${entry.status}` +
    (entry.targetId ? ` | doc:${entry.targetId}` : '')
  );
}

/**
 * Convenience: wrap an async tool handler with automatic audit on error.
 * Usage: return auditWrap('my_tool', input, async () => { ... })
 */
export async function auditWrap(toolName, input, fn) {
  try {
    const result = await fn();
    return result;
  } catch (e) {
    await auditLog({
      action: toolName,
      status: 'failure',
      payload: input,
      error: e.message,
    });
    throw e;
  }
}
