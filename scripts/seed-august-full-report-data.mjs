#!/usr/bin/env node
/**
 * Jana data jualan Ogos 2026 yang SELARI dengan resipi menu (modifiers) & baki bahan
 * mentah semasa (ingredient_batches) — bukan data rawak. Setiap unit menu dijual akan
 * consume bahan ikut resipi sebenar, FIFO ikut batch (openedAt), dan baki batch
 * dikemaskini tepat mengikut jumlah sebenar yang "digunakan" untuk jualan ini.
 *
 * Skop: HANYA pos_receipts (Ogos 2026, 1-24 Ogos) + kemaskini ingredient_batches.qtyRemaining.
 * Tak sentuh purchase_history/ingredient_ledger (opening stock kekal sumber kebenaran).
 */
import { ensureAdminInitialized, getAdminFirestore } from "./lib/admin-init.mjs";
import admin from "firebase-admin";

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
function round4(n) {
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}

/** Tukar unit resipi (gunaUnit) ke unit stok bahan (ingredient.unit) — g<->kg sahaja perlu tukar. */
function usageInStockUnit(usageEntry, ingUnit) {
  if (typeof usageEntry === "number") return usageEntry;
  var guna = typeof usageEntry.guna === "number" ? usageEntry.guna : parseFloat(usageEntry.guna) || 0;
  var gunaUnit = String(usageEntry.gunaUnit || "").toLowerCase();
  var u = String(ingUnit || "").toLowerCase();
  if (gunaUnit === u) return guna;
  if (gunaUnit === "g" && u === "kg") return guna / 1000;
  if (gunaUnit === "kg" && u === "g") return guna * 1000;
  return guna;
}

// Sasaran jualan bulan Ogos — dalam lingkungan baki stok pcs (patty/roti/telur/cheese/ayam
// crispy) yang sedia ada dalam sistem, supaya tak overdraw bahan.
var TARGETS = [
  { id: "7pJJAGhh51VHrPjsBPsS", qty: 15 }, // Burger Ayam Crispy
  { id: "HYTwzGcPfhOr4adPbQlf", qty: 20 }, // Burger Daging Biasa
  { id: "JP8Av1yGj2qleJWBzLPK", qty: 20 }, // Burger Ayam Biasa
  { id: "KL2CnjqICUVRS2GZXrMZ", qty: 10 }, // Burger Daging Special
  { id: "nnWoL2CWdwNJGIfA3DB3", qty: 10 }, // Burger Ayam Special
  { id: "uUImr2JdLB9Cnjbtu1ZX", qty: 10 }, // Benjo
  { id: "ewhCULROgHAfEQauOtlq", qty: 15 }, // Oblong Daging Biasa
  { id: "i8MQNVaULRhajU3fvt6Q", qty: 10 }, // Oblong Ayam Special
  { id: "vx7rRoYFAZS0Ep9YBYjl", qty: 10 }, // Oblong Daging Special
  { id: "w9A8Dj7Z2PvZV52QPMAh", qty: 15 }, // Oblong Ayam Biasa
  { id: "hylYx1tllVuGpOo37n8p", qty: 25 }, // French Fries Spicy
  { id: "i98eYCA1F3b7VQs8Asex", qty: 40 } // French Fries BBQ
];

var CASHIERS = [
  { id: "Xvl7Hly3aNS8bqeoXL7R", name: "Aina", weight: 0.6 },
  { id: "b2mOuGiSgUHPOyU8GeJZ", name: "Danial", weight: 0.4 }
];

function pickCashier(rnd) {
  var r = rnd();
  var acc = 0;
  for (var i = 0; i < CASHIERS.length; i++) {
    acc += CASHIERS[i].weight;
    if (r <= acc) return CASHIERS[i];
  }
  return CASHIERS[CASHIERS.length - 1];
}

