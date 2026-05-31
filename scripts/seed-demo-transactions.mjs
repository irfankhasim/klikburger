#!/usr/bin/env node
/**
 * Seed transaksi demo realistik — April & Mei 2026 sahaja.
 * Tulis pos_receipts, sales, pos_shifts, purchase_history, ingredient_ledger.
 *
 * Jalankan: node scripts/seed-demo-transactions.mjs
 */
import { pathToFileURL } from "url";
import { Timestamp } from "firebase-admin/firestore";
import { ensureAdminInitialized, getAdminFirestore } from "./lib/admin-init.mjs";
import {
  COL_INGREDIENTS,
  COL_INGREDIENT_LEDGER,
  COL_POS_RECEIPTS,
  COL_POS_SHIFTS,
  COL_PURCHASE_HISTORY,
  COL_SALES,
  COL_STAFF
} from "../js/firebase/collections.js";

var STAFF_ROSTER_IDS = ["kb_roster_01", "kb_roster_02", "kb_roster_03", "kb_roster_04", "kb_roster_05"];

var TABLES = ["T1", "T2", "T3", "T4", "T5", "T6"];

var MENU_ITEMS = [
  { name: "Burger ayam biasa", unitPrice: 5.5, cogsFifo: 1.85, weight: 25 },
  { name: "Burger daging biasa", unitPrice: 6.0, cogsFifo: 2.1, weight: 20 },
  { name: "Burger ayam istimewa", unitPrice: 7.0, cogsFifo: 2.45, weight: 15 },
  { name: "Burger daging istimewa", unitPrice: 7.5, cogsFifo: 2.8, weight: 12 },
  { name: "Burger ayam rangup", unitPrice: 8.5, cogsFifo: 2.95, weight: 10 },
  { name: "Obolong ayam biasa", unitPrice: 6.5, cogsFifo: 2.2, weight: 10 },
  { name: "Set kentang + air", unitPrice: 4.5, cogsFifo: 1.2, weight: 8 }
];

var SUPPLIERS = [
  "Pembekal Ayam Maju",
  "Roti & Bakeri Segar",
  "Pasaran Borong Selayang",
  "Syarikat Minyak & SOS",
  "Pembekal Sayur Segar"
];

var MONTH_CONFIGS = [
  {
    year: 2026,
    month: 4,
    label: "April 2026",
    closedDays: [6, 13, 20, 27],
    txMin: 8,
    txMax: 12,
    purchaseEvents: { min: 6, max: 7 },
    purchaseTotal: { min: 680, max: 750 }
  },
  {
    year: 2026,
    month: 5,
    label: "Mei 2026",
    closedDays: [4, 11, 18, 25],
    txMin: 12,
    txMax: 18,
    purchaseEvents: { min: 8, max: 9 },
    purchaseTotal: { min: 950, max: 1100 }
  }
];

function roundMoney(n) {
  return Math.round(n * 100) / 100;
}

function randInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function randFloat(min, max) {
  return min + Math.random() * (max - min);
}

function padReceiptNo(n) {
  return "RCP-" + String(n).padStart(4, "0");
}

function shiftCodeForDate(year, month, day) {
  var m = String(month).padStart(2, "0");
  var d = String(day).padStart(2, "0");
  return "SHF-" + year + m + d;
}

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function isClosedDay(day, closedDays) {
  return closedDays.indexOf(day) >= 0;
}

function pickWeightedMenu() {
  var total = MENU_ITEMS.reduce(function (s, x) {
    return s + x.weight;
  }, 0);
  var r = Math.random() * total;
  for (var i = 0; i < MENU_ITEMS.length; i++) {
    r -= MENU_ITEMS[i].weight;
    if (r <= 0) return MENU_ITEMS[i];
  }
  return MENU_ITEMS[0];
}

function pickPaymentMethod() {
  var r = Math.random();
  if (r < 0.35) return "cash";
  if (r < 0.75) return "qr";
  return "ewallet";
}

function pickVarianceCategory() {
  var r = Math.random();
  if (r < 0.7) return "balanced";
  if (r < 0.85) return "short";
  return "over";
}

function randomTransactionTime(year, month, day) {
  var hour = randInt(11, 20);
  var minute = randInt(0, 59);
  var second = randInt(0, 59);
  return new Date(year, month - 1, day, hour, minute, second);
}

