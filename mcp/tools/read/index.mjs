/**
 * mcp/tools/read/index.mjs
 * All READ tools for KLik Burger MCP.
 * Safe — no writes, no side effects.
 * 
 * Tools:
 *   get_menu_items, get_orders, get_staff_list, get_sales_summary,
 *   get_ingredients, get_shifts, get_receipts, get_audit_logs,
 *   get_monthly_report, get_inventory_status, get_staff_by_id,
 *   get_order_by_id, get_dashboard_summary
 */

import { getAdminFirestore } from '../../lib/admin-init.mjs';
import { COL, SUBCOL, META_DOC } from '../../lib/collections.mjs';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toJson(snap) {
  if (!snap) return null;
  return { id: snap.id, ...snap.data() };
}

function snapToArray(querySnap) {
  return querySnap.docs.map(d => ({ id: d.id, ...d.data() }));
}

function serializeDates(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v.toDate === 'function') {
      out[k] = v.toDate().toISOString();
    } else if (Array.isArray(v)) {
      out[k] = v.map(serializeDates);
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = serializeDates(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function serialize(items) {
  if (Array.isArray(items)) return items.map(serializeDates);
  return serializeDates(items);
}

// ─── Tool definitions ─────────────────────────────────────────────────────────

export const readTools = [

  // ── 1. get_menu_items ──────────────────────────────────────────────────────
  {
    name: 'get_menu_items',
    description: 'Get all menu items. Optional: filter by category or availability.',
    inputSchema: {
      type: 'object',
      properties: {
        category:    { type: 'string', description: 'Filter by category name' },
        isAvailable: { type: 'boolean', description: 'Filter by availability' },
        limit:       { type: 'number', description: 'Max results (default 50)' },
      },
    },
    async handler(input) {
      const db = await getAdminFirestore();
      let q = db.collection(COL.MENU_ITEMS);
      if (input?.category)              q = q.where('category', '==', input.category);
      if (input?.isAvailable !== undefined) q = q.where('isAvailable', '==', input.isAvailable);
      q = q.limit(input?.limit ?? 50);
      const snap = await q.get();
      const items = serialize(snapToArray(snap));
      return { count: items.length, items };
    },
  },

  // ── 2. get_orders ──────────────────────────────────────────────────────────
  {
    name: 'get_orders',
    description: 'Get POS orders. Filter by lifecycle, kitchen stage, date range, or shift.',
    inputSchema: {
      type: 'object',
      properties: {
        lifecycle:    { type: 'string', enum: ['open', 'closed', 'voided'] },
        kitchenStage: { type: 'string' },
        shiftDocId:   { type: 'string' },
        limit:        { type: 'number', description: 'Max results (default 30)' },
        dateFrom:     { type: 'string', description: 'ISO date string' },
        dateTo:       { type: 'string', description: 'ISO date string' },
      },
    },
    async handler(input) {
      const db = await getAdminFirestore();
      let q = db.collection(COL.POS_ORDERS).orderBy('createdAt', 'desc');
      if (input?.lifecycle)    q = q.where('lifecycle', '==', input.lifecycle);
      if (input?.kitchenStage) q = q.where('kitchenStage', '==', input.kitchenStage);
      if (input?.shiftDocId)   q = q.where('shiftDocId', '==', input.shiftDocId);
      if (input?.dateFrom)     q = q.where('createdAt', '>=', new Date(input.dateFrom));
      if (input?.dateTo)       q = q.where('createdAt', '<=', new Date(input.dateTo));
      q = q.limit(input?.limit ?? 30);
      const snap = await q.get();
      const orders = serialize(snapToArray(snap));
      return { count: orders.length, orders };
    },
  },

  // ── 3. get_order_by_id ────────────────────────────────────────────────────
  {
    name: 'get_order_by_id',
    description: 'Get a single order with its line items subcollection.',
    inputSchema: {
      type: 'object',
      required: ['orderId'],
      properties: {
        orderId: { type: 'string' },
      },
    },
    async handler(input) {
      const db = await getAdminFirestore();
      const ref = db.collection(COL.POS_ORDERS).doc(input.orderId);
      const [snap, itemsSnap] = await Promise.all([
        ref.get(),
        ref.collection(SUBCOL.ORDER_ITEMS).get(),
      ]);
      if (!snap.exists) return { error: `Order '${input.orderId}' not found` };
      const order = serialize(toJson(snap));
      order.items = serialize(snapToArray(itemsSnap));
      return { order };
    },
  },

  // ── 4. get_staff_list ────────────────────────────────────────────────────
  {
    name: 'get_staff_list',
    description: 'Get all staff. Filter by role or active status.',
    inputSchema: {
      type: 'object',
      properties: {
        role:     { type: 'string', enum: ['OWNER', 'ADMIN', 'SHIFT_LEAD', 'CASHIER'] },
        isActive: { type: 'boolean' },
      },
    },
    async handler(input) {
      const db = await getAdminFirestore();
      let q = db.collection(COL.STAFF);
      if (input?.role)     q = q.where('role', '==', input.role);
      if (input?.isActive !== undefined) q = q.where('isActive', '==', input.isActive);
      const snap = await q.get();
      // Sanitize: remove sensitive fields before returning
      const staff = serialize(snapToArray(snap)).map(s => {
        const { pin, password, ...safe } = s;
        return safe;
      });
      return { count: staff.length, staff };
    },
  },

  // ── 5. get_staff_by_id ────────────────────────────────────────────────────
  {
    name: 'get_staff_by_id',
    description: 'Get a single staff member by Firestore document ID.',
    inputSchema: {
      type: 'object',
      required: ['staffId'],
      properties: {
        staffId: { type: 'string' },
      },
    },
    async handler(input) {
      const db = await getAdminFirestore();
      const snap = await db.collection(COL.STAFF).doc(input.staffId).get();
      if (!snap.exists) return { error: `Staff '${input.staffId}' not found` };
      const { pin, password, ...safe } = toJson(snap);
      return { staff: serialize(safe) };
    },
  },

  // ── 6. get_sales_summary ─────────────────────────────────────────────────
  {
    name: 'get_sales_summary',
    description: 'Get sales summary. Filter by date range or staff.',
    inputSchema: {
      type: 'object',
      properties: {
        dateFrom: { type: 'string', description: 'ISO date' },
        dateTo:   { type: 'string', description: 'ISO date' },
        staffId:  { type: 'string' },
        limit:    { type: 'number', default: 50 },
      },
    },
    async handler(input) {
      const db = await getAdminFirestore();
      let q = db.collection(COL.SALES).orderBy('createdAt', 'desc');
      if (input?.staffId)  q = q.where('staffId', '==', input.staffId);
      if (input?.dateFrom) q = q.where('createdAt', '>=', new Date(input.dateFrom));
      if (input?.dateTo)   q = q.where('createdAt', '<=', new Date(input.dateTo));
      q = q.limit(input?.limit ?? 50);
      const snap = await q.get();
      const sales = serialize(snapToArray(snap));
      const totalRevenue = sales.reduce((s, x) => s + (x.subtotal ?? 0), 0);
      const totalCOGS    = sales.reduce((s, x) => s + (x.totalCogsFifo ?? 0), 0);
      const totalProfit  = sales.reduce((s, x) => s + (x.totalGrossProfitFifo ?? 0), 0);
      return {
        count: sales.length,
        summary: {
          totalRevenue: +totalRevenue.toFixed(2),
          totalCOGS:    +totalCOGS.toFixed(2),
          totalProfit:  +totalProfit.toFixed(2),
          profitMargin: totalRevenue > 0
            ? +((totalProfit / totalRevenue) * 100).toFixed(2)
            : 0,
        },
        sales,
      };
    },
  },

  // ── 7. get_ingredients ────────────────────────────────────────────────────
  {
    name: 'get_ingredients',
    description: 'Get ingredients. Optional filter by category or low-stock flag.',
    inputSchema: {
      type: 'object',
      properties: {
        category:  { type: 'string' },
        lowStock:  { type: 'boolean', description: 'Only ingredients below reorder level' },
        limit:     { type: 'number', default: 100 },
      },
    },
    async handler(input) {
      const db = await getAdminFirestore();
      let q = db.collection(COL.INGREDIENTS).limit(input?.limit ?? 100);
      if (input?.category) q = q.where('category', '==', input.category);
      const snap = await q.get();
      let items = serialize(snapToArray(snap));
      if (input?.lowStock) {
        items = items.filter(i =>
          i.reorderLevel !== undefined && (i.currentStock ?? 0) < i.reorderLevel
        );
      }
      return { count: items.length, ingredients: items };
    },
  },

  // ── 8. get_inventory_status ───────────────────────────────────────────────
  {
    name: 'get_inventory_status',
    description: 'Get full inventory status including batches and ledger summary.',
    inputSchema: { type: 'object', properties: {} },
    async handler() {
      const db = await getAdminFirestore();
      const [ingSnap, batchSnap] = await Promise.all([
        db.collection(COL.INGREDIENTS).get(),
        db.collection(COL.INGREDIENT_BATCHES).get(),
      ]);
      const ingredients = serialize(snapToArray(ingSnap));
      const batchesRaw  = snapToArray(batchSnap);
      const batches = serialize(
        batchesRaw.filter((b) => {
          const q = typeof b.qtyRemaining === 'number' ? b.qtyRemaining : parseFloat(b.qtyRemaining);
          return !Number.isNaN(q) && q > 0;
        })
      );
      const stockByIng = {};
      for (const b of batchesRaw) {
        const iid = String(b.ingredientId || '');
        if (!iid) continue;
        const q = typeof b.qtyRemaining === 'number' ? b.qtyRemaining : parseFloat(b.qtyRemaining) || 0;
        if (q <= 0) continue;
        stockByIng[iid] = (stockByIng[iid] || 0) + q;
      }
      const lowStock = ingredients.filter((i) => {
        const min = typeof i.minStockQty === 'number' ? i.minStockQty : parseFloat(i.minStockQty);
        if (min == null || Number.isNaN(min) || min <= 0) return false;
        return (stockByIng[i.id] ?? 0) < min;
      });
      return {
        totalIngredients: ingredients.length,
        activeBatches:    batches.length,
        lowStockCount:    lowStock.length,
        lowStockItems:    lowStock.map((i) => ({
          id: i.id,
          name: i.name,
          stockFromBatches: +(stockByIng[i.id] ?? 0).toFixed(4),
          minStockQty: i.minStockQty,
          unit: i.unit,
        })),
        ingredients,
        batches,
      };
    },
  },

  // ── 9. get_shifts ─────────────────────────────────────────────────────────
  {
    name: 'get_shifts',
    description: 'Get POS shifts. Filter by status or date.',
    inputSchema: {
      type: 'object',
      properties: {
        status:   { type: 'string', enum: ['open', 'closed'] },
        dateFrom: { type: 'string' },
        dateTo:   { type: 'string' },
        limit:    { type: 'number', default: 20 },
      },
    },
    async handler(input) {
      const db = await getAdminFirestore();
      let q = db.collection(COL.POS_SHIFTS).orderBy('openedAt', 'desc');
      if (input?.status)   q = q.where('status', '==', input.status);
      if (input?.dateFrom) q = q.where('openedAt', '>=', new Date(input.dateFrom));
      if (input?.dateTo)   q = q.where('openedAt', '<=', new Date(input.dateTo));
      q = q.limit(input?.limit ?? 20);
      const snap = await q.get();
      return { count: snap.size, shifts: serialize(snapToArray(snap)) };
    },
  },

  // ── 10. get_receipts ──────────────────────────────────────────────────────
  {
    name: 'get_receipts',
    description: 'Get POS receipts. Filter by date, staff, or void status.',
    inputSchema: {
      type: 'object',
      properties: {
        isVoided: { type: 'boolean' },
        staffId:  { type: 'string' },
        dateFrom: { type: 'string' },
        dateTo:   { type: 'string' },
        limit:    { type: 'number', default: 30 },
      },
    },
    async handler(input) {
      const db = await getAdminFirestore();
      let q = db.collection(COL.POS_RECEIPTS).orderBy('createdAt', 'desc');
      if (input?.isVoided !== undefined) q = q.where('isVoided', '==', input.isVoided);
      if (input?.staffId) q = q.where('staffId', '==', input.staffId);
      if (input?.dateFrom) q = q.where('createdAt', '>=', new Date(input.dateFrom));
      if (input?.dateTo)   q = q.where('createdAt', '<=', new Date(input.dateTo));
      q = q.limit(input?.limit ?? 30);
      const snap = await q.get();
      return { count: snap.size, receipts: serialize(snapToArray(snap)) };
    },
  },

  // ── 11. get_audit_logs ────────────────────────────────────────────────────
  {
    name: 'get_audit_logs',
    description: 'Get audit log entries. Filter by action, source, or date.',
    inputSchema: {
      type: 'object',
      properties: {
        action:   { type: 'string' },
        source:   { type: 'string' },
        dateFrom: { type: 'string' },
        limit:    { type: 'number', default: 50 },
      },
    },
    async handler(input) {
      const db = await getAdminFirestore();
      let q = db.collection(COL.POS_AUDIT_LOGS).orderBy('timestamp', 'desc');
      if (input?.action) q = q.where('action', '==', input.action);
      if (input?.source) q = q.where('source', '==', input.source);
      if (input?.dateFrom) q = q.where('timestamp', '>=', new Date(input.dateFrom));
      q = q.limit(input?.limit ?? 50);
      const snap = await q.get();
      return { count: snap.size, logs: serialize(snapToArray(snap)) };
    },
  },

  // ── 12. get_monthly_report ────────────────────────────────────────────────
  {
    name: 'get_monthly_report',
    description: 'Get a monthly report by YYYY-MM. Lists available months if no input.',
    inputSchema: {
      type: 'object',
      properties: {
        yearMonth: { type: 'string', description: 'Format: YYYY-MM e.g. 2025-01' },
      },
    },
    async handler(input) {
      const db = await getAdminFirestore();
      if (!input?.yearMonth) {
        const snap = await db.collection(COL.MONTHLY_REPORTS)
          .orderBy('__name__', 'desc').limit(24).get();
        return { availableMonths: snap.docs.map(d => d.id) };
      }
      const snap = await db.collection(COL.MONTHLY_REPORTS).doc(input.yearMonth).get();
      if (!snap.exists) return { error: `No report found for ${input.yearMonth}` };
      return { report: serialize(toJson(snap)) };
    },
  },

  // ── 13. get_dashboard_summary ─────────────────────────────────────────────
  {
    name: 'get_dashboard_summary',
    description: 'Get a high-level dashboard: active shift, today sales, low stock count, recent orders.',
    inputSchema: { type: 'object', properties: {} },
    async handler() {
      const db = await getAdminFirestore();
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const [metaSnap, salesSnap, lowStockSnap, ordersSnap, openShiftSnap] =
        await Promise.all([
          db.collection(COL.POS_META).doc(META_DOC.COUNTERS).get(),
          db.collection(COL.SALES).where('createdAt', '>=', todayStart).get(),
          db.collection(COL.INGREDIENTS).get(),
          db.collection(COL.POS_ORDERS).orderBy('createdAt', 'desc').limit(5).get(),
          db.collection(COL.POS_SHIFTS).where('status', '==', 'open').limit(1).get(),
        ]);

      const meta       = metaSnap.exists ? metaSnap.data() : {};
      const sales      = snapToArray(salesSnap);
      const ingAll     = snapToArray(lowStockSnap);
      const lowStock   = ingAll.filter(i =>
        i.reorderLevel !== undefined && (i.currentStock ?? 0) < i.reorderLevel
      );
      const todayRevenue = sales.reduce((s, x) => s + (x.subtotal ?? 0), 0);
      const todayProfit  = sales.reduce((s, x) => s + (x.totalGrossProfitFifo ?? 0), 0);
      const recentOrders = serialize(snapToArray(ordersSnap));
      const activeShift  = openShiftSnap.empty ? null : serialize(toJson(openShiftSnap.docs[0]));

      return {
        activeShift,
        today: {
          salesCount:   sales.length,
          revenue:      +todayRevenue.toFixed(2),
          grossProfit:  +todayProfit.toFixed(2),
        },
        inventory: { lowStockCount: lowStock.length },
        pos: {
          activeShiftDocId: meta.activeShiftDocId ?? null,
          seqOrder:         meta.seqOrder ?? null,
          seqReceipt:       meta.seqReceipt ?? null,
        },
        recentOrders,
      };
    },
  },
];
