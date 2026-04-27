#!/usr/bin/env node
/**
 * Buang sisa backend SQLite / folder server jika tidak dikunci oleh proses lain.
 */
import { rmSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

var __dirname = path.dirname(fileURLToPath(import.meta.url));
var root = path.resolve(__dirname, "..");
var serverDir = path.join(root, "server");

if (!existsSync(serverDir)) {
  console.log("Tiada folder server/ — tiada apa untuk dibuang.");
  process.exit(0);
}

try {
  rmSync(serverDir, { recursive: true, force: true, maxRetries: 2, retryDelay: 500 });
  console.log("OK — folder server/ dibuang.");
} catch (e) {
  console.warn("Tidak dapat padam server/ sepenuhnya (fail mungkin dikunci). Tutup Node/SQLite, kemudian padam manual:\n  " + serverDir);
  console.warn(e && e.message ? e.message : e);
  process.exit(1);
}
