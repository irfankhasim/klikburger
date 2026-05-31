/**
 * mcp/tools/admin/index.mjs
 * Admin-level tools — delete, void, shift management, staff CRUD.
 * Requires MCP_PERMISSION_LEVEL=admin or higher.
 *
 * Tools:
 *   manage_staff (create/update/deactivate),
 *   delete_document,
 *   void_receipt,
 *   close_shift,
 *   manage_inventory (adjust stock)
 */

import { FieldValue } from 'firebase-admin/firestore';
import { getAdminFirestore } from '../../lib/admin-init.mjs';
import { COL, SUBCOL } from '../../lib/collections.mjs';
import { auditLog } from '../../lib/audit-logger.mjs';
import { checkPermission } from '../../middleware/permission-gate.mjs';
import {
  validateCreateStaff,
  validateUpdateStaff,
  validateVoidReceipt,
  validateCloseShift,
  validateWritableCollection,
  isFullFirestoreAccessEnabled,
  isSafeFirestoreSegment,
} from '../../lib/validators.mjs';

function ts() { return FieldValue.serverTimestamp(); }
function ok(data)  { return { success: true,  ...data }; }
function fail(msg) { return { success: false, error: msg }; }

function roundRm(n) {
  const x = typeof n === "number" ? n : parseFloat(String(n));
  if (x == null || Number.isNaN(x)) return 0;
  return Math.round(x * 100) / 100;
}

function varianceCategoryFromRm(varianceRm) {
  if (varianceRm == null || Number.isNaN(varianceRm)) return "unknown";
  if (Math.abs(varianceRm) < 0.005) return "balanced";
  return varianceRm > 0 ? "over" : "short";
}

