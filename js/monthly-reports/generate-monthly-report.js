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
  COL_PURCHASE_HISTORY,
  COL_INGREDIENT_LEDGER,
  COL_INGREDIENTS,
  COL_STAFF,
  COL_SALES,
  COL_MONTHLY_REPORTS
} from "../firebase/collections.js";

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

function staffMonthlySalaryEstimate(data) {
  var pt = String(data.payType || "hourly").toLowerCase();
  var amt = typeof data.payAmount === "number" ? data.payAmount : parseFloat(data.payAmount) || 0;
  if (pt === "monthly" || pt === "salary" || pt === "bulanan") return round2(amt);
  return round2(amt * 160);
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

  var ingSnap = await getDocs(collection(db, COL_INGREDIENTS));
  var ingNameById = {};
  ingSnap.docs.forEach(function (d) {
    var x = d.data();
    ingNameById[d.id] = String(x.name || "").trim() || d.id;
  });

  var staffSnap = await getDocs(collection(db, COL_STAFF));
  var staffLines = [];
  var payrollTotal = 0;
  staffSnap.docs.forEach(function (d) {
    var x = d.data();
    var status = String(x.employmentStatus || "active");
    var est = staffMonthlySalaryEstimate(x);
    if (status === "active") payrollTotal += est;
    staffLines.push({
      staffId: d.id,
      name: String(x.name || "").trim() || "Tanpa nama",
      role: String(x.role || ""),
      employmentStatus: status,
      payType: String(x.payType || "hourly"),
      payAmount: typeof x.payAmount === "number" ? x.payAmount : parseFloat(x.payAmount) || 0,
      estimatedMonthlySalaryRm: est
    });
  });
  payrollTotal = round2(payrollTotal);

  var grossSales = 0;
  var totalCogs = 0;
  var voidedCount = 0;
  var netReceiptCount = 0;
  var byPay = {};
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
  });
  grossSales = round2(grossSales);
  totalCogs = round2(totalCogs);
  Object.keys(byPay).forEach(function (k) {
    byPay[k] = round2(byPay[k]);
  });
  var grossProfit = round2(grossSales - totalCogs);

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
  var ledgerKinds = {};
  ledgerDocs.forEach(function (d) {
    var x = d.data();
    var kind = String(x.kind || "");
    ledgerKinds[kind] = (ledgerKinds[kind] || 0) + 1;
    if (kind !== "purchase" && kind !== "initial" && kind !== "price_adjust") return;
    var price = typeof x.purchasePrice === "number" ? x.purchasePrice : parseFloat(x.purchasePrice) || 0;
    ledgerPurchaseRm += price;
    var iid = String(x.ingredientId || "");
    if (!iid) return;
    if (!ledgerByIngredient[iid]) {
      ledgerByIngredient[iid] = { ingredientId: iid, name: ingNameById[iid] || iid, ledgerSpendRm: 0, entryCount: 0 };
    }
    ledgerByIngredient[iid].ledgerSpendRm += price;
    ledgerByIngredient[iid].entryCount += 1;
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
  var netOperating = round2(grossProfit - purchaseTotalRm - payrollTotal - otherExpensesRm);

  var payload = {
    monthKey: key,
    calendarYear: year,
    calendarMonth: month1to12,
    boundsNote:
      "Julat masa ikut tengah malam tempatan pelayar semasa penjanaan (new Date(year, month-1, 1) → bulan berikut).",
    generatedAt: serverTimestamp(),
    generatorVersion: 1,
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
      legacyColSalesDocumentCount: legacyCount,
      legacyColSalesSubtotalRm: legacySalesTotal
    },
    staffSalary: {
      note:
        "Anggaran gaji: `monthly`/`salary`/`bulanan` = payAmount sebulan; selain itu hourly × 160 jam (anggapan FYP).",
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
        "Anggaran operasi = untung kasar − belian stok (purchase_history) − anggaran gaji aktif. Kos bahan dari resit (FIFO) sudah dalam COGS. Penyesuaian cukai / utiliti tidak disimpan dalam FYP ini."
    }
  };

  await setDoc(doc(db, COL_MONTHLY_REPORTS, key), payload);
  return { monthKey: key, payload: payload };
}
