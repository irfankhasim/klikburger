#!/usr/bin/env node
/**
 * Padam SEMUA dokumen dalam monthly_reports dan yearly_reports (tiada archive).
 *
 * Jalankan:
 *   node scripts/wipe-reports.mjs
 *
 * Perlu GOOGLE_APPLICATION_CREDENTIALS / firebase-service-account.json (cloud)
 * atau FIRESTORE_EMULATOR_HOST (emulator).
 */
import { ensureAdminInitialized, getAdminFirestore } from "./lib/admin-init.mjs";

var REPORT_COLLECTIONS = ["monthly_reports", "yearly_reports"];
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
  if (total > 0) {
    console.log("");
  } else {
    console.log("\r  " + path + " … kosong (tiada dokumen)");
  }
  return total;
}

async function main() {
  if (!ensureAdminInitialized()) {
    console.error("\n✗ Admin SDK tidak dimulakan.");
    console.error("  Set GOOGLE_APPLICATION_CREDENTIALS atau jalankan emulator Firestore.\n");
    process.exit(1);
  }

  var db = getAdminFirestore();
  console.log("\n→ Memadam semua laporan bulanan & tahunan…\n");

  var grandTotal = 0;
  for (var i = 0; i < REPORT_COLLECTIONS.length; i++) {
    grandTotal += await deleteCollection(db, REPORT_COLLECTIONS[i]);
  }

  console.log("\n✓ Selesai. Jumlah dokumen dipadam: " + grandTotal);
  console.log("  Menu Laporan akan papar keadaan kosong sehingga laporan dijana semula.\n");
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
