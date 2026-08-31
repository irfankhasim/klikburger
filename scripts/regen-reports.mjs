#!/usr/bin/env node
/**
 * Jana semula laporan April & Mei 2026 dengan staffPerformance (Admin SDK).
 *
 * Jalankan:
 *   node scripts/regen-reports.mjs
 *
 * Perlu salah satu:
 *   - GOOGLE_APPLICATION_CREDENTIALS / firebase-service-account.json (cloud)
 *   - FIRESTORE_EMULATOR_HOST (emulator)
 */
import { pathToFileURL } from "url";
import { ensureAdminInitialized, getAdminFirestore } from "./lib/admin-init.mjs";
import { writeMonthlyReportAdmin } from "../mcp/lib/monthly-report-generate-admin.mjs";

var MONTHS = ["2026-04", "2026-05"];

async function main() {
  if (!ensureAdminInitialized()) {
    console.error("\n✗ Admin SDK tidak dimulakan.");
    console.error("  Set GOOGLE_APPLICATION_CREDENTIALS atau jalankan emulator Firestore.\n");
    console.error("Alternatif tanpa skrip:");
    console.error("  Back Office → Laporan penuh → pilih bulan → Jana laporan\n");
    process.exit(1);
  }

  var db = getAdminFirestore();
  console.log("\n→ Jana semula laporan:", MONTHS.join(", "), "\n");

  for (var i = 0; i < MONTHS.length; i++) {
    var key = MONTHS[i];
    process.stdout.write("  monthly_reports/" + key + " … ");
    await writeMonthlyReportAdmin(db, key, {
      source: "regen-reports.mjs",
      actorUid: "script"
    });
    console.log("ok");
  }

  console.log("\n✓ Selesai. Muat semula halaman Laporan penuh (Ctrl+Shift+R).\n");
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
