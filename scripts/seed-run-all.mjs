/**
 * Jalankan semua seed (Auth + POS + katalog burger) — dipanggil setup.mjs & wait-and-seed-emulators.
 */
import admin from "firebase-admin";
import { getAdminFirestore } from "./lib/admin-init.mjs";
import { seedDemoAuthUsers } from "./seed-demo-auth-users.mjs";
import { seedStaff23 } from "./seed-staff-23.mjs";
import { seedPosBootstrap } from "./seed-pos-bootstrap.mjs";
import { runBurgerCatalogSeed } from "./lib/seed-burger-catalog.mjs";

/** Pilihan — demo transaksi Apr/Mei 2026: `node scripts/seed-demo-transactions.mjs` */
export { seedDemoTransactions } from "./seed-demo-transactions.mjs";

export async function runAllSeeds() {
  console.log("\n→ Seed demo Auth + users/{uid}\n");
  await seedDemoAuthUsers();
  console.log("\n→ Seed kakitangan (23 staff tetap + staff_settings)\n");
  await seedStaff23();
  console.log("\n→ Seed POS bootstrap (pos_meta, drawer contoh)\n");
  await seedPosBootstrap({ withSampleShift: true, withSampleAudit: false });
  console.log("\n→ Seed katalog burger (ingredients, modifiers, batches)\n");
  var db = getAdminFirestore();
  await runBurgerCatalogSeed(db, admin.firestore.FieldValue, admin.firestore.Timestamp, { force: false });
  console.log("\n✓ Semua seed selesai.\n");
}
