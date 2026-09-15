/**
 * Semakan regresi i18n (baca sahaja).
 *
 * Mengekstrak teks Melayu asal dari versi git HEAD bagi fail yang diubah, lalu
 * memastikan kamus `ms` memulangkan teks yang SAMA TEPAT. Ini menghalang i18n
 * daripada mengubah paparan Bahasa Melayu secara senyap.
 *
 * Jalankan: node scripts/check-i18n-parity.mjs
 */
import { execFileSync } from "node:child_process";
import { DICTIONARY } from "../js/i18n/dictionary.js";

var ms = DICTIONARY.ms;
var en = DICTIONARY.en;

function headFile(path) {
  return execFileSync("git", ["show", "HEAD:" + path], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024
  });
}

var head = {
  "js/main-menu.js": headFile("js/main-menu.js"),
  "html/main-menu.html": headFile("html/main-menu.html"),
  "html/login.html": headFile("html/login.html")
};

/**
 * Setiap pasangan: kunci kamus → teks yang mesti wujud dalam fail HEAD.
 * Teks diambil terus dari kamus `ms`, jadi ujian ini gagal jika kamus tersasar.
 */
var CHECKS = [
  ["module.pos.tag", "js/main-menu.js"],
  ["module.pos.topbar", "js/main-menu.js"],
  ["module.pos.lead", "js/main-menu.js"],
  ["module.pos.panelTitle", "js/main-menu.js"],
  ["module.pos.panelBody", "js/main-menu.js"],
  ["module.bo.tag", "js/main-menu.js"],
  ["module.bo.topbar", "js/main-menu.js"],
  ["module.bo.lead", "js/main-menu.js"],
  ["module.bo.panelTitle", "js/main-menu.js"],
  ["module.bo.panelBody", "js/main-menu.js"],
  ["topbar.staff", "js/main-menu.js"],
  ["topbar.database", "js/main-menu.js"],
  ["topbar.fullReport", "js/main-menu.js"],
  ["topbar.dashboard", "js/main-menu.js"],
  ["topbar.clockPanel", "js/main-menu.js"],
  ["topbar.productMenu", "js/main-menu.js"],
  ["panel.clockInOut", "js/main-menu.js"],
  ["embed.title.staff", "js/main-menu.js"],
  ["embed.title.settings", "js/main-menu.js"],
  ["embed.title.fullReport", "js/main-menu.js"],
  ["embed.title.dashboard", "js/main-menu.js"],
  ["embed.title.productMenu", "js/main-menu.js"],
  ["embed.title.costCalc", "js/main-menu.js"],
  ["lead.staffMonitor", "js/main-menu.js"],
  ["lead.settingsDatabase", "js/main-menu.js"],
  ["lead.settingsStaff", "js/main-menu.js"],
  ["lead.fullReport", "js/main-menu.js"],
  ["lead.dashboard", "js/main-menu.js"],
  ["lead.calcCatalog", "js/main-menu.js"],
  ["lead.calcModifiers", "js/main-menu.js"],
  ["lead.calcIngredients", "js/main-menu.js"],

  ["lead.clockIn", "html/main-menu.html"],
  ["lead.sales", "html/main-menu.html"],
  ["lead.receipts", "html/main-menu.html"],
  ["lead.orderList", "html/main-menu.html"],
  ["embed.title.takeOrder", "html/main-menu.html"],
  ["embed.title.receipts", "html/main-menu.html"],
  ["embed.title.orderList", "html/main-menu.html"],
  ["topbar.takeOrder", "html/main-menu.html"],
  ["nav.section.operations", "html/main-menu.html"],
  ["nav.clockIn", "html/main-menu.html"],
  ["nav.sales", "html/main-menu.html"],
  ["nav.receipts", "html/main-menu.html"],
  ["nav.orderList", "html/main-menu.html"],
  ["nav.section.overview", "html/main-menu.html"],
  ["nav.dashboard", "html/main-menu.html"],
  ["nav.section.reports", "html/main-menu.html"],
  ["nav.fullReport", "html/main-menu.html"],
  ["nav.products", "html/main-menu.html"],
  ["nav.staff", "html/main-menu.html"],
  ["nav.section.inventory", "html/main-menu.html"],
  ["nav.ingredients", "html/main-menu.html"],
  ["nav.productsCost", "html/main-menu.html"],
  ["nav.section.system", "html/main-menu.html"],
  ["nav.settings", "html/main-menu.html"],
  ["common.logout", "html/main-menu.html"],
  ["module.title", "html/main-menu.html"],
  ["module.desc", "html/main-menu.html"],
  ["module.posHint", "html/main-menu.html"],
  ["module.boHint", "html/main-menu.html"],

  ["login.title", "html/login.html"],
  ["login.lead", "html/login.html"],
  ["login.email", "html/login.html"],
  ["login.emailPlaceholder", "html/login.html"],
  ["login.password", "html/login.html"],
  ["login.showPassword", "html/login.html"],
  ["login.submit", "html/login.html"],
  ["login.noAccount", "html/login.html"],
  ["login.requestAccess", "html/login.html"],
  ["login.srHeading", "html/login.html"],
  ["login.docTitle", "html/login.html"]
];

var problems = [];

CHECKS.forEach(function (pair) {
  var key = pair[0];
  var file = pair[1];
  var want = ms[key];

  if (want == null) {
    problems.push("kunci tiada dalam kamus ms: " + key);
    return;
  }
  // Kunci yang disapu melalui textContent menyimpan "&" biasa, tetapi sumber HEAD
  // mengekodkannya sebagai "&amp;". Bandingkan kedua-dua bentuk.
  var encoded = want.replace(/&(?!amp;)/g, "&amp;");
  if (head[file].indexOf(want) < 0 && head[file].indexOf(encoded) < 0) {
    problems.push(
      "teks ms tidak sepadan dengan HEAD " + file + "\n      kunci : " + key + "\n      kamus : " + JSON.stringify(want)
    );
  }
});

// Bahasa Inggeris mesti benar-benar berbeza untuk teks yang bermakna, kalau tidak
// ia tanda terjemahan tertinggal. Istilah yang sengaja dikekalkan dikecualikan.
var SAME_ON_PURPOSE = new Set([
  "lang.ms",
  "lang.en",
  "shell.modulePos",
  "shell.moduleBo",
  "module.pos.tag",
  "module.bo.tag",
  "panel.clockInOut",
  "nav.clockIn"
]);

Object.keys(ms).forEach(function (k) {
  if (SAME_ON_PURPOSE.has(k)) return;
  if (ms[k] === en[k]) problems.push("belum diterjemah (ms == en): " + k);
});

console.log("Kunci diperiksa terhadap HEAD : " + CHECKS.length);
console.log("Jumlah kunci kamus            : " + Object.keys(ms).length);

if (problems.length) {
  console.log("\nMASALAH (" + problems.length + "):");
  problems.forEach(function (p) {
    console.log("  - " + p);
  });
  process.exit(1);
}

console.log("\nOK — teks Melayu identik dengan HEAD, dan semua teks lain diterjemah.");