function shiftOpenTime(year, month, day) {
  return new Date(year, month - 1, day, 11, 0, 0);
}

function shiftCloseTime(year, month, day) {
  return new Date(year, month - 1, day, 21, 0, 0);
}

function buildReceiptLine(item, qty) {
  var subtotal = roundMoney(item.unitPrice * qty);
  var cogsFifo = roundMoney(item.cogsFifo * qty);
  return {
    name: item.name,
    qty: qty,
    unitPrice: item.unitPrice,
    subtotal: subtotal,
    cogsFifo: cogsFifo
  };
}

function buildReceiptPayload(receiptNo, createdAt, staff, lines, paymentMethod, table) {
  var subtotal = roundMoney(
    lines.reduce(function (s, ln) {
      return s + ln.subtotal;
    }, 0)
  );
  var totalCogsFifo = roundMoney(
    lines.reduce(function (s, ln) {
      return s + ln.cogsFifo;
    }, 0)
  );
  var ts = Timestamp.fromDate(createdAt);
  return {
    receiptNo: receiptNo,
    createdAt: ts,
    staffId: staff.id,
    staffName: staff.name,
    lines: lines,
    subtotal: subtotal,
    totalCogsFifo: totalCogsFifo,
    paymentMethod: paymentMethod,
    voided: false,
    table: table,
    updatedAt: ts
  };
}

function mirrorSalesPayload(receipt) {
  return {
    createdAt: receipt.createdAt,
    staffId: receipt.staffId,
    staffName: receipt.staffName,
    lines: receipt.lines,
    subtotal: receipt.subtotal,
    totalCogsFifo: receipt.totalCogsFifo,
    paymentMethod: receipt.paymentMethod,
    voided: receipt.voided,
    table: receipt.table,
    updatedAt: receipt.updatedAt,
    receiptNo: receipt.receiptNo
  };
}

async function monthHasReceipts(db, year, month) {
  var start = Timestamp.fromDate(new Date(year, month - 1, 1, 0, 0, 0));
  var end = Timestamp.fromDate(new Date(year, month, 1, 0, 0, 0));
  var snap = await db
    .collection(COL_POS_RECEIPTS)
    .where("createdAt", ">=", start)
    .where("createdAt", "<", end)
    .limit(1)
    .get();
  return !snap.empty;
}

async function loadStaffRoster(db) {
  var roster = [];
  for (var i = 0; i < STAFF_ROSTER_IDS.length; i++) {
    var id = STAFF_ROSTER_IDS[i];
    var snap = await db.collection(COL_STAFF).doc(id).get();
    if (snap.exists) {
      var d = snap.data();
      roster.push({
        id: id,
        name: String(d.name || id).trim(),
        role: String(d.role || "cashier")
      });
    }
  }
  if (roster.length >= 2) return roster;

  var all = await db.collection(COL_STAFF).limit(5).get();
  all.docs.forEach(function (docSnap) {
    var d = docSnap.data();
    roster.push({
      id: docSnap.id,
      name: String(d.name || docSnap.id).trim(),
      role: String(d.role || "cashier")
    });
  });
  if (roster.length === 0) {
    throw new Error("Tiada rekod staff — jalankan seed-staff-23.mjs dahulu.");
  }
  return roster;
}

async function loadIngredients(db) {
  var snap = await db.collection(COL_INGREDIENTS).get();
  if (snap.empty) {
    throw new Error("Tiada bahan dalam ingredients — jalankan seed burger dahulu.");
  }
  return snap.docs.map(function (d) {
    var x = d.data();
    var purchasePrice = typeof x.purchasePrice === "number" ? x.purchasePrice : parseFloat(x.purchasePrice) || 0;
    var purchaseQty = typeof x.purchaseQty === "number" ? x.purchaseQty : parseFloat(x.purchaseQty) || 1;
    return {
      id: d.id,
      name: String(x.name || d.id).trim(),
      unit: String(x.unit || "unit"),
      purchasePrice: purchasePrice,
      purchaseQty: purchaseQty > 0 ? purchaseQty : 1
    };
  });
}

