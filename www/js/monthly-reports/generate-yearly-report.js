/**
 * Agregat tahun kalendar → dokumen `yearly_reports/{YYYY}`.
 */
import {
  db,
  doc,
  setDoc,
  collection,
  getDoc,
  getDocs,
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
  COL_POS_SHIFTS,
  COL_MONTHLY_REPORTS,
  COL_YEARLY_REPORTS
} from "../firebase/collections.js";
import { varianceCategoryFromVariance } from "../drawer-variance.js";
import {
  localYearBounds,
  yearDocId,
  monthDocId,
  round2,
  fetchPagedByRange,
  aggregatePosReceiptDocs,
  aggregateReceiptsByMonth,
  PAGE
} from "../reports/aggregate-utils.js";
import { generateAndWriteMonthlyReport } from "./generate-monthly-report.js";

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
 * @param {number} year
 * @param {object} [opts]
 * @param {string} [opts.source]
 * @param {string} [opts.actorUid]
 * @param {boolean} [opts.ensureMonthlyReports] — jana laporan bulanan yang hilang dahulu
 */
export async function generateAndWriteYearlyReport(year, opts) {
  var o = opts || {};
  var bounds = localYearBounds(year);
  var tsStart = Timestamp.fromDate(bounds.start);
  var tsEnd = Timestamp.fromDate(bounds.end);
  var key = yearDocId(year);

  if (o.ensureMonthlyReports) {
    var now = new Date();
    var maxMonth = year < now.getFullYear() ? 12 : now.getMonth() + 1;
    for (var m = 1; m <= maxMonth; m += 1) {
      var mk = monthDocId(year, m);
      var existing = await getDoc(doc(db, COL_MONTHLY_REPORTS, mk));
      if (!existing.exists()) {
        await generateAndWriteMonthlyReport(year, m, {
          source: "yearly_report_prereq",
          actorUid: o.actorUid || ""
        });
      }
    }
  }

  var receiptDocs = await fetchPagedByRange(COL_POS_RECEIPTS, "createdAt", tsStart, tsEnd);
  var purchaseDocs = await fetchPagedByRange(COL_PURCHASE_HISTORY, "createdAt", tsStart, tsEnd);
  var shiftDocs = await fetchClosedShiftsInRange(tsStart, tsEnd);

  var salesStats = aggregatePosReceiptDocs(receiptDocs);
  var monthlyBreakdown = aggregateReceiptsByMonth(receiptDocs, year);

  var purchaseTotalRm = 0;
  purchaseDocs.forEach(function (d) {
    var x = d.data();
    purchaseTotalRm += typeof x.totalAmount === "number" ? x.totalAmount : parseFloat(x.totalAmount) || 0;
  });
  purchaseTotalRm = round2(purchaseTotalRm);

  var varianceByCategory = { balanced: 0, short: 0, over: 0, unknown: 0 };
  var totalVarianceRm = 0;
  shiftDocs.forEach(function (d) {
    var x = d.data();
    var clos = x.closing && typeof x.closing === "object" ? x.closing : {};
    var v = varianceFromClosing(clos);
    var cat = String(clos.varianceCategory || varianceCategoryFromVariance(v) || "unknown");
    if (varianceByCategory[cat] == null) cat = "unknown";
    varianceByCategory[cat] = (varianceByCategory[cat] || 0) + 1;
    if (typeof v === "number" && !isNaN(v)) totalVarianceRm += v;
  });
  totalVarianceRm = round2(totalVarianceRm);

  var grossProfit = salesStats.grossProfitRm;
  var netOperatingEstimate = round2(grossProfit - purchaseTotalRm);

  var payload = {
    yearKey: key,
    calendarYear: year,
    boundsNote:
      "Julat masa ikut tengah malam tempatan pelayar semasa penjanaan (1 Jan – 31 Dis " + year + ").",
    generatedAt: serverTimestamp(),
    generatorVersion: 1,
    source: o.source || "user_regenerate",
    actorUid: o.actorUid != null ? String(o.actorUid) : "",
    sales: salesStats,
    monthlyBreakdown: monthlyBreakdown,
    rawMaterials: {
      purchaseHistoryDocumentCount: purchaseDocs.length,
      purchaseHistoryTotalRm: purchaseTotalRm
    },
    cashDrawer: {
      closedShiftsInRange: shiftDocs.length,
      totalVarianceRm: totalVarianceRm,
      varianceByCategory: varianceByCategory
    },
    company: {
      revenuePosReceiptsRm: salesStats.grossSalesSubtotalRm,
      costOfGoodsFifoRm: salesStats.totalCogsFifoRm,
      grossProfitRm: grossProfit,
      inventoryPurchasesRecordedRm: purchaseTotalRm,
      netOperatingEstimateRm: netOperatingEstimate,
      narrative:
        "Laporan tahunan = agregat semua resit POS (bukan void) dalam tahun. Untung kasar = jualan − COGS (FIFO). Pecahan bulanan dalam monthlyBreakdown."
    }
  };

  await setDoc(doc(db, COL_YEARLY_REPORTS, key), payload);
  return { yearKey: key, payload: payload };
}

export { yearDocId, localYearBounds };
