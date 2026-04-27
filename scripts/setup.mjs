#!/usr/bin/env node
/**
 * Setup terminal: seed Auth + Firestore POS + katalog burger, kemudian (pilihan) deploy rules/indexes.
 *
 * Bendera:
 *   --skip-deploy     Jangan jalankan firebase deploy
 *   --from-emulator-exec   Dipanggil oleh `firebase emulators:exec` (hanya seed)
 *   --seed-only       Hanya seed (sama seperti skip deploy + tiada cuba exec bersarang)
 */
import { spawnSync } from "child_process";
import path from "path";
import { ensureAdminInitialized, isEmulatorEnv } from "./lib/admin-init.mjs";
import { readDefaultFirebaseProjectId, getRepoRoot } from "./lib/read-project-id.mjs";
import { runAllSeeds } from "./seed-run-all.mjs";

var root = getRepoRoot();

function argvHas(flag) {
  return process.argv.includes(flag);
}

function deployFirestoreRulesAndIndexes() {
  console.log("\n→ firebase deploy --only firestore:rules,firestore:indexes\n");
  var r = spawnSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["firebase", "deploy", "--only", "firestore:rules,firestore:indexes", "--project", readDefaultFirebaseProjectId()],
    { cwd: root, stdio: "inherit", shell: true }
  );
  if (r.status !== 0) {
    console.warn("\n⚠ Deploy gagal — pastikan `firebase login` dan CLI ≥ 13. Cuba: npx firebase login\n");
    return false;
  }
  return true;
}

async function main() {
  var skipDeploy = argvHas("--skip-deploy") || argvHas("--from-emulator-exec") || argvHas("--seed-only");
  var seedOnly = argvHas("--seed-only");
  var fromExec = argvHas("--from-emulator-exec");

  if (fromExec) {
    if (!ensureAdminInitialized()) {
      console.error("Emulator exec: Admin gagal dimulakan (persekitaran emulator tidak lengkap?).");
      process.exit(1);
    }
    await runAllSeeds();
    return;
  }

  if (!seedOnly && !skipDeploy) {
    deployFirestoreRulesAndIndexes();
  }

  if (ensureAdminInitialized()) {
    await runAllSeeds();
    if (isEmulatorEnv()) {
      console.log("Nota: data ditulis ke Firestore **emulator** (tempatan).\n");
    }
    return;
  }

  console.log(
    "\nTiada firebase-service-account.json / GOOGLE_APPLICATION_CREDENTIALS / ADC — " +
      "cuba seed melalui Firebase Emulator Suite (satu kali verifikasi skrip)…\n"
  );
  var projectId = readDefaultFirebaseProjectId();
  var inner = ["firebase", "emulators:exec", "--only", "firestore,auth", "--project", projectId];
  inner.push("node", path.resolve(root, "scripts", "setup.mjs"), "--from-emulator-exec", "--skip-deploy");
  var r = spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", inner, {
    cwd: root,
    stdio: "inherit",
    shell: true
  });
  if (r.status !== 0) {
    console.error("\nEmulators:exec gagal — pasang Java/JDK jika Firestore emulator memerlukannya, atau jalankan:\n  npm run dev\n  (terminal lain) npm run seed:local\n");
    process.exit(r.status || 1);
  }
  console.log(
    "\n✓ Skrip seed disahkan dengan emulator.\n" +
      "Untuk isi **projek Firebase sebenar**, letak `firebase-service-account.json` (kunci Admin SDK) di punca repo, " +
      "kemudian jalankan semula: npm run setup\n"
  );

  if (!argvHas("--skip-deploy") && !seedOnly) {
    deployFirestoreRulesAndIndexes();
  }
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
