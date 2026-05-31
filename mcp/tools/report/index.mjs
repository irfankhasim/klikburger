/**
 * mcp/tools/report/index.mjs
 * Report and analytics tools.
 * Requires MCP_PERMISSION_LEVEL=admin or higher for generation;
 * read-only reports stay at 'read' level.
 *
 * Tools:
 *   generate_monthly_report,
 *   get_sales_analytics,
 *   get_staff_performance,
 *   get_cogs_report
 */

import { getAdminFirestore } from '../../lib/admin-init.mjs';
import { COL } from '../../lib/collections.mjs';
import { auditLog } from '../../lib/audit-logger.mjs';
import { checkPermission } from '../../middleware/permission-gate.mjs';
import { validateMonthlyReport } from '../../lib/validators.mjs';
import { writeMonthlyReportAdmin } from '../../lib/monthly-report-generate-admin.mjs';

function ok(data)  { return { success: true,  ...data }; }
function fail(msg) { return { success: false, error: msg }; }

function snapToArray(snap) { return snap.docs.map(d => ({ id: d.id, ...d.data() })); }

function serializeDates(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v.toDate === 'function') out[k] = v.toDate().toISOString();
    else if (Array.isArray(v)) out[k] = v.map(serializeDates);
    else if (v && typeof v === 'object') out[k] = serializeDates(v);
    else out[k] = v;
  }
  return out;
}

