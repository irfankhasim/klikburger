/**
 * mcp/tools/write/index.mjs
 * Write tools — create and update only (no delete here).
 * All writes are validated + audited.
 * Requires MCP_PERMISSION_LEVEL=write or higher.
 *
 * Tools:
 *   update_menu_item, update_ingredient, add_purchase,
 *   update_order_status, create_document, update_document
 */

import { FieldValue } from 'firebase-admin/firestore';
import { getAdminFirestore } from '../../lib/admin-init.mjs';
import { COL } from '../../lib/collections.mjs';
import { auditLog } from '../../lib/audit-logger.mjs';
import { checkPermission } from '../../middleware/permission-gate.mjs';
import {
  validateUpdateMenuItem,
  validateUpdateIngredient,
  validateAddPurchase,
  validateUpdateOrderStatus,
  validateWritableCollection,
} from '../../lib/validators.mjs';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ts() { return FieldValue.serverTimestamp(); }

function resultOk(data)  { return { success: true,  ...data }; }
function resultErr(msg)  { return { success: false, error: msg }; }

// ─── Tool definitions ─────────────────────────────────────────────────────────

export const writeTools = [

  // ── 1. update_menu_item ───────────────────────────────────────────────────
  {
    name: 'update_menu_item',
    description: 'Update a menu item (name, price, category, isAvailable, description).',
    inputSchema: {
      type: 'object',
      required: ['menuItemId', 'updates'],
      properties: {
        menuItemId:  { type: 'string' },
        updates:     { type: 'object', description: 'Fields to update' },
        operatorId:  { type: 'string', description: 'Staff ID making the change' },
      },
    },
    async handler(input) {
      checkPermission('write', 'update_menu_item');
      const v = validateUpdateMenuItem(input);
      if (!v.valid) return resultErr(v.error);

      const db = await getAdminFirestore();
      const ref = db.collection(COL.MENU_ITEMS).doc(input.menuItemId);
      const existing = await ref.get();
      if (!existing.exists) return resultErr(`Menu item '${input.menuItemId}' not found`);

      const updateData = { ...input.updates, updatedAt: ts(), updatedBy: 'MCP_AGENT' };
      await ref.update(updateData);

      await auditLog({
        action: 'update_menu_item', status: 'success',
        targetId: input.menuItemId, targetCollection: COL.MENU_ITEMS,
        payload: input.updates, operatorId: input.operatorId,
      });

      return resultOk({ menuItemId: input.menuItemId, updated: input.updates });
    },
  },

  // ── 2. update_ingredient ──────────────────────────────────────────────────
  {
    name: 'update_ingredient',
    description: 'Update an ingredient (name, unit, reorderLevel, costPerUnit, category).',
    inputSchema: {
      type: 'object',
      required: ['ingredientId', 'updates'],
      properties: {
        ingredientId: { type: 'string' },
        updates:      { type: 'object' },
        operatorId:   { type: 'string' },
      },
    },
    async handler(input) {
      checkPermission('write', 'update_ingredient');
      const v = validateUpdateIngredient(input);
      if (!v.valid) return resultErr(v.error);

      const db  = await getAdminFirestore();
      const ref = db.collection(COL.INGREDIENTS).doc(input.ingredientId);
      if (!(await ref.get()).exists) return resultErr(`Ingredient '${input.ingredientId}' not found`);

      await ref.update({ ...input.updates, updatedAt: ts(), updatedBy: 'MCP_AGENT' });

      await auditLog({
        action: 'update_ingredient', status: 'success',
        targetId: input.ingredientId, targetCollection: COL.INGREDIENTS,
        payload: input.updates, operatorId: input.operatorId,
      });

      return resultOk({ ingredientId: input.ingredientId, updated: input.updates });
    },
  },

  // ── 3. add_purchase ───────────────────────────────────────────────────────
  {
    name: 'add_purchase',
    description:
      'Record a new ingredient purchase batch. Creates purchase_history + ingredient_batches entries.',
    inputSchema: {
      type: 'object',
      required: ['ingredientId', 'ingredientName', 'quantity', 'costPerUnit', 'unit', 'supplierName'],
      properties: {
        ingredientId:   { type: 'string' },
        ingredientName: { type: 'string' },
        quantity:       { type: 'number' },
        costPerUnit:    { type: 'number' },
        unit:           { type: 'string' },
        supplierName:   { type: 'string' },
        invoiceNo:      { type: 'string' },
        notes:          { type: 'string' },
        operatorId:     { type: 'string' },
      },
    },
    async handler(input) {
      checkPermission('write', 'add_purchase');
      const v = validateAddPurchase(input);
      if (!v.valid) return resultErr(v.error);

      const db = await getAdminFirestore();
      const totalCost = +(input.quantity * input.costPerUnit).toFixed(2);

      // Firestore batch: purchase_history + ingredient_batches
      const batch = db.batch();
      const purchaseRef = db.collection(COL.PURCHASE_HISTORY).doc();
      const batchRef    = db.collection(COL.INGREDIENT_BATCHES).doc();

      const purchaseDoc = {
        ingredientId:   input.ingredientId,
        ingredientName: input.ingredientName,
        quantity:       input.quantity,
        unit:           input.unit,
        costPerUnit:    input.costPerUnit,
        totalCost,
        supplierName:   input.supplierName,
        invoiceNo:      input.invoiceNo ?? null,
        notes:          input.notes ?? null,
        batchId:        batchRef.id,
        createdAt:      ts(),
        createdBy:      'MCP_AGENT',
        operatorId:     input.operatorId ?? null,
      };

      const batchDoc = {
        ingredientId:   input.ingredientId,
        ingredientName: input.ingredientName,
        purchaseId:     purchaseRef.id,
        quantity:       input.quantity,
        remainingQty:   input.quantity,
        unit:           input.unit,
        costPerUnit:    input.costPerUnit,
        isExhausted:    false,
        createdAt:      ts(),
      };

      batch.set(purchaseRef, purchaseDoc);
      batch.set(batchRef, batchDoc);

      // Increment ingredient currentStock
      const ingRef = db.collection(COL.INGREDIENTS).doc(input.ingredientId);
      batch.update(ingRef, { currentStock: FieldValue.increment(input.quantity), updatedAt: ts() });

      await batch.commit();

      await auditLog({
        action: 'add_purchase', status: 'success',
        targetId: purchaseRef.id, targetCollection: COL.PURCHASE_HISTORY,
        payload: { ingredientId: input.ingredientId, quantity: input.quantity, totalCost },
        operatorId: input.operatorId,
      });

      return resultOk({ purchaseId: purchaseRef.id, batchId: batchRef.id, totalCost });
    },
  },

  // ── 4. update_order_status ────────────────────────────────────────────────
  {
    name: 'update_order_status',
    description: 'Update a POS order kitchenStage or lifecycle status.',
    inputSchema: {
      type: 'object',
      required: ['orderId', 'status'],
      properties: {
        orderId:     { type: 'string' },
        status:      { type: 'string', enum: ['pending', 'preparing', 'ready', 'completed', 'cancelled'] },
        field:       { type: 'string', enum: ['kitchenStage', 'lifecycle'], default: 'kitchenStage' },
        operatorId:  { type: 'string' },
      },
    },
    async handler(input) {
      checkPermission('write', 'update_order_status');
      const v = validateUpdateOrderStatus(input);
      if (!v.valid) return resultErr(v.error);

      const db  = await getAdminFirestore();
      const ref = db.collection(COL.POS_ORDERS).doc(input.orderId);
      if (!(await ref.get()).exists) return resultErr(`Order '${input.orderId}' not found`);

      const field = input.field ?? 'kitchenStage';
      await ref.update({ [field]: input.status, updatedAt: ts() });

      await auditLog({
        action: 'update_order_status', status: 'success',
        targetId: input.orderId, targetCollection: COL.POS_ORDERS,
        payload: { [field]: input.status }, operatorId: input.operatorId,
      });

      return resultOk({ orderId: input.orderId, [field]: input.status });
    },
  },

  // ── 5. create_document ────────────────────────────────────────────────────
  {
    name: 'create_document',
    description:
      'Generic: create a new document in an allowed collection. ' +
      'NOT allowed for: users, pos_meta, pos_sales_transactions, pos_receipts.',
    inputSchema: {
      type: 'object',
      required: ['collection', 'data'],
      properties: {
        collection: { type: 'string', description: 'Firestore collection name' },
        data:       { type: 'object', description: 'Document fields' },
        docId:      { type: 'string', description: 'Optional custom doc ID' },
        operatorId: { type: 'string' },
      },
    },
    async handler(input) {
      checkPermission('write', 'create_document');
      const cv = validateWritableCollection(input.collection);
      if (!cv.valid) return resultErr(cv.error);
      if (!input.data || typeof input.data !== 'object')
        return resultErr('data must be a non-empty object');

      const db  = await getAdminFirestore();
      const col = db.collection(input.collection);
      const ref = input.docId ? col.doc(input.docId) : col.doc();

      const doc = { ...input.data, createdAt: ts(), createdBy: 'MCP_AGENT' };
      await ref.set(doc);

      await auditLog({
        action: 'create_document', status: 'success',
        targetId: ref.id, targetCollection: input.collection,
        payload: input.data, operatorId: input.operatorId,
      });

      return resultOk({ docId: ref.id, collection: input.collection });
    },
  },

  // ── 6. update_document ────────────────────────────────────────────────────
  {
    name: 'update_document',
    description:
      'Generic: update fields on an existing document in an allowed collection.',
    inputSchema: {
      type: 'object',
      required: ['collection', 'docId', 'updates'],
      properties: {
        collection: { type: 'string' },
        docId:      { type: 'string' },
        updates:    { type: 'object' },
        operatorId: { type: 'string' },
      },
    },
    async handler(input) {
      checkPermission('write', 'update_document');
      const cv = validateWritableCollection(input.collection);
      if (!cv.valid) return resultErr(cv.error);
      if (!input.updates || typeof input.updates !== 'object' || Object.keys(input.updates).length === 0)
        return resultErr('updates must be a non-empty object');

      const db  = await getAdminFirestore();
      const ref = db.collection(input.collection).doc(input.docId);
      if (!(await ref.get()).exists)
        return resultErr(`Document '${input.docId}' not found in '${input.collection}'`);

      await ref.update({ ...input.updates, updatedAt: ts(), updatedBy: 'MCP_AGENT' });

      await auditLog({
        action: 'update_document', status: 'success',
        targetId: input.docId, targetCollection: input.collection,
        payload: input.updates, operatorId: input.operatorId,
      });

      return resultOk({ docId: input.docId, collection: input.collection });
    },
  },
];