function splitTotalAcrossEvents(total, count) {
  var parts = [];
  var remain = total;
  for (var i = 0; i < count - 1; i++) {
    var slotsLeft = count - i;
    var avg = remain / slotsLeft;
    var lo = Math.max(40, avg * 0.65);
    var hi = Math.min(remain - (slotsLeft - 1) * 40, avg * 1.35);
    if (hi < lo) hi = lo;
    var part = roundMoney(lo + Math.random() * (hi - lo));
    parts.push(part);
    remain = roundMoney(remain - part);
  }
  parts.push(roundMoney(Math.max(remain, 40)));
  return parts;
}

function pickPurchaseDay(year, month, closedDays, usedDays) {
  var dim = daysInMonth(year, month);
  for (var attempt = 0; attempt < 40; attempt++) {
    var day = randInt(1, dim);
    if (isClosedDay(day, closedDays)) continue;
    if (usedDays.indexOf(day) >= 0) continue;
    return day;
  }
  for (var d = 1; d <= dim; d++) {
    if (!isClosedDay(d, closedDays)) return d;
  }
  return 1;
}

function buildPurchaseLines(ingredients, targetAmount) {
  var lines = [];
  var remain = targetAmount;
  var lineCount = randInt(2, Math.min(4, ingredients.length));
  var pool = ingredients.slice().sort(function () {
    return Math.random() - 0.5;
  });

  for (var i = 0; i < lineCount && remain > 0.5; i++) {
    var ing = pool[i % pool.length];
    var cpu = roundMoney(ing.purchasePrice / ing.purchaseQty);
    if (cpu <= 0) cpu = 1;
    var share = i === lineCount - 1 ? remain : roundMoney(remain / (lineCount - i) * randFloat(0.75, 1.25));
    share = Math.min(share, remain);
    var qty = Math.max(1, Math.round(share / cpu));
    var lineTotal = roundMoney(qty * cpu);
    if (lineTotal > remain + 0.01) {
      qty = Math.max(1, Math.floor(remain / cpu));
      lineTotal = roundMoney(qty * cpu);
    }
    lines.push({
      ingredientId: ing.id,
      label: ing.name,
      qty: qty,
      unit: ing.unit,
      unitCost: cpu,
      lineTotal: lineTotal,
      ing: ing
    });
    remain = roundMoney(remain - lineTotal);
  }

  if (lines.length === 0) {
    var fallback = ingredients[0];
    var fCpu = roundMoney(fallback.purchasePrice / fallback.purchaseQty) || 1;
    var fQty = Math.max(1, Math.round(targetAmount / fCpu));
    lines.push({
      ingredientId: fallback.id,
      label: fallback.name,
      qty: fQty,
      unit: fallback.unit,
      unitCost: fCpu,
      lineTotal: roundMoney(fQty * fCpu),
      ing: fallback
    });
  }

  var actualTotal = roundMoney(
    lines.reduce(function (s, ln) {
      return s + ln.lineTotal;
    }, 0)
  );
  return { lines: lines, totalAmount: actualTotal };
}

async function seedPurchasesForMonth(db, cfg, ingredients) {
  var eventCount = randInt(cfg.purchaseEvents.min, cfg.purchaseEvents.max);
  var targetTotal = roundMoney(randFloat(cfg.purchaseTotal.min, cfg.purchaseTotal.max));
  var amounts = splitTotalAcrossEvents(targetTotal, eventCount);
  var usedDays = [];
  var purchaseTotalRm = 0;

  console.log("  → " + eventCount + " pembelian stok (sasaran ~RM" + targetTotal.toFixed(2) + ")");

  for (var e = 0; e < eventCount; e++) {
    var day = pickPurchaseDay(cfg.year, cfg.month, cfg.closedDays, usedDays);
    usedDays.push(day);
    var purchaseDate = new Date(cfg.year, cfg.month - 1, day, randInt(9, 16), randInt(0, 59), 0);
    var purchaseTs = Timestamp.fromDate(purchaseDate);
    var built = buildPurchaseLines(ingredients, amounts[e]);
    var supplier = SUPPLIERS[randInt(0, SUPPLIERS.length - 1)];

    var phRef = await db.collection(COL_PURCHASE_HISTORY).add({
      createdAt: purchaseTs,
      supplier: supplier,
      totalAmount: built.totalAmount,
      notes: "Belian stok demo — " + cfg.label + " (" + purchaseDate.toLocaleDateString("ms-MY") + ")",
      lines: built.lines.map(function (ln) {
        return {
          ingredientId: ln.ingredientId,
          label: ln.label,
          qty: ln.qty,
          unit: ln.unit,
          unitCost: ln.unitCost,
          lineTotal: ln.lineTotal
        };
      })
    });

    for (var li = 0; li < built.lines.length; li++) {
      var row = built.lines[li];
      await db.collection(COL_INGREDIENT_LEDGER).add({
        ingredientId: row.ingredientId,
        kind: "purchase",
        occurredAt: purchaseTs,
        createdAt: purchaseTs,
        purchasePrice: row.lineTotal,
        purchaseQty: row.qty,
        unit: row.unit,
        costPerUnit: row.unitCost,
        nameSnapshot: row.label,
        notes: "Belian demo " + phRef.id
      });
    }

    purchaseTotalRm = roundMoney(purchaseTotalRm + built.totalAmount);
    console.log(
      "    pembelian " +
        (e + 1) +
        "/" +
        eventCount +
        " — RM" +
        built.totalAmount.toFixed(2) +
        " (" +
        purchaseDate.toLocaleDateString("ms-MY") +
        ")"
    );
  }

  return { purchaseCount: eventCount, purchaseTotalRm: purchaseTotalRm };
}

