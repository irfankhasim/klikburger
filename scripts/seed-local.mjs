#!/usr/bin/env node
/**
 * Seed ke emulator yang **sudah** berjalan (npm run dev).
 * Tetapkan FIRESTORE_EMULATOR_HOST jika perlu; lalai 127.0.0.1:8080
 */
import { ensureAdminInitialized } from "./lib/admin-init.mjs";
import { runAllSeeds } from "./seed-run-all.mjs";

async function main() {
  process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
  process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";

  if (!ensureAdminInitialized()) {
    console.error("Gagal mulakan Admin SDK. Pastikan emulator Auth+Firestore berjalan.\n");
    process.exit(1);
  }
  await runAllSeeds();
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
