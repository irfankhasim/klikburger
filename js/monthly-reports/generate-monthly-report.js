/**
 * Agregat bulan kalendar → dokumen `monthly_reports/{YYYY-MM}`.
 * Bacaan berpagin untuk elak had 500 dokumen sekaligus.
 */
import {
  db,
  collection,
  doc,
  getDocs,
  setDoc,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  Timestamp,
  serverTimestamp
} from "../firebase/init.js";
import {
  COL_POS_RECEIPTS,
  COL_POS_SHIFTS,
  COL_PURCHASE_HISTORY,
  COL_INGREDIENT_LEDGER,
  COL_INGREDIENTS,
  COL_INGREDIENT_BATCHES,
  COL_STAFF,
  COL_STAFF_ACTIVITY,
  COL_SALES,
  COL_MONTHLY_REPORTS
} from "../firebase/collections.js";
import { varianceCategoryFromVariance } from "../drawer-variance.js";
import { staffStartedAtIso } from "./staff-salary-calc.js";
import { buildStaffPerformancePayload } from "./staff-performance-calc.js";
import { emptyWastageAgg, addWastageLedgerEntry, finalizeWastageAgg } from "./wastage-agg.js";

/** Gaji rata semua staf bukan-owner dalam laporan (bukan prorate ikut jam/tarikh mula). */
var FIXED_STAFF_SALARY_RM = 1000;

var PAGE = 400;

function pad2(n) {
  return (n < 10 ? "0" : "") + n;
}

/** @param {number} year @param {number} month 1–12 */
export function monthDocId(year, month) {
  return year + "-" + pad2(month);
}

/** Had kalendar setempat pelayar (tengah malam tempatan). */
export function localMonthBounds(year, month1to12) {
  var m0 = month1to12 - 1;
  var start = new Date(year, m0, 1, 0, 0, 0, 0);
  var end = new Date(year, m0 + 1, 1, 0, 0, 0, 0);
  return { start: start, end: end };
}