// PRNG mudah (seeded) — data konsisten setiap kali skrip dijalankan semula.
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function main() {
  if (!ensureAdminInitialized()) {
    console.error("\n✗ Admin SDK tidak dimulakan.\n");
    process.exit(1);
  }
  var db = getAdminFirestore();
  var FieldValue = admin.firestore.FieldValue;
  var Timestamp = admin.firestore.Timestamp;
  var rnd = mulberry32(20260801);

  console.log("\n→ Muatkan resipi menu (modifiers) & bahan mentah...\n");

  var modSnap = await db.collection("modifiers").get();
  var menuById = {};
  modSnap.docs.forEach(function (d) {
    var x = d.data();
    if (x.menuKind === "package") return; // pembungkus paparan sahaja, bukan item boleh jual
    menuById[d.id] = { id: d.id, name: x.name, sellingPrice: x.sellingPrice || 0, usage: x.usage || {} };
  });

  var ingSnap = await db.collection("ingredients").get();
  var ingById = {};
  ingSnap.docs.forEach(function (d) {
    ingById[d.id] = { id: d.id, name: d.data().name, unit: d.data().unit };
  });

  var batchSnap = await db.collection("ingredient_batches").get();
  var batchesByIng = {};
  batchSnap.docs.forEach(function (d) {
    var x = d.data();
    var ingId = String(x.ingredientId || "");
    if (!batchesByIng[ingId]) batchesByIng[ingId] = [];
    batchesByIng[ingId].push({
      ref: d.ref,
      id: d.id,
      qtyOriginal: typeof x.qtyOriginal === "number" ? x.qtyOriginal : parseFloat(x.qtyOriginal) || 0,
      costPerUnit: typeof x.costPerUnit === "number" ? x.costPerUnit : parseFloat(x.costPerUnit) || 0,
      openedAtMs: x.openedAt && typeof x.openedAt.toMillis === "function" ? x.openedAt.toMillis() : 0,
      consumed: 0 // dikira semasa simulasi, mula dari 0 (opening = qtyOriginal penuh)
    });
  });
  Object.keys(batchesByIng).forEach(function (ingId) {
    batchesByIng[ingId].sort(function (a, b) {
      return a.openedAtMs - b.openedAtMs;
    });
  });

  /** Consume qty daripada baris FIFO batch bahan; pulangkan { costTotal, ok } */
  function consumeIngredient(ingId, qtyNeeded) {
    var list = batchesByIng[ingId];
    if (!list || !list.length) return { costTotal: 0, ok: qtyNeeded <= 0 };
    var remaining = qtyNeeded;
    var costTotal = 0;
    for (var i = 0; i < list.length && remaining > 1e-9; i++) {
      var b = list[i];
      var avail = b.qtyOriginal - b.consumed;
      if (avail <= 0) continue;
      var take = Math.min(avail, remaining);
      b.consumed += take;
      costTotal += take * b.costPerUnit;
      remaining -= take;
    }
    return { costTotal: costTotal, ok: remaining <= 1e-6 };
  }

  // ── 1. Bina senarai unit jualan (satu entri = satu unit menu terjual) ───────
  var unitEvents = [];
  TARGETS.forEach(function (t) {
    var item = menuById[t.id];
    if (!item) {
      console.warn("  ! Item menu tak dijumpai:", t.id);
      return;
    }
    for (var i = 0; i < t.qty; i++) unitEvents.push(item);
  });

  // Kocak (seeded) supaya tersebar rawak antara jenis produk dalam pesanan.
  for (var i = unitEvents.length - 1; i > 0; i--) {
    var j = Math.floor(rnd() * (i + 1));
    var tmp = unitEvents[i];
    unitEvents[i] = unitEvents[j];
    unitEvents[j] = tmp;
  }

  // ── 2. Kumpul unit jadi "pesanan" (1-3 item setiap resit) ───────────────────
  var orders = [];
  var idx = 0;
  while (idx < unitEvents.length) {
    var lineCount = 1 + Math.floor(rnd() * 3); // 1-3 baris
    var lines = [];
    for (var k = 0; k < lineCount && idx < unitEvents.length; k++) {
      lines.push(unitEvents[idx]);
      idx++;
    }
    orders.push(lines);
  }

  console.log("  Jumlah unit menu:", unitEvents.length, "| Jumlah resit:", orders.length, "\n");
  console.log("→ Kira penggunaan bahan (FIFO) & jana resit...\n");

  // ── 3. Agih resit merentasi 1-24 Ogos 2026, jam operasi 10:00-21:30 ─────────
  var DAYS = 24;
  var receiptsToWrite = [];
  var overdrawErrors = [];
  var seq = 5000;

  orders.forEach(function (lines, orderIdx) {
    var dayOffset = Math.floor((orderIdx / orders.length) * DAYS);
    var day = 1 + Math.min(DAYS - 1, dayOffset);
    var hour = 10 + Math.floor(rnd() * 11); // 10-20
    var minute = Math.floor(rnd() * 60);
    var createdAtDate = new Date(2026, 7, day, hour, minute, Math.floor(rnd() * 60));

    // Group sama item dalam satu resit jadi satu baris (qty > 1)
    var grouped = {};
    lines.forEach(function (item) {
      if (!grouped[item.id]) grouped[item.id] = { item: item, qty: 0 };
      grouped[item.id].qty += 1;
    });

    var receiptLines = [];
    var subtotal = 0;
    var totalCogs = 0;
    var lineOk = true;

    Object.keys(grouped).forEach(function (mid) {
      var g = grouped[mid];
      var item = g.item;
      var qty = g.qty;
      var lineCogs = 0;
      Object.keys(item.usage).forEach(function (ingId) {
        var ing = ingById[ingId];
        if (!ing) return;
        var perUnit = usageInStockUnit(item.usage[ingId], ing.unit);
        var needed = perUnit * qty;
        var res = consumeIngredient(ingId, needed);
        if (!res.ok) {
          lineOk = false;
          overdrawErrors.push(item.name + " — bahan " + ing.name + " tak cukup baki.");
        }
        lineCogs += res.costTotal;
      });
      var lineTotal = round2(item.sellingPrice * qty);
      subtotal += lineTotal;
      totalCogs += lineCogs;
      receiptLines.push({
        id: mid,
        name: item.name,
        qty: qty,
        unitPrice: item.sellingPrice,
        lineTotal: lineTotal,
        cogsFifo: round4(lineCogs)
      });
    });

    if (!lineOk) return; // langkau resit ni jika bahan tak cukup (elak data tak konsisten)

    subtotal = round2(subtotal);
    totalCogs = round2(totalCogs);
    var grossProfit = round2(subtotal - totalCogs);
    var cashier = pickCashier(rnd);
    seq += 1;
    var receiptNo = "RCP-" + seq;

    receiptsToWrite.push({
      receiptNo: receiptNo,
      orderId: "seed-order-" + seq,
      orderNo: receiptNo,
      saleId: "seed-sale-" + seq,
      createdAt: Timestamp.fromDate(createdAtDate),
      paymentMethod: rnd() < 0.55 ? "cash" : rnd() < 0.85 ? "card" : "ewallet",
      subtotal: subtotal,
      taxPercent: 0,
      taxAmount: 0,
      total: subtotal,
      totalCogsFifo: totalCogs,
      totalGrossProfitFifo: grossProfit,
      voided: false,
      voidedAt: null,
      voidReason: null,
      refundNote: null,
      customerName: "",
      lines: receiptLines,
      staffId: cashier.id,
      staffName: cashier.name,
      operationalStaffId: cashier.id,
      operationalStaffName: cashier.name,
      source: "seed-august-full-report-data"
    });
  });

  if (overdrawErrors.length) {
    console.warn("  ! Amaran (resit dilangkau, bahan tak cukup):");
    overdrawErrors.slice(0, 10).forEach(function (e) {
      console.warn("    -", e);
    });
  }

  console.log("  Resit sah untuk ditulis:", receiptsToWrite.length, "\n");

  // ── 4. Tulis resit (pos_receipts) — batched ─────────────────────────────────
  console.log("→ Menulis pos_receipts...");
  for (var w = 0; w < receiptsToWrite.length; w += 400) {
    var batch = db.batch();
    receiptsToWrite.slice(w, w + 400).forEach(function (r) {
      var ref = db.collection("pos_receipts").doc();
      batch.set(ref, r);
    });
    await batch.commit();
  }
  console.log("  Selesai —", receiptsToWrite.length, "resit ditulis.\n");

  // ── 5. Kemaskini baki batch (ingredient_batches.qtyRemaining) ───────────────
  console.log("→ Kemaskini baki bahan mentah (ingredient_batches)...");
  var updateCount = 0;
  var batchWrite = db.batch();
  var opsInBatch = 0;
  for (var ingId in batchesByIng) {
    var list = batchesByIng[ingId];
    for (var bi = 0; bi < list.length; bi++) {
      var b = list[bi];
      if (b.consumed <= 0) continue;
      var newRemaining = round4(b.qtyOriginal - b.consumed);
      batchWrite.update(b.ref, { qtyRemaining: newRemaining });
      updateCount++;
      opsInBatch++;
      if (opsInBatch >= 400) {
        await batchWrite.commit();
        batchWrite = db.batch();
        opsInBatch = 0;
      }
    }
  }
  if (opsInBatch > 0) await batchWrite.commit();
  console.log("  Batch dikemaskini:", updateCount, "\n");

  // ── Ringkasan ────────────────────────────────────────────────────────────
  var totalRevenue = receiptsToWrite.reduce(function (s, r) {
    return s + r.subtotal;
  }, 0);
  var totalCogsSum = receiptsToWrite.reduce(function (s, r) {
    return s + r.totalCogsFifo;
  }, 0);
  console.log("✓ Selesai.");
  console.log("  Jumlah resit:", receiptsToWrite.length);
  console.log("  Jumlah jualan (subtotal):", "RM " + round2(totalRevenue).toFixed(2));
  console.log("  Jumlah COGS:", "RM " + round2(totalCogsSum).toFixed(2));
  console.log("  Untung kasar:", "RM " + round2(totalRevenue - totalCogsSum).toFixed(2), "\n");
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
