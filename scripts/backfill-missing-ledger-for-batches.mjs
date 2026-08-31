#!/usr/bin/env node
/**
 * Backfill ingredient_ledger untuk batch (ingredient_batches) lama yang tiada
 * ledgerEntryId — batch ni wujud (stok sah, dikira dalam baki) tapi tak pernah
 * tercatat dalam "Sejarah belian" sebab dicipta oleh skrip seed lama yang
 * langkau ingredient_ledger terus.
 *
 * Jalankan:
 *   node scripts/backfill-missing-ledger-for-batches.mjs
 */
import { ensureAdminInitialized, getAdminFirestore } from "./lib/admin-init.mjs";
import admin from "firebase-admin";

var COL_INGREDIENTS = "ingredients";
var COL_INGREDIENT_LEDGER = "ingredient_ledger";
var COL_INGREDIENT_BATCHES = "ingredient_batches";

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

async function main() {
  if (!ensureAdminInitialized()) {
    console.error("\n✗ Admin SDK tidak dimulakan.\n");
    process.exit(1);
  }

  var db = getAdminFirestore();
  var FieldValue = admin.firestore.FieldValue;

  console.log("\n→ Backfill ledgerEntryId untuk batch lama...\n");

  var ingSnap = await db.collection(COL_INGREDIENTS).get();
  var fixedCount = 0;

  for (var i = 0; i < ingSnap.docs.length; i++) {
    var ingDoc = ingSnap.docs[i];
    var ing = ingDoc.data();
    var ingId = ingDoc.id;
    var name = String(ing.name || ingId);

    var batchSnap = await db
      .collection(COL_INGREDIENT_BATCHES)
      .where("ingredientId", "==", ingId)
      .get();

    for (var j = 0; j < batchSnap.docs.length; j++) {
      var batchDoc = batchSnap.docs[j];
      var b = batchDoc.data();
      if (b.ledgerEntryId) continue;

      var qty = typeof b.qtyOriginal === "number" ? b.qtyOriginal : parseFloat(b.qtyOriginal) || 0;
      var cpu = typeof b.costPerUnit === "number" ? b.costPerUnit : parseFloat(b.costPerUnit) || 0;
      var totalRm =
        typeof b.purchaseTotalRm === "number" && !isNaN(b.purchaseTotalRm)
          ? b.purchaseTotalRm
          : round2(cpu * qty);
      var unit = b.purchaseUnit || ing.unit || "g";
      var occurredAt = b.purchaseOccurredAt || b.openedAt || admin.firestore.Timestamp.now();

      var ledgerRef = await db.collection(COL_INGREDIENT_LEDGER).add({
        ingredientId: ingId,
        kind: "initial",
        occurredAt: occurredAt,
        purchasePrice: totalRm,
        purchaseQty: qty,
        unit: unit,
        costPerUnit: cpu,
        notes: "Backfill sejarah (batch sedia ada, dicipta sebelum ledger direkod).",
        nameSnapshot: name,
        createdAt: FieldValue.serverTimestamp()
      });

      await batchDoc.ref.update({ ledgerEntryId: ledgerRef.id });

      console.log("  + " + name + " — backfill batch " + batchDoc.id + " → ledger " + ledgerRef.id);
      fixedCount++;
    }
  }

  console.log("\n✓ Selesai. Batch dibaiki (ledger dicipta): " + fixedCount + "\n");
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
