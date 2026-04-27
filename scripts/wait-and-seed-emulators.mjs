#!/usr/bin/env node
/**
 * Tunggu Firestore emulator (port 8080), kemudian seed dengan FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST.
 * Dijadikan proses kedua bersama `firebase emulators:start` (lihat package.json "dev").
 */
import net from "net";
import { ensureAdminInitialized } from "./lib/admin-init.mjs";
import { runAllSeeds } from "./seed-run-all.mjs";

var HOST = process.env.FIRESTORE_EMULATOR_BIND || "127.0.0.1";
var PORT = parseInt(process.env.FIRESTORE_EMULATOR_PORT || "8080", 10);

function waitForPort(host, port, timeoutMs) {
  var start = Date.now();
  return new Promise(function (resolve, reject) {
    function tryOnce() {
      var sock = net.connect(port, host, function () {
        sock.end();
        resolve();
      });
      sock.on("error", function () {
        sock.destroy();
        if (Date.now() - start > timeoutMs) {
          reject(new Error("Timeout menunggu Firestore emulator pada " + host + ":" + port));
          return;
        }
        setTimeout(tryOnce, 500);
      });
    }
    tryOnce();
  });
}

async function main() {
  process.env.FIRESTORE_EMULATOR_HOST = (process.env.FIRESTORE_EMULATOR_HOST || HOST + ":" + PORT).replace(
    "http://",
    ""
  );
  process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";

  console.log("\n[seed] Menunggu emulator Firestore " + HOST + ":" + PORT + " …\n");
  await waitForPort(HOST, PORT, 120000);

  if (!ensureAdminInitialized()) {
    console.error("[seed] Admin SDK gagal — persekitaran emulator tidak konsisten.");
    process.exit(1);
  }
  await runAllSeeds();
  console.log("[seed] Selesai — emulator masih berjalan (proses lain).\n");
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