export const reportTools = [

  // ── 1. generate_monthly_report ────────────────────────────────────────────
  {
    name: 'generate_monthly_report',
    description:
      'Generate (or regenerate) a monthly report for YYYY-MM. ' +
      'Same aggregation as web BO `js/monthly-reports/generate-monthly-report.js` (pos_receipts, purchase_history, ' +
      'ingredient_ledger, staff, pos_shifts closed in month, legacy sales). Writes full `monthly_reports/{YYYY-MM}` document.',
    inputSchema: {
      type: 'object',
      required: ['yearMonth'],
      properties: {
        yearMonth:  { type: 'string', description: 'Format: YYYY-MM e.g. 2025-06' },
        operatorId: { type: 'string' },
        force:      { type: 'boolean', description: 'Overwrite existing report' },
      },
    },
    async handler(input) {
      checkPermission('admin', 'generate_monthly_report');
      const v = validateMonthlyReport(input);
      if (!v.valid) return fail(v.error);

      const db = await getAdminFirestore();
      const reportRef = db.collection(COL.MONTHLY_REPORTS).doc(input.yearMonth);
      const existing = await reportRef.get();
      if (existing.exists && !input.force) {
        return fail(`Report for ${input.yearMonth} already exists. Pass force:true to overwrite.`);
      }

      await writeMonthlyReportAdmin(db, input.yearMonth, {
        source: 'mcp_generate_monthly_report',
        actorUid: input.operatorId != null ? String(input.operatorId) : '',
      });

      const written = await reportRef.get();
      const data = written.data() || {};

      await auditLog({
        action: 'generate_monthly_report',
        status: 'success',
        targetId: input.yearMonth,
        targetCollection: COL.MONTHLY_REPORTS,
        payload: {
          nonVoidReceiptCount: data.sales?.nonVoidReceiptCount ?? 0,
          grossSalesSubtotalRm: data.sales?.grossSalesSubtotalRm ?? 0,
          closedShiftsInRange: data.cashDrawer?.closedShiftsInRange ?? 0,
        },
        operatorId: input.operatorId,
      });

      return ok({
        yearMonth: input.yearMonth,
        report: serializeDates(data),
      });
    },
  },

  // ── 2. get_sales_analytics ────────────────────────────────────────────────
  {
    name: 'get_sales_analytics',
    description: 'Get detailed sales analytics for a date range: top items, hourly breakdown, payment methods.',
    inputSchema: {
      type: 'object',
      required: ['dateFrom', 'dateTo'],
      properties: {
        dateFrom: { type: 'string', description: 'ISO date e.g. 2025-06-01' },
        dateTo:   { type: 'string', description: 'ISO date e.g. 2025-06-30' },
      },
    },
    async handler(input) {
      const db = await getAdminFirestore();
      const from = new Date(input.dateFrom);
      const to   = new Date(input.dateTo);
      to.setHours(23, 59, 59);

      const [salesSnap, ordersSnap] = await Promise.all([
        db.collection(COL.SALES).where('createdAt', '>=', from).where('createdAt', '<=', to).get(),
        db.collection(COL.POS_ORDERS).where('createdAt', '>=', from).where('createdAt', '<=', to).get(),
      ]);

      const sales  = snapToArray(salesSnap);
      const orders = snapToArray(ordersSnap);

      // Hourly breakdown
      const hourly = Array(24).fill(0).map((_, h) => ({ hour: h, count: 0, revenue: 0 }));
      for (const s of sales) {
        const d = s.createdAt?.toDate?.() ?? new Date(s.createdAt);
        const h = d.getHours();
        hourly[h].count++;
        hourly[h].revenue += s.subtotal ?? 0;
      }

      // Payment method breakdown
      const paymentMethods = {};
      for (const o of orders) {
        const pm = o.paymentMethod ?? 'unknown';
        if (!paymentMethods[pm]) paymentMethods[pm] = { count: 0, total: 0 };
        paymentMethods[pm].count++;
        paymentMethods[pm].total += o.subtotal ?? 0;
      }

      // Item frequency from sales lines
      const itemFreq = {};
      for (const s of sales) {
        for (const line of s.lines ?? []) {
          const key = line.menuItemId ?? line.name ?? 'unknown';
          if (!itemFreq[key]) itemFreq[key] = { name: line.name ?? key, qty: 0, revenue: 0 };
          itemFreq[key].qty     += line.qty ?? 0;
          itemFreq[key].revenue += (line.qty ?? 0) * (line.unitPrice ?? 0);
        }
      }
      const topItems = Object.values(itemFreq).sort((a, b) => b.qty - a.qty).slice(0, 10);

      return {
        period:       { from: from.toISOString(), to: to.toISOString() },
        salesCount:   sales.length,
        totalRevenue: +sales.reduce((s, x) => s + (x.subtotal ?? 0), 0).toFixed(2),
        totalCOGS:    +sales.reduce((s, x) => s + (x.totalCogsFifo ?? 0), 0).toFixed(2),
        hourlyBreakdown: hourly,
        paymentMethods,
        topItems,
      };
    },
  },

  // ── 3. get_staff_performance ──────────────────────────────────────────────
  {
    name: 'get_staff_performance',
    description: 'Get staff performance metrics: sales count, revenue, shifts worked for a period.',
    inputSchema: {
      type: 'object',
      required: ['dateFrom', 'dateTo'],
      properties: {
        dateFrom:  { type: 'string' },
        dateTo:    { type: 'string' },
        staffId:   { type: 'string', description: 'Filter by specific staff' },
      },
    },
    async handler(input) {
      const db   = await getAdminFirestore();
      const from = new Date(input.dateFrom);
      const to   = new Date(input.dateTo); to.setHours(23, 59, 59);

      let salesQ = db.collection(COL.SALES).where('createdAt', '>=', from).where('createdAt', '<=', to);
      if (input.staffId) salesQ = salesQ.where('staffId', '==', input.staffId);
      const salesSnap = await salesQ.get();
      const sales = snapToArray(salesSnap);

      const perf = {};
      for (const s of sales) {
        const sid = s.staffId ?? 'unknown';
        if (!perf[sid]) perf[sid] = { staffId: sid, staffName: s.staffName ?? sid, salesCount: 0, totalRevenue: 0, totalProfit: 0 };
        perf[sid].salesCount++;
        perf[sid].totalRevenue += s.subtotal ?? 0;
        perf[sid].totalProfit  += s.totalGrossProfitFifo ?? 0;
      }

      for (const p of Object.values(perf)) {
        p.totalRevenue = +p.totalRevenue.toFixed(2);
        p.totalProfit  = +p.totalProfit.toFixed(2);
        p.avgSaleValue = p.salesCount > 0 ? +(p.totalRevenue / p.salesCount).toFixed(2) : 0;
      }

      return {
        period:      { from: from.toISOString(), to: to.toISOString() },
        staffCount:  Object.keys(perf).length,
        performance: Object.values(perf).sort((a, b) => b.totalRevenue - a.totalRevenue),
      };
    },
  },

  // ── 4. get_cogs_report ────────────────────────────────────────────────────
  {
    name: 'get_cogs_report',
    description: 'Get COGS (Cost of Goods Sold) and gross profit report for a period.',
    inputSchema: {
      type: 'object',
      required: ['dateFrom', 'dateTo'],
      properties: {
        dateFrom: { type: 'string' },
        dateTo:   { type: 'string' },
      },
    },
    async handler(input) {
      const db   = await getAdminFirestore();
      const from = new Date(input.dateFrom);
      const to   = new Date(input.dateTo); to.setHours(23, 59, 59);

      const salesSnap = await db.collection(COL.SALES)
        .where('createdAt', '>=', from).where('createdAt', '<=', to).get();
      const sales = snapToArray(salesSnap);

      const totalRevenue = sales.reduce((s, x) => s + (x.subtotal ?? 0), 0);
      const totalCOGS    = sales.reduce((s, x) => s + (x.totalCogsFifo ?? 0), 0);
      const totalProfit  = sales.reduce((s, x) => s + (x.totalGrossProfitFifo ?? 0), 0);

      // Per-item COGS breakdown
      const itemCogs = {};
      for (const s of sales) {
        for (const line of s.lines ?? []) {
          const key = line.menuItemId ?? line.name ?? 'unknown';
          if (!itemCogs[key]) itemCogs[key] = { name: line.name ?? key, qty: 0, revenue: 0, cogs: 0 };
          itemCogs[key].qty     += line.qty ?? 0;
          itemCogs[key].revenue += (line.qty ?? 0) * (line.unitPrice ?? 0);
          itemCogs[key].cogs    += line.cogsFifo ?? 0;
        }
      }

      return {
        period:       { from: from.toISOString(), to: to.toISOString() },
        salesCount:   sales.length,
        summary: {
          totalRevenue:    +totalRevenue.toFixed(2),
          totalCOGS:       +totalCOGS.toFixed(2),
          totalGrossProfit: +totalProfit.toFixed(2),
          profitMargin:    totalRevenue > 0 ? +((totalProfit / totalRevenue) * 100).toFixed(2) : 0,
          cogsRatio:       totalRevenue > 0 ? +((totalCOGS / totalRevenue) * 100).toFixed(2) : 0,
        },
        perItem: Object.values(itemCogs)
          .map(i => ({ ...i, revenue: +i.revenue.toFixed(2), cogs: +i.cogs.toFixed(2) }))
          .sort((a, b) => b.cogs - a.cogs),
      };
    },
  },
];
