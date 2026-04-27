#!/usr/bin/env node
/**
 * Jana semula `js/firebase/config.js` daripada Firebase Management API (mengikut `firebase login`).
 * Selesaikan kebanyakan kes `auth/api-key-not-valid` apabila repo guna salinan lama / projek lain.
 *
 * Penggunaan:
 *   npx firebase login
 *   npm run sync:webconfig
 *   npm run sync:webconfig -- 1:XXXX:web:YYYY   # jika lebih satu app WEB
 */
import { readFileSync, writeFileSync, unlinkSync, existsSync } from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { readDefaultFirebaseProjectId, getRepoRoot } from "./lib/read-project-id.mjs";

var __dirname = path.dirname(fileURLToPath(import.meta.url));

function extractAppIdFromConfigJs(root) {
  var p = path.join(root, "js", "firebase", "config.js");
  if (!existsSync(p)) return null;
  var s = readFileSync(p, "utf8");
  var m = s.match(/appId:\s*"([^"]+)"/);
  return m ? m[1] : null;
}

function extractDatabaseUrlFromConfigJs(root) {
  var p = path.join(root, "js", "firebase", "config.js");
  if (!existsSync(p)) return null;
  var s = readFileSync(p, "utf8");
  var m = s.match(/databaseURL:\s*"([^"]+)"/);
  return m ? m[1] : null;
}

function normalizeWebConfig(raw, fallbackDatabaseUrl) {
  var cfg = raw && typeof raw === "object" ? raw : {};
  if (cfg.sdkConfig && typeof cfg.sdkConfig === "object") {
    cfg = cfg.sdkConfig;
  }
  var projectId = cfg.projectId || readDefaultFirebaseProjectId();
  var out = {
    apiKey: String(cfg.apiKey || ""),
    authDomain: String(cfg.authDomain || projectId + ".firebaseapp.com"),
    projectId: String(projectId),
    storageBucket: String(cfg.storageBucket || projectId + ".appspot.com"),
    messagingSenderId: String(cfg.messagingSenderId || ""),
    appId: String(cfg.appId || "")
  };
  if (cfg.measurementId) out.measurementId = String(cfg.measurementId);
  var dbUrl = cfg.databaseURL || fallbackDatabaseUrl;
  if (dbUrl) out.databaseURL = String(dbUrl);
  if (!out.apiKey || !out.appId) {
    throw new Error("Respons SDK tidak lengkap (apiKey / appId). Semak firebase login & project.");
  }
  return out;
}

function formatConfigJs(obj) {
  return (
    "/**\n" +
    " * Konfigurasi Firebase (web app) — dikemas kini oleh `npm run sync:webconfig`.\n" +
    " * Manual: Firebase Console → Tetapan projek → Aplikasi anda → SDK setup.\n" +
    " */\n" +
    "export const firebaseConfig = " +
    JSON.stringify(obj, null, 2) +
    ";\n"
  );
}

function main() {
  var root = getRepoRoot();
  var project = readDefaultFirebaseProjectId();
  var appId = process.argv[2] || process.env.FIREBASE_WEB_APP_ID || extractAppIdFromConfigJs(root);
  if (!appId) {
    console.error(
      "Tiada WEB App ID. Tambah app Web dalam Firebase Console, kemudian:\n" +
        "  npm run sync:webconfig -- 1:xxxxxxxx:web:xxxxxxxx\n" +
        "atau: set FIREBASE_WEB_APP_ID=...\n"
    );
    process.exit(1);
  }

  var tmp = path.join(root, "scripts", ".web-sdk-config.tmp.json");
  if (existsSync(tmp)) unlinkSync(tmp);

  var args = ["firebase", "apps:sdkconfig", "WEB", appId, "--project", project, "-o", tmp];
  var r = spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", args, {
    cwd: root,
    shell: true,
    encoding: "utf8"
  });
  if (r.status !== 0) {
    console.error(r.stdout || "", r.stderr || "", "\nPastikan: npx firebase login && projek dalam .firebaserc betul.");
    process.exit(r.status || 1);
  }
  if (!existsSync(tmp)) {
    console.error("Fail output tidak dijumpai:", tmp);
    process.exit(1);
  }

  var raw = JSON.parse(readFileSync(tmp, "utf8"));
  unlinkSync(tmp);

  var prevDb = extractDatabaseUrlFromConfigJs(root);
  var cfg = normalizeWebConfig(raw, prevDb);
  var target = path.join(root, "js", "firebase", "config.js");
  writeFileSync(target, formatConfigJs(cfg), "utf8");
  console.log("OK — dikemas kini:", target, "\nprojectId:", cfg.projectId, "appId:", cfg.appId);
  console.log(
    "\nJika Live Server (5500) masih ralat api-key: Google Cloud Console → APIs & Services → Credentials →\n" +
      "kunci API browser → sekatan HTTP referrer → tambah http://127.0.0.1:5500/* dan http://localhost:5500/*"
  );
}

main();
