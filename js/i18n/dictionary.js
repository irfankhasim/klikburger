/**
 * Kamus terjemahan TAB KAUNTER — digabung dari satu fail per bahagian sistem.
 *
 * TIGA PERATURAN PENTING SEMASA MENAMBAH ENTRI:
 *
 * 1. Entri `ms` mesti sama tepat dengan teks yang sudah dipakai dalam sistem.
 *    Kamus ini bukan tempat memperbaiki wording Melayu — ia cuma memindahkan teks
 *    sedia ada ke satu tempat. Ini memastikan pengguna Melayu tidak nampak apa-apa
 *    perubahan apabila i18n dihidupkan. Skrip `scripts/check-i18n-parity.mjs`
 *    menguatkuasakan peraturan ini terhadap versi git HEAD.
 *
 * 2. Istilah yang lebih lazim dalam Bahasa Inggeris dikekalkan dalam Bahasa
 *    Inggeris walaupun dalam mod Melayu, kerana itulah yang digunakan di kaunter
 *    sebenar. Contohnya: POS, Point Of Sale, Back Office, Clock In, Clock Out,
 *    drawer, shift, KDS, COGS, QR, void, refund. Istilah yang sudah lama diserap
 *    ke Bahasa Melayu pula dikekalkan dalam bentuk Melayu: resit, stok, inventori,
 *    menu, laporan, log masuk, kata laluan.
 *
 * 3. Setiap bahagian sistem memiliki failnya sendiri dalam `dict/`. Ini mengelak
 *    satu fail gergasi dan memudahkan beberapa orang menyunting serentak.
 */
import { SHELL } from "./dict/shell.js";
import { COST_CALCULATOR } from "./dict/cost-calculator.js";
import { DASHBOARD } from "./dict/dashboard.js";
import { ORDER } from "./dict/order.js";
import { RECEIPTS } from "./dict/receipts.js";
import { STAFF } from "./dict/staff.js";
import { REPORTS } from "./dict/reports.js";
import { SETTINGS } from "./dict/settings.js";
import { SHIFT } from "./dict/shift.js";
import { AI } from "./dict/ai.js";
import { WASTAGE } from "./dict/wastage.js";

var PARTS = [
  SHELL,
  COST_CALCULATOR,
  DASHBOARD,
  ORDER,
  RECEIPTS,
  STAFF,
  REPORTS,
  SETTINGS,
  SHIFT,
  AI,
  WASTAGE
];

/**
 * Gabungkan semua bahagian. Kunci bertindih antara fail adalah kesilapan, jadi
 * ia dilaporkan ke konsol daripada dibiarkan menang secara senyap.
 */
function merge(locale) {
  var out = {};
  PARTS.forEach(function (part) {
    var table = part[locale] || {};
    Object.keys(table).forEach(function (k) {
      if (Object.prototype.hasOwnProperty.call(out, k)) {
        console.warn("[i18n] kunci bertindih diabaikan: " + k);
        return;
      }
      out[k] = table[k];
    });
  });
  return out;
}

export var DICTIONARY = { ms: merge("ms"), en: merge("en") };
