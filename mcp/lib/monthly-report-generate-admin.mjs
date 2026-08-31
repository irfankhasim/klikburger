/**
 * Penjanaan laporan bulanan (Admin SDK) — selaras dengan
 * `js/monthly-reports/generate-monthly-report.js` (Firestore + formula sama).
 */
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { COL } from './collections.mjs';
import { staffStartedAtIso } from '../../js/monthly-reports/staff-salary-calc.js';
import { buildStaffPerformancePayload } from '../../js/monthly-reports/staff-performance-calc.js';

const PAGE = 400;
/** Gaji rata semua staf bukan-owner dalam laporan (bukan prorate ikut jam/tarikh mula). */
const FIXED_STAFF_SALARY_RM = 1000;

function pad2(n) {
  return (n < 10 ? '0' : '') + n;
}

export function monthDocIdFromParts(year, month1to12) {
  return `${year}-${pad2(month1to12)}`;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function localMonthBounds(year, month1to12) {
  const m0 = month1to12 - 1;
  const start = new Date(year, m0, 1, 0, 0, 0, 0);
  const end = new Date(year, m0 + 1, 1, 0, 0, 0, 0);
  return { start, end };
}

async function fetchPagedByRange(db, colName, field, tsStart, tsEnd) {
  const out = [];
  let lastSnap = null;
  while (true) {
    let q = db
      .collection(colName)
      .where(field, '>=', tsStart)
      .where(field, '<', tsEnd)
      .orderBy(field, 'asc')
      .limit(PAGE);
    if (lastSnap) q = q.startAfter(lastSnap);
    const snap = await q.get();
    if (snap.empty) break;
    snap.docs.forEach((d) => out.push(d));
    lastSnap = snap.docs[snap.docs.length - 1];
    if (snap.docs.length < PAGE) break;
  }
  return out;
}

/** Julat `closedAt` sahaja; tapis `status === closed` dalam klien (tiada indeks komposit). */
async function fetchClosedShiftsInRange(db, tsStart, tsEnd) {
  const out = [];
  let lastSnap = null;
  while (true) {
    let q = db
      .collection(COL.POS_SHIFTS)
      .where('closedAt', '>=', tsStart)
      .where('closedAt', '<', tsEnd)
      .orderBy('closedAt', 'asc')
      .limit(PAGE);
    if (lastSnap) q = q.startAfter(lastSnap);
    const snap = await q.get();
    if (snap.empty) break;
    snap.docs.forEach((d) => {
      const x = d.data();
      if (String(x.status || '') !== 'closed') return;
      out.push(d);
    });
    lastSnap = snap.docs[snap.docs.length - 1];
    if (snap.docs.length < PAGE) break;
  }
  return out;
}

function varianceFromClosing(closing) {
  if (!closing || typeof closing !== 'object') return null;
  let v = typeof closing.variance === 'number' ? closing.variance : parseFloat(closing.variance);
  if (v != null && !Number.isNaN(v)) return round2(v);
  const expected =
    typeof closing.expectedDrawer === 'number' ? closing.expectedDrawer : parseFloat(closing.expectedDrawer);
  let actual = typeof closing.actualDrawer === 'number' ? closing.actualDrawer : parseFloat(closing.actualDrawer);
  if ((actual == null || Number.isNaN(actual)) && closing.closingCash != null) {
    actual = parseFloat(closing.closingCash);
  }
  if (Number.isNaN(expected) || Number.isNaN(actual)) return null;
  return round2(actual - expected);
}

function varianceCategoryFromVariance(varianceRm) {
  if (varianceRm == null || typeof varianceRm !== 'number' || Number.isNaN(varianceRm)) return 'unknown';
  if (Math.abs(varianceRm) < 0.005) return 'balanced';
  return varianceRm > 0 ? 'over' : 'short';
}

/**
 * @param {import('firebase-admin/firestore').Firestore} db
 * @param {string} yearMonth — YYYY-MM
 * @param {{ source?: string, actorUid?: string }} [opts]
 */
export async function buildMonthlyReportPayloadAdmin(db, yearMonth, opts) {
  const o = opts || {};
  const parts = String(yearMonth || '').split('-').map(Number);
  const year = parts[0];
  const month1to12 = parts[1];
  if (!year || month1to12 < 1 || month1to12 > 12) {
    throw new Error(`Invalid yearMonth: ${yearMonth}`);
  }

  const bounds = localMonthBounds(year, month1to12);
  const tsStart = Timestamp.fromDate(bounds.start);
  const tsEnd = Timestamp.fromDate(bounds.end);
  const key = monthDocIdFromParts(year, month1to12);

  const [
    receiptDocs,
    purchaseDocs,
    ledgerDocs,
    shiftDocs,
    activityDocs,
    ingSnap,
    staffSnap,
    salesLegacySnap,
  ] = await Promise.all([
    fetchPagedByRange(db, COL.POS_RECEIPTS, 'createdAt', tsStart, tsEnd),
    fetchPagedByRange(db, COL.PURCHASE_HISTORY, 'createdAt', tsStart, tsEnd),
    fetchPagedByRange(db, COL.INGREDIENT_LEDGER, 'occurredAt', tsStart, tsEnd),
    fetchClosedShiftsInRange(db, tsStart, tsEnd),
    fetchPagedByRange(db, COL.STAFF_ACTIVITY, 'createdAt', tsStart, tsEnd),
    db.collection(COL.INGREDIENTS).get(),
    db.collection(COL.STAFF).get(),
    fetchPagedByRange(db, COL.SALES, 'createdAt', tsStart, tsEnd),
  ]);

  const ingNameById = {};
  ingSnap.docs.forEach((d) => {
    const x = d.data();
    ingNameById[d.id] = String(x.name || '').trim() || d.id;
  });

  const staffLines = [];
  let payrollTotal = 0;
  staffSnap.docs.forEach((d) => {
    const x = d.data();
    const status = String(x.employmentStatus || 'active');
    const role = String(x.role || '');
    const isOwner = !!(x.isOwner || role.toLowerCase() === 'owner' || d.id === 'owner_01');
    const baseName = String(x.name || x.staffName || '').trim() || 'Tanpa nama';
    const est = isOwner ? 0 : FIXED_STAFF_SALARY_RM;
    if (status === 'active' && est > 0) payrollTotal += est;
    staffLines.push({
      staffId: d.id,
      name: baseName,
      role,
      isOwner,
      employmentStatus: status,
      payType: String(x.payType || 'hourly'),
      payAmount: typeof x.payAmount === 'number' ? x.payAmount : parseFloat(x.payAmount) || 0,
      startedAt: staffStartedAtIso(x),
      estimatedMonthlySalaryRm: est,
      accumulatedSalaryRm: est,
    });
  });
  payrollTotal = round2(payrollTotal);

  const staffPerf = buildStaffPerformancePayload(activityDocs, receiptDocs, staffLines);
  const attendanceBySid = {};
  staffPerf.attendance.lines.forEach((l) => {
    attendanceBySid[l.staffId] = l;
  });
  staffLines.forEach((sl) => {
    const a = attendanceBySid[sl.staffId];
    if (!a) return;
    sl.totalHoursWorked = a.totalHoursWorked;
    sl.totalSessions = a.totalSessions;
    sl.cashierHoursWorked = a.cashierHoursWorked;
    sl.kitchenHoursWorked = a.kitchenHoursWorked;
  });

  let grossSales = 0;
  let totalCogs = 0;
  let voidedCount = 0;
  let netReceiptCount = 0;
  const byPay = {};
  const menuQtyByKey = {};
  receiptDocs.forEach((d) => {
    const x = d.data();
    const voided = !!x.voided;
    if (voided) {
      voidedCount += 1;
      return;
    }
    netReceiptCount += 1;
    const sub = typeof x.subtotal === 'number' ? x.subtotal : parseFloat(x.subtotal) || 0;
    const cog = typeof x.totalCogsFifo === 'number' ? x.totalCogsFifo : parseFloat(x.totalCogsFifo) || 0;
    grossSales += sub;
    totalCogs += cog;
    const pm = String(x.paymentMethod || 'other').toLowerCase();
    byPay[pm] = (byPay[pm] || 0) + sub;
    (x.lines || []).forEach((ln) => {
      const name = String(ln.name || ln.id || '').trim();
      if (!name) return;
      const qty = typeof ln.qty === 'number' ? ln.qty : parseFloat(ln.qty) || 0;
      menuQtyByKey[name] = (menuQtyByKey[name] || 0) + qty;
    });
  });
  grossSales = round2(grossSales);
  totalCogs = round2(totalCogs);
  Object.keys(byPay).forEach((k) => {
    byPay[k] = round2(byPay[k]);
  });
  const grossProfit = round2(grossSales - totalCogs);
  const avgNonVoidSubtotalRm =
    netReceiptCount > 0 ? round2(grossSales / netReceiptCount) : 0;
  const topMenuItems = Object.keys(menuQtyByKey)
    .map((name) => ({ name, qty: menuQtyByKey[name] }))
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 10);

  let purchaseTotalRm = 0;
  let purchaseTaxTotalRm = 0;
  const purchaseCount = purchaseDocs.length;
  const purchaseTop = [];
  purchaseDocs.forEach((d) => {
    const x = d.data();
    const t = typeof x.totalAmount === 'number' ? x.totalAmount : parseFloat(x.totalAmount) || 0;
    const tax = typeof x.taxAmount === 'number' ? x.taxAmount : parseFloat(x.taxAmount) || 0;
    purchaseTotalRm += t;
    purchaseTaxTotalRm += tax;
    purchaseTop.push({
      id: d.id,
      totalAmountRm: round2(t),
      notes: String(x.notes || '').slice(0, 120),
      supplier: String(x.supplier || '').slice(0, 80),
    });
  });
  purchaseTotalRm = round2(purchaseTotalRm);
  purchaseTaxTotalRm = round2(purchaseTaxTotalRm);
  purchaseTop.sort((a, b) => b.totalAmountRm - a.totalAmountRm);
  const purchaseTop25 = purchaseTop.slice(0, 25);

  let ledgerPurchaseRm = 0;
  const ledgerByIngredient = {};
  const ledgerKinds = {};
  ledgerDocs.forEach((d) => {
    const x = d.data();
    const kind = String(x.kind || '');
    ledgerKinds[kind] = (ledgerKinds[kind] || 0) + 1;
    if (kind !== 'purchase' && kind !== 'initial' && kind !== 'price_adjust') return;
    const price = typeof x.purchasePrice === 'number' ? x.purchasePrice : parseFloat(x.purchasePrice) || 0;
    ledgerPurchaseRm += price;
    const iid = String(x.ingredientId || '');
    if (!iid) return;
    if (!ledgerByIngredient[iid]) {
      ledgerByIngredient[iid] = {
        ingredientId: iid,
        name: ingNameById[iid] || iid,
        ledgerSpendRm: 0,
        entryCount: 0,
      };
    }
    ledgerByIngredient[iid].ledgerSpendRm += price;
    ledgerByIngredient[iid].entryCount += 1;
  });
  ledgerPurchaseRm = round2(ledgerPurchaseRm);
  const ledgerAgg = Object.keys(ledgerByIngredient)
    .map((k) => {
      const row = ledgerByIngredient[k];
      row.ledgerSpendRm = round2(row.ledgerSpendRm);
      return row;
    })
    .sort((a, b) => b.ledgerSpendRm - a.ledgerSpendRm)
    .slice(0, 40);

  let legacySalesTotal = 0;
  let legacyCount = 0;
  salesLegacySnap.forEach((d) => {
    const x = d.data();
    legacyCount += 1;
    legacySalesTotal += typeof x.subtotal === 'number' ? x.subtotal : parseFloat(x.subtotal) || 0;
  });
  legacySalesTotal = round2(legacySalesTotal);

  const varianceByCategory = { balanced: 0, short: 0, over: 0, unknown: 0 };
  let totalVarianceRm = 0;
  const shiftLines = [];
  shiftDocs.forEach((d) => {
    const x = d.data();
    const clos = x.closing && typeof x.closing === 'object' ? x.closing : {};
    const v = varianceFromClosing(clos);
    let cat = String(clos.varianceCategory || varianceCategoryFromVariance(v) || 'unknown');
    if (!['balanced', 'short', 'over', 'unknown'].includes(cat)) cat = 'unknown';
    varianceByCategory[cat] = (varianceByCategory[cat] || 0) + 1;
    if (typeof v === 'number' && !Number.isNaN(v)) totalVarianceRm += v;
    shiftLines.push({
      shiftId: d.id,
      varianceRm: v,
      varianceCategory: cat,
      expectedDrawerRm:
        typeof clos.expectedDrawer === 'number' ? clos.expectedDrawer : parseFloat(clos.expectedDrawer) || null,
      actualDrawerRm:
        typeof clos.actualDrawer === 'number' ? clos.actualDrawer : parseFloat(clos.actualDrawer) || null,
    });
  });
  totalVarianceRm = round2(totalVarianceRm);

  const otherExpensesRm = 0;
  const netOperating = round2(grossProfit - payrollTotal - otherExpensesRm);

  const payload = {
    monthKey: key,
    calendarYear: year,
    calendarMonth: month1to12,
    boundsNote:
      'Julat masa ikut tengah malam zon pelayan Node semasa penjanaan (new Date(year, month-1, 1) → bulan berikut).',
    generatedAt: FieldValue.serverTimestamp(),
    generatorVersion: 2,
    source: o.source || 'mcp_generate_monthly_report',
    actorUid: o.actorUid != null ? String(o.actorUid) : '',
    rawMaterials: {
      purchaseHistoryDocumentCount: purchaseCount,
      purchaseHistoryTotalRm: purchaseTotalRm,
      purchaseHistoryTaxTotalRm: purchaseTaxTotalRm,
      purchaseTop: purchaseTop25,
      ingredientLedgerEntriesInRange: ledgerDocs.length,
      ledgerSpendInitialPurchaseAdjustRm: ledgerPurchaseRm,
      ledgerKindCounts: ledgerKinds,
      topIngredientsByLedgerSpendRm: ledgerAgg,
      ingredientsCatalogCount: ingSnap.size,
    },
    sales: {
      posReceiptDocumentsInRange: receiptDocs.length,
      nonVoidReceiptCount: netReceiptCount,
      voidedReceiptCount: voidedCount,
      grossSalesSubtotalRm: grossSales,
      totalCogsFifoRm: totalCogs,
      grossProfitRm: grossProfit,
      byPaymentMethodRm: byPay,
      legacyColSalesDocumentCount: legacyCount,
      legacyColSalesSubtotalRm: legacySalesTotal,
      avgNonVoidSubtotalRm,
      topMenuItems,
    },
    cashDrawer: {
      note:
        'Shift ditutup dalam julat: `status` == closed dan `closedAt` (Timestamp puncak dokumen) dalam bulan. Varians dari `closing.variance` atau actual − expected.',
      closedShiftsInRange: shiftDocs.length,
      totalVarianceRm,
      varianceByCategory,
      shiftsSample: shiftLines.slice(0, 40),
    },
    staffSalary: {
      note: `Bahagian B — Kehadiran & Gaji (semua tugas). Gaji rata RM${FIXED_STAFF_SALARY_RM} sebulan setiap staf bukan-owner. totalHoursWorked/totalSessions dikira dari pasangan clock_in/clock_out sebenar (semua tugas).`,
      staffCount: staffLines.length,
      activeStaffPayrollEstimateRm: payrollTotal,
      lines: staffLines,
    },
    staffSalesPerformance: staffPerf.salesPerformance,
    company: {
      revenuePosReceiptsRm: grossSales,
      costOfGoodsFifoRm: totalCogs,
      grossProfitRm: grossProfit,
      inventoryPurchasesRecordedRm: purchaseTotalRm,
      payrollEstimateRm: payrollTotal,
      otherExpensesRm,
      netOperatingEstimateRm: netOperating,
      includesLegacySalesCollection: legacyCount > 0,
      narrative:
        'Anggaran operasi bersih = Untung kasar (Jualan - COGS) - Anggaran gaji pekerja aktif. Pembelian stok (purchase_history) dipaparkan berasingan sebagai maklumat perbelanjaan inventori — ia tidak ditolak dari operasi bersih kerana COGS sudah mengambil kira kos bahan yang digunakan.',
    },
  };

  return { monthKey: key, payload };
}

/**
 * @param {import('firebase-admin/firestore').Firestore} db
 * @param {string} yearMonth
 */
export async function writeMonthlyReportAdmin(db, yearMonth, opts) {
  const { monthKey, payload } = await buildMonthlyReportPayloadAdmin(db, yearMonth, opts);
  await db.collection(COL.MONTHLY_REPORTS).doc(monthKey).set(payload);
  return { monthKey, payload };
}
