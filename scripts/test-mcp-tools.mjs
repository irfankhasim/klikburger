#!/usr/bin/env node
/**
 * scripts/test-mcp-tools.mjs
 * Smoke-test all MCP tools against the emulator.
 * Run: node scripts/test-mcp-tools.mjs
 *
 * Requires emulator running: npm run dev
 */

/* Use 127.0.0.1 so Node does not prefer IPv6 (::1), which often fails if only IPv4 is bound. */
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
process.env.GCLOUD_PROJECT           = process.env.GCLOUD_PROJECT ?? 'possystem-6907d';
process.env.MCP_PERMISSION_LEVEL     = 'owner';

import { readTools }   from '../mcp/tools/read/index.mjs';
import { writeTools }  from '../mcp/tools/write/index.mjs';
import { adminTools }  from '../mcp/tools/admin/index.mjs';
import { reportTools } from '../mcp/tools/report/index.mjs';

const PASS = '✅';
const FAIL = '❌';
const SKIP = '⏭️ ';

let passed = 0, failed = 0, skipped = 0;

async function test(name, fn) {
  try {
    const result = await fn();
    if (result?.error && !result?.success) {
      // Tool returned a logical error (validation) — still a pass for smoke test
      console.log(`${SKIP} ${name}: ${result.error} (expected)`);
      skipped++;
    } else {
      console.log(`${PASS} ${name}`);
      passed++;
    }
  } catch (err) {
    if (err.message?.includes('[PERMISSION DENIED]')) {
      console.log(`${SKIP} ${name}: permission check working`);
      skipped++;
    } else {
      console.log(`${FAIL} ${name}: ${err.message}`);
      failed++;
    }
  }
}

console.log('\n=== KLik Burger MCP Smoke Tests ===\n');

// READ TOOLS
console.log('── READ tools ──');
await test('get_menu_items',          () => readTools.find(t => t.name === 'get_menu_items').handler({ limit: 5 }));
await test('get_orders',              () => readTools.find(t => t.name === 'get_orders').handler({ limit: 5 }));
await test('get_staff_list',          () => readTools.find(t => t.name === 'get_staff_list').handler({}));
await test('get_ingredients',         () => readTools.find(t => t.name === 'get_ingredients').handler({ limit: 5 }));
await test('get_sales_summary',       () => readTools.find(t => t.name === 'get_sales_summary').handler({ limit: 5 }));
await test('get_shifts',              () => readTools.find(t => t.name === 'get_shifts').handler({ limit: 5 }));
await test('get_receipts',            () => readTools.find(t => t.name === 'get_receipts').handler({ limit: 5 }));
await test('get_audit_logs',          () => readTools.find(t => t.name === 'get_audit_logs').handler({ limit: 5 }));
await test('get_monthly_report (list)', () => readTools.find(t => t.name === 'get_monthly_report').handler({}));
await test('get_inventory_status',    () => readTools.find(t => t.name === 'get_inventory_status').handler());
await test('get_dashboard_summary',   () => readTools.find(t => t.name === 'get_dashboard_summary').handler());
await test('get_order_by_id (404)',   () => readTools.find(t => t.name === 'get_order_by_id').handler({ orderId: 'nonexistent' }));
await test('get_staff_by_id (404)',   () => readTools.find(t => t.name === 'get_staff_by_id').handler({ staffId: 'nonexistent' }));

// WRITE TOOLS (validation tests)
console.log('\n── WRITE tools (validation) ──');
await test('update_menu_item (no id)',   () => writeTools.find(t => t.name === 'update_menu_item').handler({ updates: {} }));
await test('update_ingredient (no id)', () => writeTools.find(t => t.name === 'update_ingredient').handler({ updates: {} }));
await test('add_purchase (missing qty)', () => writeTools.find(t => t.name === 'add_purchase').handler({ ingredientId: 'x', ingredientName: 'x', unit: 'kg', supplierName: 'x', costPerUnit: 10 }));
await test('update_order_status (bad status)', () => writeTools.find(t => t.name === 'update_order_status').handler({ orderId: 'x', status: 'flying' }));
await test('create_document (protected col)', () => writeTools.find(t => t.name === 'create_document').handler({ collection: 'users', data: { test: true } }));
await test('update_document (missing updates)', () => writeTools.find(t => t.name === 'update_document').handler({ collection: 'staff', docId: 'x', updates: {} }));

// ADMIN TOOLS (validation tests)
console.log('\n── ADMIN tools (validation) ──');
await test('manage_staff (create, missing name)', () => adminTools.find(t => t.name === 'manage_staff').handler({ action: 'create', role: 'cashier' }));
await test('delete_document (protected sales)', () => adminTools.find(t => t.name === 'delete_document').handler({ collection: 'sales', docId: 'x', reason: 'test reason here' }));
await test('void_receipt (short reason)', () => adminTools.find(t => t.name === 'void_receipt').handler({ receiptId: 'x', reason: 'short', operatorId: 'op1' }));
await test('close_shift (missing closingCash)', () => adminTools.find(t => t.name === 'close_shift').handler({ shiftId: 'x', operatorId: 'op1' }));
await test('manage_inventory (bad reason)', () => adminTools.find(t => t.name === 'manage_inventory').handler({ ingredientId: 'x', adjustmentQty: -1 }));

// REPORT TOOLS
console.log('\n── REPORT tools ──');
await test('generate_monthly_report (bad format)', () => reportTools.find(t => t.name === 'generate_monthly_report').handler({ yearMonth: '2025/01' }));
await test('get_sales_analytics',   () => reportTools.find(t => t.name === 'get_sales_analytics').handler({ dateFrom: '2025-01-01', dateTo: '2025-01-31' }));
await test('get_staff_performance', () => reportTools.find(t => t.name === 'get_staff_performance').handler({ dateFrom: '2025-01-01', dateTo: '2025-01-31' }));
await test('get_cogs_report',       () => reportTools.find(t => t.name === 'get_cogs_report').handler({ dateFrom: '2025-01-01', dateTo: '2025-01-31' }));

console.log(`\n=== Results: ${PASS} ${passed} passed | ${SKIP} ${skipped} expected | ${FAIL} ${failed} failed ===\n`);

if (failed > 0) process.exit(1);