export const adminTools = [

  // ── 1. manage_staff ───────────────────────────────────────────────────────
  {
    name: 'manage_staff',
    description:
      'Create, update, or deactivate a staff member. ' +
      'Action: "create" | "update" | "deactivate".',
    inputSchema: {
      type: 'object',
      required: ['action'],
      properties: {
        action:     { type: 'string', enum: ['create', 'update', 'deactivate'] },
        staffId:    { type: 'string', description: 'Required for update/deactivate' },
        name:       { type: 'string' },
        email:      { type: 'string', description: 'Optional — operational staff rows may omit' },
        role:       { type: 'string', enum: ['cashier', 'kitchen', 'runner', 'supervisor'] },
        phone:      { type: 'string' },
        updates:    { type: 'object', description: 'Fields to update (for action=update)' },
        operatorId: { type: 'string' },
      },
    },
    async handler(input) {
      checkPermission('admin', 'manage_staff');
      const db = await getAdminFirestore();

      if (input.action === 'create') {
        const v = validateCreateStaff(input);
        if (!v.valid) return fail(v.error);

        const ref = db.collection(COL.STAFF).doc();
        const doc = {
          name:      input.name,
          email:     input.email != null && String(input.email).trim() !== '' ? String(input.email).trim() : null,
          role:      input.role,
          phone:     input.phone ?? null,
          isActive:  true,
          createdAt: ts(),
          createdBy: 'MCP_AGENT',
        };
        await ref.set(doc);
        await auditLog({
          action: 'manage_staff:create', status: 'success',
          targetId: ref.id, targetCollection: COL.STAFF,
          payload: { name: input.name, role: input.role }, operatorId: input.operatorId,
        });
        return ok({ staffId: ref.id, name: input.name, role: input.role });
      }

      if (input.action === 'update') {
        const v = validateUpdateStaff({ staffId: input.staffId, updates: input.updates });
        if (!v.valid) return fail(v.error);
        const ref = db.collection(COL.STAFF).doc(input.staffId);
        if (!(await ref.get()).exists) return fail(`Staff '${input.staffId}' not found`);
        await ref.update({ ...input.updates, updatedAt: ts(), updatedBy: 'MCP_AGENT' });
        await auditLog({
          action: 'manage_staff:update', status: 'success',
          targetId: input.staffId, targetCollection: COL.STAFF,
          payload: input.updates, operatorId: input.operatorId,
        });
        return ok({ staffId: input.staffId, updated: input.updates });
      }

      if (input.action === 'deactivate') {
        if (!input.staffId) return fail('staffId is required for deactivate');
        const ref = db.collection(COL.STAFF).doc(input.staffId);
        if (!(await ref.get()).exists) return fail(`Staff '${input.staffId}' not found`);
        await ref.update({ isActive: false, deactivatedAt: ts(), deactivatedBy: 'MCP_AGENT' });
        await auditLog({
          action: 'manage_staff:deactivate', status: 'success',
          targetId: input.staffId, targetCollection: COL.STAFF,
          payload: {}, operatorId: input.operatorId,
        });
        return ok({ staffId: input.staffId, isActive: false });
      }

      return fail(`Unknown action '${input.action}'`);
    },
  },

  // ── 2. delete_document ────────────────────────────────────────────────────
  {
    name: 'delete_document',
    description:
      'Hard-delete a document from an allowed collection. ' +
      'CAUTION: irreversible. NOT allowed for POS financial records.',
    inputSchema: {
      type: 'object',
      required: ['collection', 'docId', 'reason'],
      properties: {
        collection: { type: 'string' },
        docId:      { type: 'string' },
        reason:     { type: 'string', description: 'Mandatory reason for deletion (min 10 chars)' },
        operatorId: { type: 'string' },
      },
    },
    async handler(input) {
      checkPermission('admin', 'delete_document');

      if (!isSafeFirestoreSegment(input.docId))
        return fail('docId must be a single segment (no "/" or "..")');

      // Extra protection when not in full-access mode
      if (!isFullFirestoreAccessEnabled()) {
        const neverDelete = [
          'pos_sales_transactions', 'pos_receipts', 'sales',
          'pos_orders', 'users', 'pos_meta', 'monthly_reports',
        ];
        if (neverDelete.includes(input.collection))
          return fail(`Collection '${input.collection}' cannot be deleted via MCP for data integrity.`);
      }

      const cv = validateWritableCollection(input.collection);
      if (!cv.valid) return fail(cv.error);

      if (!input.reason || input.reason.trim().length < 10)
        return fail('reason must be at least 10 characters');

      const db  = await getAdminFirestore();
      const ref = db.collection(input.collection).doc(input.docId);
      const existing = await ref.get();
      if (!existing.exists) return fail(`Document '${input.docId}' not found in '${input.collection}'`);

      // Soft-log the deleted data before removing
      const deletedData = existing.data();
      await ref.delete();

      await auditLog({
        action: 'delete_document', status: 'success',
        targetId: input.docId, targetCollection: input.collection,
        payload: { reason: input.reason, deletedSnapshot: deletedData },
        operatorId: input.operatorId,
      });

      return ok({ deleted: true, docId: input.docId, collection: input.collection });
    },
  },

  // ── 3. void_receipt ───────────────────────────────────────────────────────
  {
    name: 'void_receipt',
    description:
      'Mark a POS receipt as voided. Does NOT reverse FIFO stock (use stock adjustment separately). ' +
      'Replaces hardcoded PIN flow in pos-firestore-hub.js.',
    inputSchema: {
      type: 'object',
      required: ['receiptId', 'reason', 'operatorId'],
      properties: {
        receiptId:  { type: 'string' },
        reason:     { type: 'string', description: 'Min 10 characters' },
        operatorId: { type: 'string', description: 'Staff ID authorising the void' },
      },
    },
    async handler(input) {
      checkPermission('admin', 'void_receipt');
      const v = validateVoidReceipt(input);
      if (!v.valid) return fail(v.error);

      const db  = await getAdminFirestore();
      const ref = db.collection(COL.POS_RECEIPTS).doc(input.receiptId);
      const snap = await ref.get();
      if (!snap.exists) return fail(`Receipt '${input.receiptId}' not found`);
      if (snap.data().isVoided) return fail(`Receipt '${input.receiptId}' is already voided`);

      await ref.update({
        isVoided:   true,
        voidedAt:   ts(),
        voidReason: input.reason,
        voidedBy:   input.operatorId,
        voidSource: 'MCP_AGENT',
      });

      // Also update linked pos_order if any
      const saleId = snap.data().saleId;
      if (saleId) {
        const orderQuery = await db.collection(COL.POS_ORDERS)
          .where('saleId', '==', saleId).limit(1).get();
        if (!orderQuery.empty) {
          await orderQuery.docs[0].ref.update({ lifecycle: 'voided', updatedAt: ts() });
        }
      }

      await auditLog({
        action: 'void_receipt', status: 'success',
        targetId: input.receiptId, targetCollection: COL.POS_RECEIPTS,
        payload: { reason: input.reason }, operatorId: input.operatorId,
      });

      return ok({ receiptId: input.receiptId, isVoided: true });
    },
  },

  // ── 4. close_shift ────────────────────────────────────────────────────────
  {
    name: 'close_shift',
    description:
      'Force-close an open shift (admin override). ' +
      'Use only when normal shift close fails. Updates pos_shifts status.',
    inputSchema: {
      type: 'object',
      required: ['shiftId', 'operatorId', 'closingCash'],
      properties: {
        shiftId:     { type: 'string' },
        operatorId:  { type: 'string' },
        closingCash: { type: 'number', description: 'Closing cash amount (RM)' },
        notes:       { type: 'string' },
      },
    },
    async handler(input) {
      checkPermission('admin', 'close_shift');
      const v = validateCloseShift(input);
      if (!v.valid) return fail(v.error);

      const db = await getAdminFirestore();
      const ref = db.collection(COL.POS_SHIFTS).doc(input.shiftId);
      const snap = await ref.get();
      if (!snap.exists) return fail(`Shift '${input.shiftId}' not found`);
      const data = snap.data();
      if (data.status !== 'open') return fail(`Shift '${input.shiftId}' is not open`);

      const opening = roundRm(data.openingCash);
      const movSnap = await ref.collection(SUBCOL.CASH_MOVEMENTS).orderBy('createdAt', 'asc').get();
      let movNet = 0;
      movSnap.forEach((md) => {
        const m = md.data();
        const amt = roundRm(m.amount);
        movNet += m.type === 'out' ? -amt : amt;
      });

      const ordersSnap = await db.collection(COL.POS_ORDERS).where('shiftDocId', '==', input.shiftId).get();
      let cashSales = 0;
      ordersSnap.forEach((od) => {
        const o = od.data();
        if (o.lifecycle === 'cancelled') return;
        const pm = String(o.paymentMethod || '').toLowerCase();
        if (pm !== 'cash' && pm !== 'tunai') return;
        cashSales += roundRm(o.subtotal);
      });

      const expectedDrawer = roundRm(opening + cashSales + movNet);
      const actualDrawer = roundRm(input.closingCash);
      const variance = roundRm(actualDrawer - expectedDrawer);
      const varianceCategory = varianceCategoryFromRm(variance);

      const shiftCode = data.shiftCode || input.shiftId;
      const closing = {
        shiftId: shiftCode,
        closedAt: new Date().toISOString(),
        expectedDrawer,
        actualDrawer,
        variance,
        varianceCategory,
        closedBy: input.operatorId,
        notes: input.notes ?? 'MCP admin force-close',
        refundNotes: input.notes ?? '',
        source: 'MCP_AGENT',
        closingCash: actualDrawer,
        cashSales,
        movementsNet: movNet,
      };

      await ref.update({
        status: 'closed',
        closedAt: ts(),
        closing,
        updatedAt: ts(),
      });

      await auditLog({
        action: 'close_shift', status: 'success',
        targetId: input.shiftId, targetCollection: COL.POS_SHIFTS,
        payload: { actualDrawer, expectedDrawer, variance, varianceCategory, notes: input.notes },
        operatorId: input.operatorId,
      });

      return ok({ shiftId: input.shiftId, status: 'closed', closing });
    },
  },

  // ── 5. manage_inventory ───────────────────────────────────────────────────
  {
    name: 'manage_inventory',
    description:
      'Adjust ingredient stock manually (e.g. wastage, physical count correction). ' +
      'Creates an ingredient_ledger entry for traceability.',
    inputSchema: {
      type: 'object',
      required: ['ingredientId', 'adjustmentQty', 'reason'],
      properties: {
        ingredientId:  { type: 'string' },
        adjustmentQty: { type: 'number', description: 'Positive = add, Negative = deduct' },
        reason:        { type: 'string', enum: ['wastage', 'correction', 'spoilage', 'theft', 'audit'] },
        notes:         { type: 'string' },
        operatorId:    { type: 'string' },
      },
    },
    async handler(input) {
      checkPermission('admin', 'manage_inventory');
      if (!input.ingredientId)  return fail('ingredientId is required');
      if (typeof input.adjustmentQty !== 'number') return fail('adjustmentQty must be a number');
      if (!input.reason)        return fail('reason is required');

      const db = await getAdminFirestore();
      const ingRef = db.collection(COL.INGREDIENTS).doc(input.ingredientId);
      const snap   = await ingRef.get();
      if (!snap.exists) return fail(`Ingredient '${input.ingredientId}' not found`);

      const batch = db.batch();

      // Update currentStock
      batch.update(ingRef, {
        currentStock: FieldValue.increment(input.adjustmentQty),
        updatedAt:    ts(),
        updatedBy:    'MCP_AGENT',
      });

      // Create ledger entry
      const ledgerRef = db.collection(COL.INGREDIENT_LEDGER).doc();
      batch.set(ledgerRef, {
        ingredientId:  input.ingredientId,
        ingredientName: snap.data().name ?? 'Unknown',
        type:          input.adjustmentQty >= 0 ? 'adjustment_in' : 'adjustment_out',
        qty:           Math.abs(input.adjustmentQty),
        reason:        input.reason,
        notes:         input.notes ?? null,
        operatorId:    input.operatorId ?? 'mcp_agent',
        source:        'MCP_AGENT',
        createdAt:     ts(),
      });

      await batch.commit();

      await auditLog({
        action: 'manage_inventory', status: 'success',
        targetId: input.ingredientId, targetCollection: COL.INGREDIENTS,
        payload: { adjustmentQty: input.adjustmentQty, reason: input.reason },
        operatorId: input.operatorId,
      });

      return ok({
        ingredientId: input.ingredientId,
        adjustment:   input.adjustmentQty,
        ledgerEntryId: ledgerRef.id,
      });
    },
  },
];
