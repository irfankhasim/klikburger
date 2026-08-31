#!/usr/bin/env node
/**
 * Pastikan setiap bahan mentah (ingredients) ada sekurang-kurangnya 2 batch/lot
 * (ingredient_batches) — cipta batch kedua (rekod belian susulan) untuk bahan
 * yang sekarang cuma ada 1 batch atau tiada langsung, guna kuantiti & harga
 * seunit terakhir bahan itu sebagai anggaran munasabah untuk batch baharu.
 *
 * Tulis serentak ke ingredient_batches, ingredient_ledger, dan purchase_history
 * (sama macam borang "Tambah belian" web) supaya sejarah konsisten.
 *
 * Jalankan:
 *   node scripts/seed-second-batch-per-ingredient.mjs
 *
 * Perlu GOOGLE_APPLICATION_CREDENTIALS / firebase-service-account.json (cloud)
 * atau FIRESTORE_EMULATOR_HOST (emulator).
 */
import { ensureAdminInitialized, getAdminFirestore } from "./lib/admin-init.mjs";
import admin from "firebase-admin";

var COL_INGREDIENTS = "ingredients";
var COL_INGREDIENT_LEDGER = "ingredient_ledger";
var COL_INGREDIENT_BATCHES = "ingredient_batches";
var COL_PURCHASE_HISTORY = "purchase_history";

function round4(n) {
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}
function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

async function main() {
  if (!ensureAdminInitialized()) {
    console.error("\n✗ Admin SDK tidak dimulakan.");
    console.error("  Set GOOGLE_APPLICATION_CREDENTIALS atau jalankan emulator Firestore.\n");
    process.exit(1);
  }

  var db = getAdminFirestore();
  var FieldValue = admin.firestore.FieldValue;
  var Timestamp = admin.firestore.Timestamp;

  console.log("\n→ Semak batch setiap bahan mentah...\n");

  var ingSnap = await db.collection(COL_INGREDIENTS).get();
  if (ingSnap.empty) {
    console.log("Tiada bahan mentah dalam koleksi ingredients. Selesai.\n");
    return;
  }

  var createdCount = 0;
  var skippedCount = 0;

  for (var i = 0; i < ingSnap.docs.length; i++) {
    var ingDoc = ingSnap.docs[i];
    var ing = ingDoc.data();
    var ingId = ingDoc.id;
    var name = String(ing.name || ingId);

    var batchSnap = await db
      .collection(COL_INGREDIENT_BATCHES)
      .where("ingredientId", "==", ingId)
      .get();

    if (batchSnap.size >= 2) {
      console.log("  · " + name + " — sudah ada " + batchSnap.size + " batch, langkau.");
      skippedCount++;
      continue;
    }

    // Anggaran kuantiti/harga batch baharu — guna qty/harga terakhir dokumen ingredient,
    // atau batch sedia ada (kalau ada satu), jatuh balik ke 1 unit / RM0 jika tiada langsung.
    var qty = typeof ing.purchaseQty === "number" ? ing.purchaseQty : parseFloat(ing.purchaseQty) || 1;
    var totalRm = typeof ing.purchasePrice === "number" ? ing.purchasePrice : parseFloat(ing.purchasePrice) || 0;
    var unit = ing.unit || "g";

    if (!batchSnap.empty) {
      var existing = batchSnap.docs[0].data();
      if (typeof existing.qtyOriginal === "number" && existing.qtyOriginal > 0) qty = existing.qtyOriginal;
      if (typeof existing.purchaseTotalRm === "number") totalRm = existing.purchaseTotalRm;
      if (existing.purchaseUnit) unit = existing.purchaseUnit;
    }

    var cpu = qty > 0 ? round4(totalRm / qty) : 0;
    var now = Timestamp.now();

    var ledgerRef = await db.collection(COL_INGREDIENT_LEDGER).add({
      ingredientId: ingId,
      kind: "purchase",
      occurredAt: now,
      purchasePrice: totalRm,
      purchaseQty: qty,
      unit: unit,
      costPerUnit: cpu,
      notes: "Batch kedua (seed).",
      nameSnapshot: name,
      createdAt: FieldValue.serverTimestamp()
    });

    await db.collection(COL_INGREDIENT_BATCHES).add({
      ingredientId: ingId,
      qtyRemaining: qty,
      qtyOriginal: qty,
      costPerUnit: cpu,
      openedAt: now,
      purchaseOccurredAt: now,
      purchaseTotalRm: round2(totalRm),
      purchaseUnit: unit,
      ledgerEntryId: ledgerRef.id,
      synthetic: false,
      createdAt: FieldValue.serverTimestamp()
    });

    await db.collection(COL_PURCHASE_HISTORY).add({
      createdAt: FieldValue.serverTimestamp(),
      totalAmount: round2(totalRm),
      supplier: "",
      notes: "Batch kedua (seed).",
      lines: [
        {
          ingredientId: ingId,
          label: name.slice(0, 120),
          qty: qty,
          unit: unit,
          unitCost: cpu,
          lineTotal: round2(totalRm)
        }
      ]
    });

    console.log("  + " + name + " — batch kedua dicipta (" + qty + " " + unit + ", RM " + round2(totalRm) + ").");
    createdCount++;
  }

  console.log(
    "\n✓ Selesai. Batch kedua dicipta: " + createdCount + ". Dilangkau (sudah cukup): " + skippedCount + ".\n"
  );
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
