/**
 * Semakan i18n (baca sahaja).
 *
 * 1. Kedua-dua bahasa mesti mempunyai set kunci yang sama.
 * 2. Setiap kunci yang dirujuk oleh HTML (`data-i18n*`) atau JS (`tr("...")`)
 *    mesti ada dalam kamus.
 *
 * Jalankan: node scripts/check-i18n-keys.mjs
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DICTIONARY } from "../js/i18n/dictionary.js";

var problems = [];

// ── 1. Bandingkan set kunci antara bahasa ─────────────────────────────────────
var locales = Object.keys(DICTIONARY);
var base = locales[0];
var baseKeys = Object.keys(DICTIONARY[base]);

locales.slice(1).forEach(function (loc) {
  var keys = Object.keys(DICTIONARY[loc]);
  baseKeys
    .filter(function (k) {
      return keys.indexOf(k) < 0;
    })
    .forEach(function (k) {
      problems.push("hilang dalam " + loc + ": " + k);
    });
  keys
    .filter(function (k) {
      return baseKeys.indexOf(k) < 0;
    })
    .forEach(function (k) {
      problems.push("hilang dalam " + base + ": " + k);
    });
});

// ── 2. Kumpul kunci yang dirujuk ──────────────────────────────────────────────
var known = new Set(baseKeys);

/** Rujukan pasti — dipakai untuk mencari kunci yang tiada dalam kamus. */
var referenced = [];

/** Semua teks berpetik berbentuk kunci — dipakai untuk mencari kunci tidak terpakai. */
var quoted = [];

function scan(file, text) {
  // data-i18n="..", data-i18n-html/placeholder/title/aria-label/value/alt/doc-title
  var re = /data-i18n(?:-(?:html|placeholder|title|aria-label|value|alt|doc-title))?="([^"]+)"/g;
  var m;
  while ((m = re.exec(text))) referenced.push([file, m[1]]);

  // Atribut nav shell yang menyimpan kunci
  var re2 = /data-(?:pos-lead|pos-topbar|pos-title|topbar)="([^"]+)"/g;
  while ((m = re2.exec(text))) referenced.push([file, m[1]]);

  // Panggilan tr("...") dengan kunci literal
  var re3 = /\btr\("([^"]+)"\)/g;
  while ((m = re3.exec(text))) referenced.push([file, m[1]]);

  // Mana-mana teks berpetik yang merupakan kunci kamus dikira sebagai penggunaan.
  // Ini menangkap kunci yang dihantar secara tidak langsung — cth. disimpan dalam
  // deskriptor `activeShellView` atau dipilih melalui ternary.
  var re4 = /"([A-Za-z][\w]*(?:\.[\w]+)+)"/g;
  while ((m = re4.exec(text))) quoted.push(m[1]);
}

["html", "js"].forEach(function (dir) {
  (function walk(d) {
    readdirSync(d, { withFileTypes: true }).forEach(function (e) {
      var p = join(d, e.name);
      if (e.isDirectory()) return walk(p);
      if (!/\.(html|js)$/.test(e.name)) return;
      scan(p, readFileSync(p, "utf8"));
    });
  })(dir);
});

referenced.forEach(function (pair) {
  if (!known.has(pair[1])) {
    problems.push("kunci tiada dalam kamus: " + pair[1] + "  (" + pair[0] + ")");
  }
});

// Kunci tanpa tempat guna hanya menambah beban penyelenggaraan — laporkan supaya
// kamus kekal mencerminkan UI yang sebenar.
var used = new Set(
  referenced
    .map(function (p) {
      return p[1];
    })
    .concat(quoted)
);

/**
 * Kunci yang dibina pada masa jalan dan tidak dapat dilihat oleh pengesan teks.
 * - `lang.*`        : dibina dalam lang-toggle.js sebagai "lang." + kod bahasa
 * - `module.<mod>.*`: dibina dalam main-menu.js sebagai "module." + mod + ".x"
 */
var DYNAMIC = [/^lang\./, /^module\.(pos|bo)\.(tag|topbar|lead|panelTitle|panelBody)$/];

baseKeys.forEach(function (k) {
  if (used.has(k)) return;
  if (
    DYNAMIC.some(function (re) {
      return re.test(k);
    })
  ) {
    return;
  }
  problems.push("kunci tidak digunakan: " + k);
});

// ── Laporan ───────────────────────────────────────────────────────────────────
console.log("Bahasa       : " + locales.join(", "));
console.log("Jumlah kunci : " + baseKeys.length);
console.log("Rujukan      : " + referenced.length);

if (problems.length) {
  console.log("\nMASALAH (" + problems.length + "):");
  [...new Set(problems)].forEach(function (p) {
    console.log("  - " + p);
  });
  process.exit(1);
}

console.log("\nOK — semua kunci selari dan lengkap.");
