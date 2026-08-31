#!/usr/bin/env node
/**
 * Padam sejarah transaksi (jualan/staf/laporan) tanpa sentuh bahan mentah.
 * Bahan mentah (purchase_history, ingredient_ledger, ingredient_batches,
 * ingredients) SENGAJA dikecualikan — kekal selari dengan stok sebenar.
 *
 * Jalankan:
 *   node scripts/wipe-transaction-history.mjs
 *
 * Perlu GOOGLE_APPLICATION_CREDENTIALS / firebase-service-account.json (cloud)
 * atau FIRESTORE_EMULATOR_HOST (emulator).
 */
import { ensureAdminInitialized, getAdminFirestore } from "./lib/admin-init.mjs";

var TOP_LEVEL_COLLECTIONS = [
  "monthly_reports",
  "yearly_reports",
  "pos_receipts",
  "pos_sales_transactions",
  "staff_activity",
  "pos_audit_logs",
  "pos_active_shift"
];

// pos_shifts ada subkoleksi cash_movements — padam subdoc dulu, baru doc induk.
var SHIFTS_WITH_SUBCOLLECTION = "pos_shifts";
var SHIFT_SUBCOLLECTION = "cash_movements";

var BATCH_SIZE = 400;

async function deleteCollection(db, path) {
  var colRef = db.collection(path);
  var total = 0;
  while (true) {
    var snap = await colRef.limit(BATCH_SIZE).get();
    if (snap.empty) break;
    var batch = db.batch();
    snap.docs.forEach(function (d) {
      batch.delete(d.ref);
    });
    await batch.commit();
    total += snap.size;
    process.stdout.write("\r  " + path + " … " + total + " dipadam");
  }
  console.log(total > 0 ? "" : "\r  " + path + " … kosong (tiada apa-apa)");
  return total;
}

async function deleteShiftsWithSubcollection(db) {
  var colRef = db.collection(SHIFTS_WITH_SUBCOLLECTION);
  var total = 0;
  var subTotal = 0;
  while (true) {
    var snap = await colRef.limit(BATCH_SIZE).get();
    if (snap.empty) break;
    for (var i = 0; i < snap.docs.length; i++) {
      var shiftDoc = snap.docs[i];
      var subSnap = await shiftDoc.ref.collection(SHIFT_SUBCOLLECTION).get();
      if (!subSnap.empty) {
        var subBatch = db.batch();
        subSnap.docs.forEach(function (sd) {
          subBatch.delete(sd.ref);
        });
        await subBatch.commit();
        subTotal += subSnap.size;
      }
    }
    var batch = db.batch();
    snap.docs.forEach(function (d) {
      batch.delete(d.ref);
    });
    await batch.commit();
    total += snap.size;
    process.stdout.write("\r  " + SHIFTS_WITH_SUBCOLLECTION + " … " + total + " dipadam (" + subTotal + " cash_movements)");
  }
  console.log(total > 0 ? "" : "\r  " + SHIFTS_WITH_SUBCOLLECTION + " … kosong (tiada apa-apa)");
  return total;
}

async function main() {
  if (!ensureAdminInitialized()) {
    console.error("\n✗ Admin SDK tidak dimulakan.");
    console.error("  Set GOOGLE_APPLICATION_CREDENTIALS atau jalankan emulator Firestore.\n");
    process.exit(1);
  }

  var db = getAdminFirestore();
  console.log("\n→ Memadam sejarah transaksi (BUKAN bahan mentah)...\n");

  var grandTotal = 0;
  for (var i = 0; i < TOP_LEVEL_COLLECTIONS.length; i++) {
    grandTotal += await deleteCollection(db, TOP_LEVEL_COLLECTIONS[i]);
  }
  grandTotal += await deleteShiftsWithSubcollection(db);

  console.log("\n✓ Selesai. Jumlah dokumen dipadam: " + grandTotal);
  console.log("  Bahan mentah (purchase_history, ingredient_ledger, ingredient_batches, ingredients) TIDAK disentuh.\n");
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