async function seedMonth(db, cfg, staffRoster, ingredients, receiptSeqStart) {
  var hasData = await monthHasReceipts(db, cfg.year, cfg.month);
  if (hasData) {
    console.log("\n⏭  " + cfg.label + " — resit sudah wujud, dilangkau.");
    return { skipped: true, receiptSeq: receiptSeqStart, receipts: 0, revenue: 0 };
  }

  console.log("\n→ Seed " + cfg.label);

  var dim = daysInMonth(cfg.year, cfg.month);
  var receiptSeq = receiptSeqStart;
  var monthReceipts = 0;
  var monthRevenue = 0;
  var dayIndex = 0;

  for (var day = 1; day <= dim; day++) {
    if (isClosedDay(day, cfg.closedDays)) continue;
    dayIndex += 1;

    try {
      var txCount = randInt(cfg.txMin, cfg.txMax);
      var shiftStaff = staffRoster[dayIndex % staffRoster.length];
      var dayTransactions = [];

      for (var t = 0; t < txCount; t++) {
        var createdAt = randomTransactionTime(cfg.year, cfg.month, day);
        var lineCount = Math.random() < 0.2 ? 2 : 1;
        var lines = [];
        var usedNames = {};
        for (var li = 0; li < lineCount; li++) {
          var item = pickWeightedMenu();
          var guard = 0;
          while (usedNames[item.name] && guard < 10) {
            item = pickWeightedMenu();
            guard += 1;
          }
          usedNames[item.name] = true;
          lines.push(buildReceiptLine(item, 1));
        }
        var cashier = staffRoster[randInt(0, staffRoster.length - 1)];
        dayTransactions.push({
          createdAt: createdAt,
          receiptNo: padReceiptNo(receiptSeq),
          payload: buildReceiptPayload(
            padReceiptNo(receiptSeq),
            createdAt,
            cashier,
            lines,
            pickPaymentMethod(),
            TABLES[randInt(0, TABLES.length - 1)]
          )
        });
        receiptSeq += 1;
      }

      dayTransactions.sort(function (a, b) {
        return a.createdAt - b.createdAt;
      });

      var cashSales = 0;
      for (var w = 0; w < dayTransactions.length; w++) {
        var rec = dayTransactions[w].payload;
        await db.collection(COL_POS_RECEIPTS).add(rec);
        await db.collection(COL_SALES).add(mirrorSalesPayload(rec));
        if (rec.paymentMethod === "cash") cashSales += rec.subtotal;
        monthReceipts += 1;
        monthRevenue = roundMoney(monthRevenue + rec.subtotal);
      }

      var openedAt = shiftOpenTime(cfg.year, cfg.month, day);
      var closedAt = shiftCloseTime(cfg.year, cfg.month, day);
      var expectedDrawer = roundMoney(200 + cashSales);
      var varianceCategory = pickVarianceCategory();
      var variance = 0;
      var actualDrawer = expectedDrawer;

      if (varianceCategory === "short") {
        variance = -roundMoney(randFloat(5, 25));
        actualDrawer = roundMoney(expectedDrawer + variance);
      } else if (varianceCategory === "over") {
        variance = roundMoney(randFloat(3, 15));
        actualDrawer = roundMoney(expectedDrawer + variance);
      } else {
        variance = roundMoney(randFloat(-0.5, 0.5));
        actualDrawer = roundMoney(expectedDrawer + variance);
        if (Math.abs(variance) < 0.01) varianceCategory = "balanced";
      }

      var note =
        varianceCategory === "balanced"
          ? "Drawer seimbang — hari operasi demo"
          : varianceCategory === "short"
            ? "Kurang tunai di akhir syif (demo)"
            : "Lebihan tunai di akhir syif (demo)";

      await db.collection(COL_POS_SHIFTS).add({
        shiftCode: shiftCodeForDate(cfg.year, cfg.month, day),
        status: "closed",
        openedAt: Timestamp.fromDate(openedAt),
        closedAt: Timestamp.fromDate(closedAt),
        openingCash: 200,
        closing: {
          expectedDrawer: expectedDrawer,
          actualDrawer: actualDrawer,
          variance: variance,
          varianceCategory: varianceCategory,
          note: note
        },
        openedByUserId: shiftStaff.id,
        openedByDisplayName: shiftStaff.name,
        openedByRole: shiftStaff.role,
        seededFrom: "seed-demo-transactions.mjs"
      });

      console.log(
        "  hari " +
          day +
          " — " +
          txCount +
          " resit, RM" +
          roundMoney(
            dayTransactions.reduce(function (s, x) {
              return s + x.payload.subtotal;
            }, 0)
          ).toFixed(2) +
          " jualan"
      );
    } catch (dayErr) {
      console.error("  ✗ hari " + day + " gagal:", dayErr.message || dayErr);
    }
  }

  var purchaseStats = await seedPurchasesForMonth(db, cfg, ingredients);

  console.log(
    "  ✓ " +
      cfg.label +
      ": " +
      monthReceipts +
      " resit, RM" +
      monthRevenue.toFixed(2) +
      " jualan kasar, RM" +
      purchaseStats.purchaseTotalRm.toFixed(2) +
      " pembelian stok"
  );

  return {
    skipped: false,
    receiptSeq: receiptSeq,
    receipts: monthReceipts,
    revenue: monthRevenue,
    purchaseTotalRm: purchaseStats.purchaseTotalRm
  };
}

