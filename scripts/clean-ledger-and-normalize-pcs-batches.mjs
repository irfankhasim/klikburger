#!/usr/bin/env node
/**
 * 1) Padam rekod ingredient_ledger kind:"sale_consumption" (deduksi automatik
 *    jualan lama) supaya "Sejarah belian" tinggal rekod belian sebenar sahaja.
 * 2) Untuk bahan berunit "pcs", ganti 2 batch sedia ada dengan 2 batch bersih
 *    baharu — kuantiti dalam lingkungan 30-50 pcs, kos seunit dikekalkan
 *    daripada batch asal (munasabah, bukan anggaran salah dari skrip awal).
 */
import { ensureAdminInitialized, getAdminFirestore } from "./lib/admin-init.mjs";
import admin from "firebase-admin";

var COL_INGREDIENTS = "ingredients";
var COL_INGREDIENT_LEDGER = "ingredient_ledger";
var COL_INGREDIENT_BATCHES = "ingredient_batches";

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

async function deleteSaleConsumptionEntries(db) {
  var snap = await db.collection(COL_INGREDIENT_LEDGER).where("kind", "==", "sale_consumption").get();
  var count = 0;
  while (!snap.empty) {
    var batch = db.batch();
    snap.docs.forEach(function (d) {
      batch.delete(d.ref);
    });
    await batch.commit();
    count += snap.size;
    snap = await db.collection(COL_INGREDIENT_LEDGER).where("kind", "==", "sale_consumption").limit(400).get();
  }
  return count;
}

async function normalizePcsIngredient(db, FieldValue, Timestamp, ingDoc) {
  var ing = ingDoc.data();
  var ingId = ingDoc.id;
  var name = String(ing.name || ingId);

  var batchSnap = await db.collection(COL_INGREDIENT_BATCHES).where("ingredientId", "==", ingId).get();
  if (batchSnap.empty) return;

  // Kos seunit rujukan — guna batch SEDIA ADA yang paling munasabah (bukan hasil
  // anggaran salah skrip seed pertama): pilih costPerUnit median/pertama yg > 0.05
  // (elak nilai anggaran tak munasabah macam RM0.0009/pcs).
  var refCpu = 0;
  batchSnap.docs.forEach(function (d) {
    var cpu = typeof d.data().costPerUnit === "number" ? d.data().costPerUnit : 0;
    if (cpu > 0.05 && (refCpu === 0 || cpu < refCpu)) refCpu = cpu;
  });
  if (refCpu === 0) refCpu = 1;

  // Padam batch & ledger lama.
  for (var i = 0; i < batchSnap.docs.length; i++) {
    var b = batchSnap.docs[i].data();
    if (b.ledgerEntryId) {
      await db.collection(COL_INGREDIENT_LEDGER).doc(b.ledgerEntryId).delete().catch(function () {});
    }
    await batchSnap.docs[i].ref.delete();
  }

  var qtys = [40, 45];
  var now = Timestamp.now();

  for (var j = 0; j < qtys.length; j++) {
    var qty = qtys[j];
    var totalRm = round2(refCpu * qty);
    var occurredAt = j === 0 ? Timestamp.fromMillis(now.toMillis() - 30 * 24 * 3600 * 1000) : now;

    var ledgerRef = await db.collection(COL_INGREDIENT_LEDGER).add({
      ingredientId: ingId,
      kind: j === 0 ? "initial" : "purchase",
      occurredAt: occurredAt,
      purchasePrice: totalRm,
      purchaseQty: qty,
      unit: "pcs",
      costPerUnit: refCpu,
      notes: j === 0 ? "Batch 1 (dinormalisasi)." : "Batch 2 (dinormalisasi).",
      nameSnapshot: name,
      createdAt: FieldValue.serverTimestamp()
    });

    await db.collection(COL_INGREDIENT_BATCHES).add({
      ingredientId: ingId,
      qtyRemaining: qty,
      qtyOriginal: qty,
      costPerUnit: refCpu,
      openedAt: occurredAt,
      purchaseOccurredAt: occurredAt,
      purchaseTotalRm: totalRm,
      purchaseUnit: "pcs",
      ledgerEntryId: ledgerRef.id,
      synthetic: false,
      createdAt: FieldValue.serverTimestamp()
    });
  }

  console.log("  ~ " + name + " — 2 batch dinormalisasi (qty " + qtys.join("/") + " pcs, RM " + refCpu.toFixed(4) + "/pcs).");
}

async function main() {
  if (!ensureAdminInitialized()) {
    console.error("\n✗ Admin SDK tidak dimulakan.\n");
    process.exit(1);
  }
  var db = getAdminFirestore();
  var FieldValue = admin.firestore.FieldValue;
  var Timestamp = admin.firestore.Timestamp;

  console.log("\n→ Padam rekod sale_consumption...");
  var deleted = await deleteSaleConsumptionEntries(db);
  console.log("  Dipadam: " + deleted + " rekod.\n");

  console.log("→ Normalisasi batch bahan berunit pcs...");
  var ingSnap = await db.collection(COL_INGREDIENTS).get();
  for (var i = 0; i < ingSnap.docs.length; i++) {
    var ing = ingSnap.docs[i].data();
    if (String(ing.unit || "").toLowerCase() === "pcs") {
      await normalizePcsIngredient(db, FieldValue, Timestamp, ingSnap.docs[i]);
    }
  }

  console.log("\n✓ Selesai.\n");
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
