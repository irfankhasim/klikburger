/**
 * Penjanaan laporan bulanan (Admin SDK) — selaras dengan
 * `js/monthly-reports/generate-monthly-report.js` (Firestore + formula sama).
 */
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { COL } from './collections.mjs';
import { staffStartedAtIso } from '../../js/monthly-reports/staff-salary-calc.js';
import { buildStaffPerformancePayload } from '../../js/monthly-reports/staff-performance-calc.js';
import { emptyWastageAgg, addWastageLedgerEntry, finalizeWastageAgg } from '../../js/monthly-reports/wastage-agg.js';

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

function round4(n) {
  const x = typeof n === 'number' ? n : parseFloat(n) || 0;
  return Math.round(x * 10000) / 10000;
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
    batchSnap,
    staffSnap,
    salesLegacySnap,
  ] = await Promise.all([
    fetchPagedByRange(db, COL.POS_RECEIPTS, 'createdAt', tsStart, tsEnd),
    fetchPagedByRange(db, COL.PURCHASE_HISTORY, 'createdAt', tsStart, tsEnd),
    fetchPagedByRange(db, COL.INGREDIENT_LEDGER, 'occurredAt', tsStart, tsEnd),
    fetchClosedShiftsInRange(db, tsStart, tsEnd),
    fetchPagedByRange(db, COL.STAFF_ACTIVITY, 'createdAt', tsStart, tsEnd),
    db.collection(COL.INGREDIENTS).get(),
    db.collection(COL.INGREDIENT_BATCHES).get(),
    db.collection(COL.STAFF).get(),
    fetchPagedByRange(db, COL.SALES, 'createdAt', tsStart, tsEnd),
  ]);

  const batchByIngredient = {};
  batchSnap.docs.forEach((d) => {
    const x = d.data();
    const ingId = String(x.ingredientId || '');
    if (!ingId) return;
    if (!batchByIngredient[ingId]) {
      batchByIngredient[ingId] = { totalRemaining: 0, totalOriginal: 0, batches: [] };
    }
    const qty = typeof x.qtyRemaining === 'number' ? x.qtyRemaining : parseFloat(x.qtyRemaining) || 0;
    const orig = typeof x.qtyOriginal === 'number' ? x.qtyOriginal : parseFloat(x.qtyOriginal) || 0;
    batchByIngredient[ingId].totalRemaining += qty;
    batchByIngredient[ingId].totalOriginal += orig;
    batchByIngredient[ingId].batches.push({
      id: d.id,
      qtyRemaining: qty,
      qtyOriginal: orig,
      costPerUnit: x.costPerUnit || 0,
      openedAt: x.openedAt,
    });
  });

  const ingNameById = {};
  const ingUnitById = {};
  ingSnap.docs.forEach((d) => {
    const x = d.data();
    ingNameById[d.id] = String(x.name || '').trim() || d.id;
    ingUnitById[d.id] = String(x.unit || 'unit');
  });

  const clockByStaff = {};
  activityDocs.forEach((docSnap) => {
    const a = docSnap.data();
    const kind = String(a.kind || '');
    if (kind !== 'clock_in' && kind !== 'clock_out') return;
    const sid = String(a.staffId || docSnap.id || '').trim();
    if (!sid) return;
    if (!clockByStaff[sid]) clockByStaff[sid] = { clockIn: 0, clockOut: 0, events: [] };
    if (kind === 'clock_in') clockByStaff[sid].clockIn += 1;
    if (kind === 'clock_out') clockByStaff[sid].clockOut += 1;
    let atIso = '';
    if (a.createdAt && typeof a.createdAt.toDate === 'function') {
      atIso = a.createdAt.toDate().toISOString();
    }
    clockByStaff[sid].events.push({
      kind,
      at: atIso,
      staffName: String(a.staffName || ''),
    });
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
    const clock = clockByStaff[d.id] || clockByStaff[String(x.staffId || '')] || { clockIn: 0, clockOut: 0, events: [] };
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
      salaryDisplayRm: isOwner ? 'tiada' : round2(est),
      accumulatedSalaryRm: est,
      clockInCount: clock.clockIn,
      clockOutCount: clock.clockOut,
      clockEvents: clock.events.slice(0, 40),
    });
  });
  staffLines.sort((a, b) => {
    if (a.isOwner && !b.isOwner) return -1;
    if (!a.isOwner && b.isOwner) return 1;
    return String(a.name).localeCompare(String(b.name), 'ms');
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
    const voided = !!(x.voided || x.isVoided);
    if (voided) {
      voidedCount += 1;
      return;
    }
    netReceiptCount += 1;
    const sub = typeof x.subtotal === 'number' ? x.subtotal : parseFloat(x.subtotal) || 0;
    const cog = typeof x.totalCogsFifo === 'number' ? x.totalCogsFifo : parseFloat(x.totalCogsFifo) || 0;
    grossSales += sub;
    totalCogs += cog;
    const pmRaw = String(x.paymentMethod || 'other').toLowerCase();
    const pm = pmRaw === 'cash' || pmRaw === 'tunai' ? 'cash' : 'qr';
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
    .slice(0, 5);

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
  const ledgerConsumptionByIngredient = {};
  const ledgerKinds = {};
  const wastageState = emptyWastageAgg();
  ledgerDocs.forEach((d) => {
    const x = d.data();
    const kind = String(x.kind || '');
    ledgerKinds[kind] = (ledgerKinds[kind] || 0) + 1;
    const iid = String(x.ingredientId || '');
    const ingName = ingNameById[iid] || String(x.nameSnapshot || iid);
    const unit = String(x.unit || 'unit');
    addWastageLedgerEntry(wastageState, x, ingNameById, ingUnitById);

    if (kind === 'purchase' || kind === 'initial' || kind === 'price_adjust') {
      const price = typeof x.purchasePrice === 'number' ? x.purchasePrice : parseFloat(x.purchasePrice) || 0;
      const qty = typeof x.purchaseQty === 'number' ? x.purchaseQty : parseFloat(x.purchaseQty) || 0;
      ledgerPurchaseRm += price;
      if (!iid) return;
      if (!ledgerByIngredient[iid]) {
        ledgerByIngredient[iid] = {
          ingredientId: iid,
          name: ingName,
          unit,
          ledgerSpendRm: 0,
          totalQtyPurchased: 0,
          entryCount: 0,
        };
      }
      ledgerByIngredient[iid].ledgerSpendRm += price;
      ledgerByIngredient[iid].totalQtyPurchased += qty;
      ledgerByIngredient[iid].entryCount += 1;
    }

    if (kind === 'sale_consumption') {
      if (!iid) return;
      const consumedQty =
        typeof x.purchaseQty === 'number' ? Math.abs(x.purchaseQty) : Math.abs(parseFloat(x.purchaseQty) || 0);
      const consumedCost =
        typeof x.purchasePrice === 'number' ? Math.abs(x.purchasePrice) : Math.abs(parseFloat(x.purchasePrice) || 0);
      const cpu = typeof x.costPerUnit === 'number' ? x.costPerUnit : parseFloat(x.costPerUnit) || 0;
      if (!ledgerConsumptionByIngredient[iid]) {
        ledgerConsumptionByIngredient[iid] = {
          ingredientId: iid,
          name: ingName,
          unit,
          totalQtyConsumed: 0,
          totalCostConsumed: 0,
          costPerUnit: cpu,
        };
      }
      ledgerConsumptionByIngredient[iid].totalQtyConsumed += consumedQty;
      ledgerConsumptionByIngredient[iid].totalCostConsumed += consumedCost;
    }
  });
  const wastageAgg = finalizeWastageAgg(wastageState);
  const wastageByIngId = {};
  wastageAgg.wastageByIngredient.forEach((row) => {
    wastageByIngId[row.ingredientId] = row;
  });
  ledgerPurchaseRm = round2(ledgerPurchaseRm);
  const ledgerAgg = Object.keys(ledgerByIngredient)
    .map((k) => {
      const row = ledgerByIngredient[k];
      row.ledgerSpendRm = round2(row.ledgerSpendRm);
      row.totalQtyPurchased = round4(row.totalQtyPurchased);
      return row;
    })
    .sort((a, b) => b.ledgerSpendRm - a.ledgerSpendRm)
    .slice(0, 40);

  const consumptionAgg = Object.keys(ledgerConsumptionByIngredient)
    .map((k) => {
      const row = ledgerConsumptionByIngredient[k];
      row.totalQtyConsumed = round4(row.totalQtyConsumed);
      row.totalCostConsumed = round2(row.totalCostConsumed);
      return row;
    })
    .sort((a, b) => b.totalCostConsumed - a.totalCostConsumed);

  const ingredientStockSummary = Object.keys(batchByIngredient)
    .map((ingId) => {
      const b = batchByIngredient[ingId];
      const thisMonthConsumption = ledgerConsumptionByIngredient[ingId];
      const thisMonthWastage = wastageByIngId[ingId];
      const qtyRemaining = round4(b.totalRemaining);
      return {
        ingredientId: ingId,
        name: ingNameById[ingId] || ingId,
        unit: ingUnitById[ingId] || 'unit',
        qtyOriginal: round4(b.totalOriginal),
        qtyUsedThisMonth: thisMonthConsumption ? round4(thisMonthConsumption.totalQtyConsumed || 0) : 0,
        qtyWastedThisMonth: thisMonthWastage ? round4(thisMonthWastage.totalQty || 0) : 0,
        costWastedThisMonth: thisMonthWastage ? round2(thisMonthWastage.totalCostRm || 0) : 0,
        qtyRemaining,
        status: qtyRemaining <= 0 ? 'habis' : qtyRemaining <= 5 ? 'rendah' : 'ok',
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const allIngredientIds = new Set([
    ...Object.keys(ledgerByIngredient),
    ...Object.keys(ledgerConsumptionByIngredient),
    ...Object.keys(wastageByIngId),
  ]);
  const combinedIngredientSummary = Array.from(allIngredientIds)
    .map((iid) => {
      const purchase = ledgerByIngredient[iid] || {};
      const consumption = ledgerConsumptionByIngredient[iid] || {};
      const wasted = wastageByIngId[iid] || {};
      const name = purchase.name || consumption.name || wasted.name || ingNameById[iid] || iid;
      const unit = purchase.unit || consumption.unit || wasted.unit || 'unit';
      const qtyBought = round4(purchase.totalQtyPurchased || 0);
      const qtyUsed = round4(consumption.totalQtyConsumed || 0);
      const qtyWasted = round4(wasted.totalQty || 0);
      const live = batchByIngredient[iid];
      const qtyRemaining = live
        ? round4(live.totalRemaining)
        : round4(Math.max(0, qtyBought - qtyUsed - qtyWasted));
      return {
        ingredientId: iid,
        name,
        unit,
        qtyBought,
        qtyUsed,
        qtyWasted,
        qtyRemaining,
        costBought: round2(purchase.ledgerSpendRm || 0),
        costUsed: round2(consumption.totalCostConsumed || 0),
        costWasted: round2(wasted.totalCostRm || 0),
      };
    })
    .filter((x) => x.qtyBought > 0 || x.qtyUsed > 0 || x.qtyWasted > 0)
    .sort((a, b) => b.costBought - a.costBought);

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
  const wastageTotalRm = wastageAgg.wastageTotalRm;
  const netOperating = round2(grossProfit - payrollTotal - wastageTotalRm - otherExpensesRm);

  const payload = {
    monthKey: key,
    calendarYear: year,
    calendarMonth: month1to12,
    boundsNote:
      'Julat masa ikut tengah malam zon pelayan Node semasa penjanaan (new Date(year, month-1, 1) → bulan berikut).',
    generatedAt: FieldValue.serverTimestamp(),
    generatorVersion: 3,
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
      consumptionByIngredient: consumptionAgg,
      ingredientSummary: combinedIngredientSummary,
      ingredientStockSummary: ingredientStockSummary,
      wastageTotalRm,
      wastageEntryCount: wastageAgg.wastageEntryCount,
      wastageByIngredient: wastageAgg.wastageByIngredient,
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
      wastageRm: wastageTotalRm,
      otherExpensesRm,
      netOperatingEstimateRm: netOperating,
      includesLegacySalesCollection: legacyCount > 0,
      narrative:
        'Anggaran operasi bersih = Untung kasar (Jualan - COGS jualan) - Gaji - Pembaziran. Pembaziran dikira dari harga lot belian yang dipilih semasa rekod, bukan harga katalog semasa. Pembelian stok (purchase_history) dipaparkan berasingan dan tidak ditolak dari operasi bersih.',
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