/**
 * Seed transaksi demo Apr & Mei 2026.
 * @param {{ receiptSeqStart?: number }} [options]
 */
export async function seedDemoTransactions(options) {
  options = options || {};
  if (!ensureAdminInitialized()) {
    throw new Error("Admin SDK tidak sedia — credential atau emulator diperlukan.");
  }

  var db = getAdminFirestore();
  var staffRoster = await loadStaffRoster(db);
  var ingredients = await loadIngredients(db);

  console.log("Staff roster:", staffRoster.map(function (s) {
    return s.name;
  }).join(", "));
  console.log("Bahan tersedia:", ingredients.length);

  var receiptSeq = typeof options.receiptSeqStart === "number" ? options.receiptSeqStart : 4001;
  var totals = { receipts: 0, revenue: 0, skippedMonths: 0 };

  for (var m = 0; m < MONTH_CONFIGS.length; m++) {
    var result = await seedMonth(db, MONTH_CONFIGS[m], staffRoster, ingredients, receiptSeq);
    if (result.skipped) {
      totals.skippedMonths += 1;
    } else {
      totals.receipts += result.receipts;
      totals.revenue = roundMoney(totals.revenue + result.revenue);
    }
    receiptSeq = result.receiptSeq;
  }

  console.log("\n✓ Seed demo transaksi selesai.");
  console.log("  Jumlah resit baru:", totals.receipts);
  console.log("  Jumlah jualan kasar:", "RM" + totals.revenue.toFixed(2));
  if (totals.skippedMonths > 0) {
    console.log("  Bulan dilangkau (sudah ada data):", totals.skippedMonths);
  }

  return totals;
}

async function main() {
  console.log("Seed demo transaksi (Apr & Mei 2026) …");
  await seedDemoTransactions();
}

var isMain = false;
try {
  isMain = import.meta.url === pathToFileURL(process.argv[1]).href;
} catch (e) {}
if (isMain) {
  main().catch(function (err) {
    console.error(err);
    process.exit(1);
  });
}
