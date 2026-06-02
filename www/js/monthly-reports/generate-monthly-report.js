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
  COL_SALES,
  COL_MONTHLY_REPORTS
} from "../firebase/collections.js";
import { varianceCategoryFromVariance } from "../drawer-variance.js";
import {
  staffSalaryForCalendarMonth,
  staffAccumulatedSalaryToDate,
  staffStartedAtIso
} from "./staff-salary-calc.js";

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
 */
export async function generateAndWriteMonthlyReport(year, month1to12, opts) {
  var o = opts || {};
  var bounds = localMonthBounds(year, month1to12);
  var tsStart = Timestamp.fromDate(bounds.start);
  var tsEnd = Timestamp.fromDate(bounds.end);
  var key = monthDocId(year, month1to12);

  var receiptDocs = await fetchPagedByRange(COL_POS_RECEIPTS, "createdAt", tsStart, tsEnd);
  var purchaseDocs = await fetchPagedByRange(COL_PURCHASE_HISTORY, "createdAt", tsStart, tsEnd);
  var ledgerDocs = await fetchPagedByRange(COL_INGREDIENT_LEDGER, "occurredAt", tsStart, tsEnd);
  var shiftDocs = await fetchClosedShiftsInRange(tsStart, tsEnd);

  var ingSnap = await getDocs(collection(db, COL_INGREDIENTS));
  // Ambil stok semasa dari ingredient_batches
  var batchSnap = await getDocs(collection(db, COL_INGREDIENT_BATCHES));
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

  var staffSnap = await getDocs(collection(db, COL_STAFF));
  var staffLines = [];
  var payrollTotal = 0;
  staffSnap.docs.forEach(function (d) {
    var x = d.data();
    var status = String(x.employmentStatus || "active");
    var est = staffSalaryForCalendarMonth(x, year, month1to12);
    if (status === "active" && est > 0) payrollTotal += est;
    staffLines.push({
      staffId: d.id,
      name: String(x.name || "").trim() || "Tanpa nama",
      role: String(x.role || ""),
      employmentStatus: status,
      payType: String(x.payType || "hourly"),
      payAmount: typeof x.payAmount === "number" ? x.payAmount : parseFloat(x.payAmount) || 0,
      startedAt: staffStartedAtIso(x),
      estimatedMonthlySalaryRm: est,
      accumulatedSalaryRm: staffAccumulatedSalaryToDate(x, year, month1to12)
    });
  });
  payrollTotal = round2(payrollTotal);

  var grossSales = 0;
  var totalCogs = 0;
  var voidedCount = 0;
  var netReceiptCount = 0;
  var byPay = {};
  var menuItemCounts = {};

  receiptDocs.forEach(function (d) {
    var x = d.data();
    var voided = !!x.voided;
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
    byPay[pm] = (byPay[pm] || 0) + sub;

    // Kira menu paling laris
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
  var purchaseCount = purchaseDocs.length;
  var purchaseTop = [];
  purchaseDocs.forEach(function (d) {
    var x = d.data();
    var t = typeof x.totalAmount === "number" ? x.totalAmount : parseFloat(x.totalAmount) || 0;
    purchaseTotalRm += t;
    purchaseTop.push({
      id: d.id,
      totalAmountRm: round2(t),
      notes: String(x.notes || "").slice(0, 120),
      supplier: String(x.supplier || "").slice(0, 80)
    });
  });
  purchaseTotalRm = round2(purchaseTotalRm);
  purchaseTop.sort(function (a, b) {
    return b.totalAmountRm - a.totalAmountRm;
  });
  purchaseTop = purchaseTop.slice(0, 25);

  var ledgerPurchaseRm = 0;
  var ledgerByIngredient = {};
  var ledgerConsumptionByIngredient = {};
  var ledgerKinds = {};
  ledgerDocs.forEach(function (d) {
    var x = d.data();
    var kind = String(x.kind || "");
    ledgerKinds[kind] = (ledgerKinds[kind] || 0) + 1;
    var iid = String(x.ingredientId || "");
    var ingName = ingNameById[iid] || String(x.nameSnapshot || iid);
    var unit = String(x.unit || "unit");
    if (kind === "purchase" || kind === "initial" || kind === "price_adjust") {
      var price = typeof x.purchasePrice === "number" ? x.purchasePrice : parseFloat(x.purchasePrice) || 0;
      ledgerPurchaseRm += price;
      if (!iid) return;
      if (!ledgerByIngredient[iid]) {
        ledgerByIngredient[iid] = { ingredientId: iid, name: ingName, ledgerSpendRm: 0, entryCount: 0 };
      }
      ledgerByIngredient[iid].ledgerSpendRm += price;
      ledgerByIngredient[iid].entryCount += 1;
    }
    if (kind === "sale_consumption") {
      if (!iid) return;
      var consumedQty = typeof x.purchaseQty === "number" ? Math.abs(x.purchaseQty) : parseFloat(x.purchaseQty) || 0;
      if (!ledgerConsumptionByIngredient[iid]) {
        ledgerConsumptionByIngredient[iid] = {
          ingredientId: iid,
          name: ingName,
          unit: unit,
          totalQtyConsumed: 0
        };
      }
      ledgerConsumptionByIngredient[iid].totalQtyConsumed += consumedQty;
    }
  });
  ledgerPurchaseRm = round2(ledgerPurchaseRm);
  var ledgerAgg = Object.keys(ledgerByIngredient)
    .map(function (k) {
      var row = ledgerByIngredient[k];
      row.ledgerSpendRm = round2(row.ledgerSpendRm);
      return row;
    })
    .sort(function (a, b) {
      return b.ledgerSpendRm - a.ledgerSpendRm;
    })
    .slice(0, 40);

  // Kira penggunaan kumulatif SEHINGGA akhir bulan ini sahaja
  var consumptionUpToThisMonth = {};

  // Ambil semua sale_consumption dari ingredient_ledger sehingga akhir bulan ini
  var consumptionLedgerSnap = await getDocs(
    query(
      collection(db, COL_INGREDIENT_LEDGER),
      where("kind", "==", "sale_consumption"),
      where("occurredAt", "<=", tsEnd)
    )
  );

  consumptionLedgerSnap.docs.forEach(function(d) {
    var x = d.data();
    var iid = String(x.ingredientId || "");
    if (!iid) return;
    var qty = typeof x.purchaseQty === "number" ? Math.abs(x.purchaseQty) : parseFloat(x.purchaseQty) || 0;
    consumptionUpToThisMonth[iid] = round4((consumptionUpToThisMonth[iid] || 0) + qty);
  });

  // Bina ingredientStockSummary
  // qtyRemaining = stok asal - semua penggunaan sehingga akhir bulan ini
  var ingredientStockSummary = Object.keys(batchByIngredient).map(function(ingId) {
    var b = batchByIngredient[ingId];
    var name = ingNameById[ingId] || ingId;
    var unit = ingUnitById[ingId] || "unit";
    var qtyOriginal = round4(b.totalOriginal);
    var qtyUsedUpToThisMonth = round4(consumptionUpToThisMonth[ingId] || 0);
    var qtyRemaining = round4(Math.max(0, qtyOriginal - qtyUsedUpToThisMonth));

    // Penggunaan bulan ini sahaja (dari consumptionAgg)
    var thisMonthConsumption = ledgerConsumptionByIngredient[ingId];
    var qtyUsedThisMonth = thisMonthConsumption ? round4(thisMonthConsumption.totalQtyConsumed || 0) : 0;

    return {
      ingredientId: ingId,
      name: name,
      unit: unit,
      qtyOriginal: qtyOriginal,
      qtyUsedThisMonth: qtyUsedThisMonth,
      qtyUsedUpToThisMonth: qtyUsedUpToThisMonth,
      qtyRemaining: qtyRemaining,
      status: qtyRemaining <= 0 ? "habis" : qtyRemaining <= 5 ? "rendah" : "ok"
    };
  }).sort(function(a, b) { return a.name.localeCompare(b.name); });

  var salesLegacySnap = await fetchPagedByRange(COL_SALES, "createdAt", tsStart, tsEnd);
  var legacySalesTotal = 0;
  var legacyCount = 0;
  salesLegacySnap.forEach(function (d) {
    var x = d.data();
    legacyCount += 1;
    legacySalesTotal += typeof x.subtotal === "number" ? x.subtotal : parseFloat(x.subtotal) || 0;
  });
  legacySalesTotal = round2(legacySalesTotal);

  var otherExpensesRm = 0;
  // Operasi bersih = Untung kasar - Gaji - Perbelanjaan lain
  // purchaseTotalRm TIDAK ditolak dari sini kerana ia adalah pembelian stok
  // untuk masa hadapan, bukan kos operasi terus bulan ini (COGS sudah dalam grossProfit)
  var netOperating = round2(grossProfit - payrollTotal - otherExpensesRm);

  var payload = {
    monthKey: key,
    calendarYear: year,
    calendarMonth: month1to12,
    boundsNote:
      "Julat masa ikut tengah malam tempatan pelayar semasa penjanaan (new Date(year, month-1, 1) → bulan berikut).",
    generatedAt: serverTimestamp(),
    generatorVersion: 2,
    source: o.source || "user_regenerate",
    actorUid: o.actorUid != null ? String(o.actorUid) : "",
    rawMaterials: {
      purchaseHistoryDocumentCount: purchaseCount,
      purchaseHistoryTotalRm: purchaseTotalRm,
      purchaseTop: purchaseTop,
      ingredientLedgerEntriesInRange: ledgerDocs.length,
      ledgerSpendInitialPurchaseAdjustRm: ledgerPurchaseRm,
      ledgerKindCounts: ledgerKinds,
      topIngredientsByLedgerSpendRm: ledgerAgg,
      ingredientStockSummary: ingredientStockSummary,
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
        "Anggaran gaji bulan ini prorata mengikut tarikh mula kerja. Gaji tetap = payAmount sebulan; gaji jam = kadar × 160 jam. Medan accumulatedSalaryRm = jumlah terkumpul dari tarikh mula hingga akhir bulan laporan.",
      staffCount: staffLines.length,
      activeStaffPayrollEstimateRm: payrollTotal,
      lines: staffLines
    },
    company: {
      revenuePosReceiptsRm: grossSales,
      costOfGoodsFifoRm: totalCogs,
      grossProfitRm: grossProfit,
      inventoryPurchasesRecordedRm: purchaseTotalRm,
      payrollEstimateRm: payrollTotal,
      otherExpensesRm: otherExpensesRm,
      netOperatingEstimateRm: netOperating,
      includesLegacySalesCollection: legacyCount > 0,
      narrative:
        "Anggaran operasi bersih = Untung kasar (Jualan - COGS) - Anggaran gaji pekerja aktif. Pembelian stok (purchase_history) dipaparkan berasingan sebagai maklumat perbelanjaan inventori — ia tidak ditolak dari operasi bersih kerana COGS sudah mengambil kira kos bahan yang digunakan."
    }
  };

  await setDoc(doc(db, COL_MONTHLY_REPORTS, key), payload);
  return { monthKey: key, payload: payload };
}
