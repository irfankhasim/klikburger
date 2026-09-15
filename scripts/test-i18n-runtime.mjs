/**
 * Ujian runtime i18n tanpa pelayar.
 *
 * Memasang DOM + localStorage tiruan yang cukup untuk `locale.js`, kemudian
 * memeriksa: nilai lalai, carian t(), jatuh balik, kekalan pilihan, sapuan
 * atribut, dan pemberitahuan kepada pendengar.
 *
 * Jalankan: node scripts/test-i18n-runtime.mjs
 */

// ── DOM + storan tiruan (dipasang sebelum locale.js diimport) ─────────────────
function el(attrs, text) {
  return {
    attrs: Object.assign({}, attrs),
    textContent: text || "",
    innerHTML: "",
    getAttribute: function (n) {
      return Object.prototype.hasOwnProperty.call(this.attrs, n) ? this.attrs[n] : null;
    },
    setAttribute: function (n, v) {
      this.attrs[n] = v;
    },
    hasAttribute: function (n) {
      return Object.prototype.hasOwnProperty.call(this.attrs, n);
    },
    removeAttribute: function (n) {
      delete this.attrs[n];
    }
  };
}

var nodes = [
  el({ "data-i18n": "nav.receipts" }),
  el({ "data-i18n": "nav.settings" }),
  el({ "data-i18n-html": "lead.orderList" }),
  el({ "data-i18n-placeholder": "login.emailPlaceholder" }),
  el({ "data-i18n-aria-label": "common.close" }),
  el({ "data-i18n": "kunci.tidak.wujud" })
];

var store = {};
var docEl = el({});
var bodyEl = el({ "data-i18n-doc-title": "login.docTitle" });

global.window = {
  localStorage: {
    getItem: function (k) {
      return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null;
    },
    setItem: function (k, v) {
      store[k] = String(v);
    }
  },
  addEventListener: function () {}
};

global.document = {
  documentElement: docEl,
  body: bodyEl,
  title: "",
  querySelectorAll: function (sel) {
    var name = sel.slice(1, -1);
    return nodes.filter(function (n) {
      return n.hasAttribute(name);
    });
  }
};

global.BroadcastChannel = function () {
  this.addEventListener = function () {};
  this.postMessage = function () {};
};

// ── Import selepas stub sedia ─────────────────────────────────────────────────
var mod = await import("../js/i18n/locale.js");
var t = mod.t;

var failures = [];

function check(label, got, want) {
  var ok = got === want;
  if (!ok) failures.push(label + "\n      dapat : " + JSON.stringify(got) + "\n      jangka: " + JSON.stringify(want));
  console.log((ok ? "  ok   " : "  GAGAL ") + label);
}

// 1. Bahasa lalai ialah Melayu bila tiada pilihan tersimpan
check("lalai ialah 'ms'", mod.getLocale(), "ms");
check("t() Melayu", t("nav.receipts"), "Resit");

// 2. Kunci tidak dikenali dipulangkan sebagaimana adanya (jaring keselamatan
//    untuk payload restore lama yang menyimpan teks mentah)
check("kunci tidak dikenali kembali asal", t("Teks mentah lama"), "Teks mentah lama");
check("fallback param dihormati", t("tiada.kunci.ini", "sandaran"), "sandaran");

// 3. Tukar ke Inggeris
mod.setLocale("en");
check("setLocale('en')", mod.getLocale(), "en");
check("t() Inggeris", t("nav.receipts"), "Receipts");
check("pilihan disimpan", store["kb_locale_v1"], "en");
check("atribut lang dikemas kini", docEl.getAttribute("lang"), "en");
check("tajuk dokumen dikemas kini", document.title, "Log in — TAB KAUNTER");

// 4. applyI18n menyapu semua bentuk atribut
check("data-i18n textContent", nodes[0].textContent, "Receipts");
check("data-i18n kedua", nodes[1].textContent, "Settings");
check("data-i18n-html innerHTML", nodes[2].innerHTML, "Kitchen display (KDS) — order status after payment.");
check("data-i18n-placeholder", nodes[3].getAttribute("placeholder"), "name@restaurant.com");
check("data-i18n-aria-label", nodes[4].getAttribute("aria-label"), "Close");
check("kunci hilang guna kunci sendiri", nodes[5].textContent, "kunci.tidak.wujud");

// 5. Input tidak sah jatuh ke bahasa lalai
mod.setLocale("zz");
check("bahasa tak disokong → ms", mod.getLocale(), "ms");

// 6. Pendengar dimaklumkan sekali sahaja bagi setiap perubahan sebenar
var seen = [];
mod.onLocaleChange(function (l) {
  seen.push(l);
});
mod.setLocale("en");
mod.setLocale("en"); // sama — tidak patut memaklumkan lagi
mod.setLocale("ms");
check("pendengar dapat perubahan sebenar sahaja", seen.join(","), "en,ms");

// 7. toggleLocale berselang-seli
check("toggle dari ms → en", mod.toggleLocale(), "en");
check("toggle dari en → ms", mod.toggleLocale(), "ms");

console.log("");
if (failures.length) {
  console.log("GAGAL (" + failures.length + "):");
  failures.forEach(function (f) {
    console.log("  - " + f);
  });
  process.exit(1);
}
console.log("OK — semua ujian runtime i18n lulus.");