/** Bulan kalendar terakhir yang sudah “tutup” (sebelum bulan semasa). */
export function lastCompletedCalendarMonthParts(now) {
  var d = now || new Date();
  var y = d.getFullYear();
  var curM0 = d.getMonth();
  var prevM0 = curM0 === 0 ? 11 : curM0 - 1;
  var prevY = curM0 === 0 ? y - 1 : y;
  return { year: prevY, month: prevM0 + 1 };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function str(v) {
  return String(v != null ? v : "").trim();
}

function num(v) {
  return typeof v === "number" ? v : parseFloat(v) || 0;
}

function tsToMs(ts) {
  if (!ts) return 0;
  if (typeof ts.toDate === "function") return ts.toDate().getTime();
  if (typeof ts.toMillis === "function") return ts.toMillis();
  if (typeof ts === "number") return ts;
  var d = new Date(ts);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

export function round4(n) {
  var x = typeof n === "number" ? n : parseFloat(n) || 0;
  return Math.round(x * 10000) / 10000;
}

async function fetchPagedByRange(colName, field, tsStart, tsEnd) {
  var out = [];
  var lastSnap = null;
  while (true) {
    var q = lastSnap
      ? query(
          collection(db, colName),
          where(field, ">=", tsStart),
          where(field, "<", tsEnd),
          orderBy(field, "asc"),
          startAfter(lastSnap),
          limit(PAGE)
        )
      : query(
          collection(db, colName),
          where(field, ">=", tsStart),
          where(field, "<", tsEnd),
          orderBy(field, "asc"),
          limit(PAGE)
        );
    var snap = await getDocs(q);
    if (snap.empty) break;
    snap.docs.forEach(function (d) {
      out.push(d);
    });
    lastSnap = snap.docs[snap.docs.length - 1];
    if (snap.docs.length < PAGE) break;
  }
  return out;
}

/**
 * Shift ditutup dalam julat `closedAt` (Timestamp puncak).
 * Tapisan `status === "closed"` dalam klien — elak indeks komposit status+closedAt.
 */
async function fetchClosedShiftsInRange(tsStart, tsEnd) {
  var out = [];
  var lastSnap = null;
  while (true) {
    var q = lastSnap
      ? query(
          collection(db, COL_POS_SHIFTS),
          where("closedAt", ">=", tsStart),
          where("closedAt", "<", tsEnd),
          orderBy("closedAt", "asc"),
          startAfter(lastSnap),
          limit(PAGE)
        )
      : query(
          collection(db, COL_POS_SHIFTS),
          where("closedAt", ">=", tsStart),
          where("closedAt", "<", tsEnd),
          orderBy("closedAt", "asc"),
          limit(PAGE)
        );
    var snap = await getDocs(q);
    if (snap.empty) break;
    snap.docs.forEach(function (d) {
      var x = d.data();
      if (String(x.status || "") !== "closed") return;
      out.push(d);
    });
    lastSnap = snap.docs[snap.docs.length - 1];
    if (snap.docs.length < PAGE) break;
  }
  return out;
}

function varianceFromClosing(closing) {
  if (!closing || typeof closing !== "object") return null;
  var v = typeof closing.variance === "number" ? closing.variance : parseFloat(closing.variance);
  if (v != null && !isNaN(v)) return round2(v);
  var expected =
    typeof closing.expectedDrawer === "number" ? closing.expectedDrawer : parseFloat(closing.expectedDrawer);
  var actual = typeof closing.actualDrawer === "number" ? closing.actualDrawer : parseFloat(closing.actualDrawer);
  if ((actual == null || isNaN(actual)) && closing.closingCash != null) {
    actual = parseFloat(closing.closingCash);
  }
  if (isNaN(expected) || isNaN(actual)) return null;
  return round2(actual - expected);
}

/**
 * @param {object} opts
 * @param {string} [opts.source] — "user_regenerate" | "auto_month_close" | "user_first_load"
 * @param {string} [opts.actorUid]
 * @param {(msg: string) => void} [opts.onProgress]
 */
export async function generateAndWriteMonthlyReport(year, month1to12, opts) {
  var o = opts || {};
  var progress = typeof o.onProgress === "function" ? o.onProgress : function () {};
  var bounds = localMonthBounds(year, month1to12);
  var tsStart = Timestamp.fromDate(bounds.start);
  var tsEnd = Timestamp.fromDate(new Date(year, month1to12, 1, 0, 0, 0)); // start of NEXT month
  var key = monthDocId(year, month1to12);

  progress("Memuatkan data Firestore…");
  var results = await Promise.all([
    fetchPagedByRange(COL_POS_RECEIPTS, "createdAt", tsStart, tsEnd),
    fetchPagedByRange(COL_PURCHASE_HISTORY, "createdAt", tsStart, tsEnd),
    fetchPagedByRange(COL_INGREDIENT_LEDGER, "occurredAt", tsStart, tsEnd),
    fetchClosedShiftsInRange(tsStart, tsEnd),
    fetchPagedByRange(COL_STAFF_ACTIVITY, "createdAt", tsStart, tsEnd),
    getDocs(collection(db, COL_INGREDIENTS)),
    getDocs(collection(db, COL_INGREDIENT_BATCHES)),
    getDocs(collection(db, COL_STAFF)),
    fetchPagedByRange(COL_SALES, "createdAt", tsStart, tsEnd)
  ]);

  var receiptDocs = results[0];
  var purchaseDocs = results[1];
  var ledgerDocs = results[2];
  var shiftDocs = results[3];
  var activityDocs = results[4];
  var ingSnap = results[5];
  var batchSnap = results[6];
  var staffSnap = results[7];
  var salesLegacySnap = results[8];

  progress("Mengagregat jualan, stok & kakitangan…");
  var batchByIngredient = {};
  batchSnap.docs.forEach(function(d) {
    var x = d.data();
    var ingId = String(x.ingredientId || "");
    if (!ingId) return;
    if (!batchByIngredient[ingId]) {
      batchByIngredient[ingId] = { totalRemaining: 0, totalOriginal: 0, batches: [] };
    }
    var qty = typeof x.qtyRemaining === "number" ? x.qtyRemaining : parseFloat(x.qtyRemaining) || 0;
    var orig = typeof x.qtyOriginal === "number" ? x.qtyOriginal : parseFloat(x.qtyOriginal) || 0;
    batchByIngredient[ingId].totalRemaining += qty;
    batchByIngredient[ingId].totalOriginal += orig;
    batchByIngredient[ingId].batches.push({ id: d.id, qtyRemaining: qty, qtyOriginal: orig, costPerUnit: x.costPerUnit || 0, openedAt: x.openedAt });
  });

  // Bina ingredientSummary dari batches (bukan ledger)
  var ingNameById = {};
  var ingUnitById = {};
  ingSnap.docs.forEach(function (d) {
    var x = d.data();
    ingNameById[d.id] = String(x.name || "").trim() || d.id;
    ingUnitById[d.id] = String(x.unit || "unit");
  });

  var clockByStaff = {};
  activityDocs.forEach(function (docSnap) {
    var a = docSnap.data();
    var kind = String(a.kind || "");
    if (kind !== "clock_in" && kind !== "clock_out") return;
    var sid = str(a.staffId || docSnap.id || "");
    if (!sid) return;
    if (!clockByStaff[sid]) {
      clockByStaff[sid] = { clockIn: 0, clockOut: 0, events: [] };
    }
    if (kind === "clock_in") clockByStaff[sid].clockIn += 1;
    if (kind === "clock_out") clockByStaff[sid].clockOut += 1;
    var atIso = "";
    if (a.createdAt && typeof a.createdAt.toDate === "function") {
      atIso = a.createdAt.toDate().toISOString();
    }
    clockByStaff[sid].events.push({
      kind: kind,
      at: atIso,
      staffName: String(a.staffName || "")
    });
  });

  var staffLines = [];
  var payrollTotal = 0;
  staffSnap.docs.forEach(function (d) {
    var x = d.data();
    var status = String(x.employmentStatus || "active");
    var role = String(x.role || "");
    var isOwner = !!(x.isOwner || role.toLowerCase() === "owner" || d.id === "owner_01");
    var baseName = String(x.name || x.staffName || "").trim() || "Tanpa nama";
    var est = isOwner ? 0 : FIXED_STAFF_SALARY_RM;
    if (status === "active" && est > 0) payrollTotal += est;
    var clock = clockByStaff[d.id] || clockByStaff[String(x.staffId || "")] || { clockIn: 0, clockOut: 0, events: [] };
    staffLines.push({
      staffId: d.id,
      name: baseName,
      role: role,
      isOwner: isOwner,
      employmentStatus: status,
      payType: String(x.payType || "hourly"),
      payAmount: typeof x.payAmount === "number" ? x.payAmount : parseFloat(x.payAmount) || 0,
      startedAt: staffStartedAtIso(x),
      estimatedMonthlySalaryRm: est,
      salaryDisplayRm: isOwner ? "tiada" : round2(est),
      accumulatedSalaryRm: est,
      clockInCount: clock.clockIn,
      clockOutCount: clock.clockOut,
      clockEvents: clock.events.slice(0, 40)
    });
  });
  staffLines.sort(function (a, b) {
    if (a.isOwner && !b.isOwner) return -1;
    if (!a.isOwner && b.isOwner) return 1;
    return String(a.name).localeCompare(String(b.name), "ms");
  });
  payrollTotal = round2(payrollTotal);

  var staffPerf = buildStaffPerformancePayload(activityDocs, receiptDocs, staffLines);
  var attendanceBySid = {};
  staffPerf.attendance.lines.forEach(function (l) {
    attendanceBySid[l.staffId] = l;
  });
  staffLines.forEach(function (sl) {
    var a = attendanceBySid[sl.staffId];
    if (!a) return;
    sl.totalHoursWorked = a.totalHoursWorked;
    sl.totalSessions = a.totalSessions;
    sl.cashierHoursWorked = a.cashierHoursWorked;
    sl.kitchenHoursWorked = a.kitchenHoursWorked;
  });

  var grossSales = 0;
  var totalCogs = 0;
  var voidedCount = 0;
  var netReceiptCount = 0;
  var byPay = {};
  var menuItemCounts = {};

  receiptDocs.forEach(function (d) {
    var x = d.data();
    var voided = !!(x.voided || x.isVoided);
    if (voided) {
      voidedCount += 1;
      return;
    }
    netReceiptCount += 1;
    var sub = typeof x.subtotal === "number" ? x.subtotal : parseFloat(x.subtotal) || 0;
    var cog = typeof x.totalCogsFifo === "number" ? x.totalCogsFifo : parseFloat(x.totalCogsFifo) || 0;
    grossSales += sub;
    totalCogs += cog;
    var pm = String(x.paymentMethod || "other").toLowerCase();
    if (pm === "cash" || pm === "tunai") pm = "cash";
    else pm = "qr";
    byPay[pm] = (byPay[pm] || 0) + sub;

    var lines = Array.isArray(x.lines) ? x.lines : [];
    lines.forEach(function (line) {
      var itemName = String(line.name || "").trim();
      if (!itemName) return;
      var qty = typeof line.qty === "number" ? line.qty : 1;
      menuItemCounts[itemName] = (menuItemCounts[itemName] || 0) + qty;
    });
  });

  var topMenuItems = Object.keys(menuItemCounts)
    .map(function (name) {
      return { name: name, qty: menuItemCounts[name] };
    })
    .sort(function (a, b) { return b.qty - a.qty; })
    .slice(0, 5);
  grossSales = round2(grossSales);
  totalCogs = round2(totalCogs);
  Object.keys(byPay).forEach(function (k) {
    byPay[k] = round2(byPay[k]);
  });
  var grossProfit = round2(grossSales - totalCogs);
  var avgNonVoidSubtotalRm = netReceiptCount > 0 ? round2(grossSales / netReceiptCount) : 0;

  var varianceByCategory = { balanced: 0, short: 0, over: 0, unknown: 0 };
  var totalVarianceRm = 0;
  var shiftLines = [];
  shiftDocs.forEach(function (d) {
    var x = d.data();
    var clos = x.closing && typeof x.closing === "object" ? x.closing : {};
    var v = varianceFromClosing(clos);
    var cat = String(clos.varianceCategory || varianceCategoryFromVariance(v) || "unknown");
    if (varianceByCategory[cat] == null) cat = "unknown";
    varianceByCategory[cat] = (varianceByCategory[cat] || 0) + 1;
    if (typeof v === "number" && !isNaN(v)) totalVarianceRm += v;
    shiftLines.push({
      shiftId: d.id,
      varianceRm: v,
      varianceCategory: cat,
      expectedDrawerRm:
        typeof clos.expectedDrawer === "number" ? clos.expectedDrawer : parseFloat(clos.expectedDrawer) || null,
      actualDrawerRm:
        typeof clos.actualDrawer === "number" ? clos.actualDrawer : parseFloat(clos.actualDrawer) || null
    });
  });
  totalVarianceRm = round2(totalVarianceRm);

  var purchaseTotalRm = 0;
  var purchaseTaxTotalRm = 0;
  var purchaseCount = purchaseDocs.length;
  var purchaseTop = [];
  purchaseDocs.forEach(function (d) {
    var x = d.data();
    var t = typeof x.totalAmount === "number" ? x.totalAmount : parseFloat(x.totalAmount) || 0;
    var tax = typeof x.taxAmount === "number" ? x.taxAmount : parseFloat(x.taxAmount) || 0;
    purchaseTotalRm += t;
    purchaseTaxTotalRm += tax;
    purchaseTop.push({
      id: d.id,
      totalAmountRm: round2(t),
      notes: String(x.notes || "").slice(0, 120),
      supplier: String(x.supplier || "").slice(0, 80)
    });
  });
  purchaseTotalRm = round2(purchaseTotalRm);
  purchaseTaxTotalRm = round2(purchaseTaxTotalRm);
  purchaseTop.sort(function (a, b) {
    return b.totalAmountRm - a.totalAmountRm;
  });
  purchaseTop = purchaseTop.slice(0, 25);

  var ledgerPurchaseRm = 0;
  var ledgerByIngredient = {};
  var ledgerConsumptionByIngredient = {};
  var ledgerKinds = {};
  var wastageState = emptyWastageAgg();

  ledgerDocs.forEach(function (d) {
    var x = d.data();
    var kind = String(x.kind || "");
    ledgerKinds[kind] = (ledgerKinds[kind] || 0) + 1;
    var iid = String(x.ingredientId || "");
    var ingName = ingNameById[iid] || String(x.nameSnapshot || iid);
    var unit = String(x.unit || "unit");

    addWastageLedgerEntry(wastageState, x, ingNameById, ingUnitById);

    // Rekod pembelian
    if (kind === "purchase" || kind === "initial" || kind === "price_adjust") {
      var price = typeof x.purchasePrice === "number" ? x.purchasePrice : parseFloat(x.purchasePrice) || 0;
      var qty = typeof x.purchaseQty === "number" ? x.purchaseQty : parseFloat(x.purchaseQty) || 0;
      ledgerPurchaseRm += price;
      if (!iid) return;
      if (!ledgerByIngredient[iid]) {
        ledgerByIngredient[iid] = {
          ingredientId: iid,
          name: ingName,
          unit: unit,
          ledgerSpendRm: 0,
          totalQtyPurchased: 0,
          entryCount: 0
        };
      }
      ledgerByIngredient[iid].ledgerSpendRm += price;
      ledgerByIngredient[iid].totalQtyPurchased += qty;
      ledgerByIngredient[iid].entryCount += 1;
    }

    // Penggunaan jualan sahaja — wastage dikira berasingan (harga lot belian)
    if (kind === "sale_consumption") {
      if (!iid) return;
      var consumedQty = typeof x.purchaseQty === "number" ? Math.abs(x.purchaseQty) : parseFloat(x.purchaseQty) || 0;
      var consumedCost = typeof x.purchasePrice === "number" ? Math.abs(x.purchasePrice) : parseFloat(x.purchasePrice) || 0;
      var cpu = typeof x.costPerUnit === "number" ? x.costPerUnit : parseFloat(x.costPerUnit) || 0;
      if (!ledgerConsumptionByIngredient[iid]) {
        ledgerConsumptionByIngredient[iid] = {
          ingredientId: iid,
          name: ingName,
          unit: unit,
          totalQtyConsumed: 0,
          totalCostConsumed: 0,
          costPerUnit: cpu
        };
      }
      ledgerConsumptionByIngredient[iid].totalQtyConsumed += consumedQty;
      ledgerConsumptionByIngredient[iid].totalCostConsumed += consumedCost;
    }
  });
  var wastageAgg = finalizeWastageAgg(wastageState);
  var wastageByIngId = {};
  wastageAgg.wastageByIngredient.forEach(function (row) {
    wastageByIngId[row.ingredientId] = row;
  });

  ledgerPurchaseRm = round2(ledgerPurchaseRm);

  var ledgerAgg = Object.keys(ledgerByIngredient)
    .map(function (k) {
      var row = ledgerByIngredient[k];
      row.ledgerSpendRm = round2(row.ledgerSpendRm);
      row.totalQtyPurchased = round4(row.totalQtyPurchased);
      return row;
    })
    .sort(function (a, b) { return b.ledgerSpendRm - a.ledgerSpendRm; })
    .slice(0, 40);

  var consumptionAgg = Object.keys(ledgerConsumptionByIngredient)
    .map(function (k) {
      var row = ledgerConsumptionByIngredient[k];
      row.totalQtyConsumed = round4(row.totalQtyConsumed);
      row.totalCostConsumed = round2(row.totalCostConsumed);
      return row;
    })
    .sort(function (a, b) { return b.totalCostConsumed - a.totalCostConsumed; });

  // Stok semasa dari ingredient_batches (elak query ledger sejarah penuh).
  var ingredientStockSummary = Object.keys(batchByIngredient).map(function(ingId) {
    var b = batchByIngredient[ingId];
    var name = ingNameById[ingId] || ingId;
    var unit = ingUnitById[ingId] || "unit";
    var qtyOriginal = round4(b.totalOriginal);
    var qtyRemaining = round4(b.totalRemaining);
    var thisMonthConsumption = ledgerConsumptionByIngredient[ingId];
    var thisMonthWastage = wastageByIngId[ingId];
    var qtyUsedThisMonth = thisMonthConsumption ? round4(thisMonthConsumption.totalQtyConsumed || 0) : 0;
    var qtyWastedThisMonth = thisMonthWastage ? round4(thisMonthWastage.totalQty || 0) : 0;
    var costWastedThisMonth = thisMonthWastage ? round2(thisMonthWastage.totalCostRm || 0) : 0;

    return {
      ingredientId: ingId,
      name: name,
      unit: unit,
      qtyOriginal: qtyOriginal,
      qtyUsedThisMonth: qtyUsedThisMonth,
      qtyWastedThisMonth: qtyWastedThisMonth,
      costWastedThisMonth: costWastedThisMonth,
      qtyRemaining: qtyRemaining,
      status: qtyRemaining <= 0 ? "habis" : qtyRemaining <= 5 ? "rendah" : "ok"
    };
  }).sort(function(a, b) { return a.name.localeCompare(b.name); });

  // Gabungkan pembelian dan penggunaan dalam satu senarai
  var allIngredientIds = new Set([
    ...Object.keys(ledgerByIngredient),
    ...Object.keys(ledgerConsumptionByIngredient),
    ...Object.keys(wastageByIngId)
  ]);

  var combinedIngredientSummary = Array.from(allIngredientIds).map(function(iid) {
    var purchase = ledgerByIngredient[iid] || {};
    var consumption = ledgerConsumptionByIngredient[iid] || {};
    var wasted = wastageByIngId[iid] || {};
    var name = purchase.name || consumption.name || wasted.name || ingNameById[iid] || iid;
    var unit = purchase.unit || consumption.unit || wasted.unit || "unit";
    var qtyBought = round4(purchase.totalQtyPurchased || 0);
    var qtyUsed = round4(consumption.totalQtyConsumed || 0);
    var qtyWasted = round4(wasted.totalQty || 0);
    var live = batchByIngredient[iid];
    var qtyRemaining = live ? round4(live.totalRemaining) : round4(Math.max(0, qtyBought - qtyUsed - qtyWasted));
    var costUsed = round2(consumption.totalCostConsumed || 0);
    var costWasted = round2(wasted.totalCostRm || 0);
    var costBought = round2(purchase.ledgerSpendRm || 0);
    return {
      ingredientId: iid,
      name: name,
      unit: unit,
      qtyBought: qtyBought,
      qtyUsed: qtyUsed,
      qtyWasted: qtyWasted,
      qtyRemaining: qtyRemaining,
      costBought: costBought,
      costUsed: costUsed,
      costWasted: costWasted
    };
  }).filter(function(x) {
    return x.qtyBought > 0 || x.qtyUsed > 0 || x.qtyWasted > 0;
  }).sort(function(a, b) {
    return b.costBought - a.costBought;
  });

  var legacySalesTotal = 0;
  var legacyCount = 0;
  salesLegacySnap.forEach(function (d) {
    var x = d.data();
    legacyCount += 1;
    legacySalesTotal += typeof x.subtotal === "number" ? x.subtotal : parseFloat(x.subtotal) || 0;
  });
  legacySalesTotal = round2(legacySalesTotal);

  var otherExpensesRm = 0;
  var wastageTotalRm = wastageAgg.wastageTotalRm;
  // Operasi bersih = Untung kasar - Gaji - Wastage
  // COGS = kos lot FIFO pada jualan sahaja. Wastage = kos lot belian yang dibuang.
  // purchaseTotalRm tidak ditolak (stok untuk masa hadapan; COGS sudah kira bahan terjual).
  var netOperating = round2(grossProfit - payrollTotal - wastageTotalRm - otherExpensesRm);

  progress("Menyimpan laporan…");
  var payload = {
    monthKey: key,
    calendarYear: year,
    calendarMonth: month1to12,
    boundsNote:
      "Julat masa ikut tengah malam tempatan pelayar semasa penjanaan (new Date(year, month-1, 1) → bulan berikut).",
    generatedAt: serverTimestamp(),
    generatorVersion: 3,
    source: o.source || "user_regenerate",
    actorUid: o.actorUid != null ? String(o.actorUid) : "",
    rawMaterials: {
      purchaseHistoryDocumentCount: purchaseCount,
      purchaseHistoryTotalRm: purchaseTotalRm,
      purchaseHistoryTaxTotalRm: purchaseTaxTotalRm,
      purchaseTop: purchaseTop,
      ingredientLedgerEntriesInRange: ledgerDocs.length,
      ledgerSpendInitialPurchaseAdjustRm: ledgerPurchaseRm,
      ledgerKindCounts: ledgerKinds,
      topIngredientsByLedgerSpendRm: ledgerAgg,
      consumptionByIngredient: consumptionAgg,
      ingredientSummary: combinedIngredientSummary,
      ingredientStockSummary: ingredientStockSummary,
      wastageTotalRm: wastageTotalRm,
      wastageEntryCount: wastageAgg.wastageEntryCount,
      wastageByIngredient: wastageAgg.wastageByIngredient,
      ingredientsCatalogCount: ingSnap.size
    },
    sales: {
      posReceiptDocumentsInRange: receiptDocs.length,
      nonVoidReceiptCount: netReceiptCount,
      voidedReceiptCount: voidedCount,
      grossSalesSubtotalRm: grossSales,
      totalCogsFifoRm: totalCogs,
      grossProfitRm: grossProfit,
      byPaymentMethodRm: byPay,
      topMenuItems: topMenuItems,
      legacyColSalesDocumentCount: legacyCount,
      legacyColSalesSubtotalRm: legacySalesTotal,
      avgNonVoidSubtotalRm: avgNonVoidSubtotalRm
    },
    cashDrawer: {
      note:
        "Shift ditutup dalam julat: `status` == closed dan `closedAt` (Timestamp puncak dokumen) dalam bulan. Varians dari `closing.variance` atau actual − expected.",
      closedShiftsInRange: shiftDocs.length,
      totalVarianceRm: totalVarianceRm,
      varianceByCategory: varianceByCategory,
      shiftsSample: shiftLines.slice(0, 40)
    },
    staffSalary: {
      note:
        "Bahagian B — Kehadiran & Gaji (semua tugas). Gaji rata RM" +
        FIXED_STAFF_SALARY_RM +
        " sebulan setiap staf bukan-owner. totalHoursWorked/totalSessions dikira dari pasangan clock_in/clock_out sebenar (semua tugas).",
      staffCount: staffLines.length,
      activeStaffPayrollEstimateRm: payrollTotal,
      lines: staffLines
    },
    staffSalesPerformance: staffPerf.salesPerformance,
    company: {
      revenuePosReceiptsRm: grossSales,
      costOfGoodsFifoRm: totalCogs,
      grossProfitRm: grossProfit,
      inventoryPurchasesRecordedRm: purchaseTotalRm,
      payrollEstimateRm: payrollTotal,
      wastageRm: wastageTotalRm,
      otherExpensesRm: otherExpensesRm,
      netOperatingEstimateRm: netOperating,
      includesLegacySalesCollection: legacyCount > 0,
      narrative:
        "Anggaran operasi bersih = Untung kasar (Jualan - COGS jualan) - Gaji - Pembaziran. Pembaziran dikira dari harga lot belian yang dipilih semasa rekod, bukan harga katalog semasa. Pembelian stok (purchase_history) dipaparkan berasingan dan tidak ditolak dari operasi bersih."
    }
  };

  await setDoc(doc(db, COL_MONTHLY_REPORTS, key), payload);
  return { monthKey: key, payload: payload };
}
