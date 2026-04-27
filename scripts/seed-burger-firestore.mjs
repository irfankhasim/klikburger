#!/usr/bin/env node
/**
 * Isi Firestore (bahan + lot FIFO + lejar + menu / "products") — firebase-admin.
 *
 * Credential (satu):
 *   - firebase-service-account.json di punca repo, atau
 *   - GOOGLE_APPLICATION_CREDENTIALS, atau
 *   - Persekitaran emulator (FIRESTORE_EMULATOR_HOST) — tiada fail kunci diperlukan
 *
 * Laluan kunci CLI: node scripts/seed-burger-firestore.mjs C:\path\to\key.json
 */
import admin from "firebase-admin";
import { ensureAdminInitialized, getAdminFirestore, resolveServiceAccountPath, isEmulatorEnv } from "./lib/admin-init.mjs";
import { runBurgerCatalogSeed } from "./lib/seed-burger-catalog.mjs";

async function main() {
  if (!ensureAdminInitialized()) {
    console.error("\nTidak dapat mulakan Admin SDK.\n");
    console.error("  Pilihan A (Cloud): letak firebase-service-account.json atau tetapkan GOOGLE_APPLICATION_CREDENTIALS.");
    console.error("  Pilihan B (Emulator): jalankan `npm run dev` / emulator dengan FIRESTORE_EMULATOR_HOST.\n");
    process.exit(1);
  }
  var db = getAdminFirestore();
  var r = await runBurgerCatalogSeed(db, admin.firestore.FieldValue, admin.firestore.Timestamp, { force: false });
  if (r.skipped) {
    process.exit(2);
  }
  console.log("OK — seed burger siap.", {
    ...r,
    serviceAccount: isEmulatorEnv() ? "(emulator)" : resolveServiceAccountPath() || "ADC"
  });
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
