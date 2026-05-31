/**
 * Utiliti agregat laporan — dikongsi dashboard, laporan bulanan & tahunan.
 */
import {
  collection,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  startAfter
} from "../firebase/init.js";

export var PAGE = 400;

export function pad2(n) {
  return (n < 10 ? "0" : "") + n;
}

export function round2(n) {
  return Math.round(n * 100) / 100;
}

/** Julat bulan kalendar setempat pelayar. */
export function localMonthBounds(year, month1to12) {
  var m0 = month1to12 - 1;
  var start = new Date(year, m0, 1, 0, 0, 0, 0);
  var end = new Date(year, m0 + 1, 1, 0, 0, 0, 0);
  return { start: start, end: end };
}

/** Julat tahun kalendar setempat pelayar (1 Jan – 1 Jan tahun berikut). */
export function localYearBounds(year) {
  var start = new Date(year, 0, 1, 0, 0, 0, 0);
  var end = new Date(year + 1, 0, 1, 0, 0, 0, 0);
  return { start: start, end: end };
}

export function monthDocId(year, month) {
  return year + "-" + pad2(month);
}

export function yearDocId(year) {
  return String(year);
}

export async function fetchPagedByRange(colName, field, tsStart, tsEnd) {
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
 * Agregat statistik jualan daripada dokumen pos_receipts (Firestore QueryDocumentSnapshot[]).
 * @returns {{
 *   grossSalesSubtotalRm: number,
 *   totalCogsFifoRm: number,
 *   grossProfitRm: number,
 *   nonVoidReceiptCount: number,
 *   voidedReceiptCount: number,
 *   posReceiptDocumentsInRange: number,
 *   byPaymentMethodRm: Record<string, number>,
 *   avgNonVoidSubtotalRm: number
 * }}
 */
export function aggregatePosReceiptDocs(receiptDocs) {
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
  return {
    posReceiptDocumentsInRange: receiptDocs.length,
    nonVoidReceiptCount: netReceiptCount,
    voidedReceiptCount: voidedCount,
    grossSalesSubtotalRm: grossSales,
    totalCogsFifoRm: totalCogs,
    grossProfitRm: grossProfit,
    byPaymentMethodRm: byPay,
    avgNonVoidSubtotalRm: netReceiptCount > 0 ? round2(grossSales / netReceiptCount) : 0
  };
}

/** Kunci bulan YYYY-MM daripada Timestamp Firestore (masa setempat pelayar). */
export function monthKeyFromTimestamp(ts) {
  if (!ts) return "";
  var d;
  try {
    d = typeof ts.toDate === "function" ? ts.toDate() : new Date(ts);
  } catch (e) {
    return "";
  }
  if (!d || isNaN(d.getTime())) return "";
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1);
}

/** Agregat resit mengikut bulan dalam julat tahun. */
export function aggregateReceiptsByMonth(receiptDocs, year) {
  var buckets = {};
  for (var m = 1; m <= 12; m += 1) {
    buckets[monthDocId(year, m)] = [];
  }
  receiptDocs.forEach(function (d) {
    var x = d.data();
    if (x.voided) return;
    var key = monthKeyFromTimestamp(x.createdAt);
    if (!key || key.indexOf(String(year) + "-") !== 0) return;
    if (!buckets[key]) buckets[key] = [];
    buckets[key].push(d);
  });
  var rows = [];
  for (var mi = 1; mi <= 12; mi += 1) {
    var mk = monthDocId(year, mi);
    var stats = aggregatePosReceiptDocs(buckets[mk] || []);
    rows.push({
      monthKey: mk,
      calendarMonth: mi,
      grossSalesSubtotalRm: stats.grossSalesSubtotalRm,
      totalCogsFifoRm: stats.totalCogsFifoRm,
      grossProfitRm: stats.grossProfitRm,
      nonVoidReceiptCount: stats.nonVoidReceiptCount
    });
  }
  return rows;
}
