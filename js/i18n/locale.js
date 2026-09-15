/**
 * Teras i18n — simpan pilihan bahasa, cari terjemahan, dan sapu DOM.
 *
 * Bahasa lalai ialah Bahasa Melayu ("ms") dan kamus `ms` sengaja mengandungi teks
 * yang sama seperti sebelum i18n diperkenalkan, jadi paparan asal tidak berubah.
 *
 * Halaman terbenam (iframe dalam main-menu) berkongsi pilihan yang sama melalui
 * localStorage: peristiwa `storage` menyala dalam frame lain pada origin yang sama,
 * dan BroadcastChannel digunakan sebagai lapisan kedua untuk tab berasingan.
 */
import { DICTIONARY } from "./dictionary.js";

export var LOCALE_STORAGE_KEY = "kb_locale_v1";
export var DEFAULT_LOCALE = "ms";
export var SUPPORTED_LOCALES = ["ms", "en"];

var CHANNEL_NAME = "kb-locale";
var FRAME_MSG_TYPE = "kb-locale";
var listeners = [];
var channel = null;
var currentLocale = null;

function normalizeLocale(v) {
  var s = String(v || "").trim().toLowerCase();
  return SUPPORTED_LOCALES.indexOf(s) >= 0 ? s : DEFAULT_LOCALE;
}

function readStoredLocale() {
  try {
    return normalizeLocale(window.localStorage.getItem(LOCALE_STORAGE_KEY));
  } catch (e) {
    return DEFAULT_LOCALE;
  }
}

/** Bahasa aktif — dibaca sekali kemudian disimpan dalam memori. */
export function getLocale() {
  if (currentLocale == null) currentLocale = readStoredLocale();
  return currentLocale;
}

/** Locale untuk `toLocaleString` / `Intl` — Malaysia, ikut bahasa paparan. */
export function getIntlLocale() {
  return getLocale() === "en" ? "en-MY" : "ms-MY";
}

/** Sisipkan `{nama}` dalam teks terjemahan. */
export function interpolate(template, vars) {
  return String(template).replace(/\{(\w+)\}/g, function (_, name) {
    return vars && vars[name] != null ? String(vars[name]) : "";
  });
}

/**
 * Cari terjemahan bagi satu kunci. Jika kunci tiada dalam bahasa aktif, kita jatuh
 * balik ke Bahasa Melayu, kemudian ke `fallback`, kemudian ke kunci itu sendiri —
 * supaya teks yang belum diterjemah masih terbaca dan tidak jadi kosong.
 */
export function t(key, fallback) {
  var k = String(key || "");
  if (!k) return fallback != null ? fallback : "";
  var active = DICTIONARY[getLocale()] || {};
  if (Object.prototype.hasOwnProperty.call(active, k)) return active[k];
  var base = DICTIONARY[DEFAULT_LOCALE] || {};
  if (Object.prototype.hasOwnProperty.call(base, k)) return base[k];
  return fallback != null ? fallback : k;
}

/** Atribut penanda → atribut DOM yang sebenarnya ditetapkan. */
var ATTR_MAP = [
  ["data-i18n-placeholder", "placeholder"],
  ["data-i18n-title", "title"],
  ["data-i18n-aria-label", "aria-label"],
  ["data-i18n-value", "value"],
  ["data-i18n-alt", "alt"]
];

/**
 * Terjemah semua elemen bertanda di bawah `root`.
 *
 * - `data-i18n`            → textContent
 * - `data-i18n-html`       → innerHTML (untuk teks yang mengandungi <strong> dsb.)
 * - `data-i18n-placeholder`, `-title`, `-aria-label`, `-value`, `-alt` → atribut
 *
 * Elemen dengan ikon perlu meletakkan `data-i18n` pada <span> teksnya, bukan pada
 * <a>/<button> induk, supaya ikon tidak ditimpa.
 */
export function applyI18n(root) {
  var scope = root || document;

  scope.querySelectorAll("[data-i18n]").forEach(function (el) {
    el.textContent = t(el.getAttribute("data-i18n"));
  });

  scope.querySelectorAll("[data-i18n-html]").forEach(function (el) {
    el.innerHTML = t(el.getAttribute("data-i18n-html"));
  });

  ATTR_MAP.forEach(function (pair) {
    scope.querySelectorAll("[" + pair[0] + "]").forEach(function (el) {
      var key = el.getAttribute(pair[0]);
      if (key) el.setAttribute(pair[1], t(key));
    });
  });

  if (scope === document || scope === document.documentElement) {
    document.documentElement.setAttribute("lang", getLocale());
    var titleKey = document.body && document.body.getAttribute("data-i18n-doc-title");
    if (titleKey) document.title = t(titleKey);
  }
}

function notify(locale) {
  listeners.forEach(function (cb) {
    try {
      cb(locale);
    } catch (e) {
      console.error(e);
    }
  });
}

/**
 * Hantar bahasa aktif ke setiap iframe (termasuk yang bersarang, cth. Tetapan).
 * BroadcastChannel kadang-kadang tidak sampai ke frame terbenam; postMessage
 * dari induk ke anak adalah laluan yang paling dipercayai.
 */
function frameOrigin() {
  var origin = window.location.origin;
  if (!origin || origin === "null") return "*";
  return origin;
}

function postLocaleToFrames(locale) {
  var origin = frameOrigin();
  var frames = document.getElementsByTagName("iframe");
  for (var i = 0; i < frames.length; i++) {
    try {
      frames[i].contentWindow.postMessage({ type: FRAME_MSG_TYPE, locale: locale }, origin);
    } catch (e) {}
  }
}

function pingParentLocale() {
  try {
    if (!window.parent || window.parent === window) return;
    window.parent.postMessage({ type: "kb-locale-hello" }, frameOrigin());
  } catch (e) {}
}

function bindIframeLocaleLoads() {
  if (bindIframeLocaleLoads.done) return;
  function go() {
    if (bindIframeLocaleLoads.done || !document.body) return;
    bindIframeLocaleLoads.done = true;
    function onFrameLoad() {
      postLocaleToFrames(getLocale());
    }
    function watch(el) {
      if (!el || el.nodeName !== "IFRAME") return;
      if (el.getAttribute("data-kb-locale-watch") === "1") return;
      el.setAttribute("data-kb-locale-watch", "1");
      el.addEventListener("load", onFrameLoad);
    }
    document.querySelectorAll("iframe").forEach(watch);
    if (typeof MutationObserver === "undefined") return;
    var mo = new MutationObserver(function (recs) {
      recs.forEach(function (rec) {
        rec.addedNodes.forEach(function (n) {
          if (n.nodeType !== 1) return;
          watch(n);
          if (n.querySelectorAll) n.querySelectorAll("iframe").forEach(watch);
        });
      });
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === "loading" || !document.body) {
    document.addEventListener("DOMContentLoaded", go);
    return;
  }
  go();
}

/**
 * Daftar callback yang dijalankan setiap kali bahasa bertukar — termasuk tukaran
 * yang berlaku dalam frame atau tab lain. Guna ini untuk render semula UI yang
 * dibina oleh JS. Mengembalikan fungsi untuk berhenti mendengar.
 */
export function onLocaleChange(cb) {
  if (typeof cb !== "function") return function () {};
  listeners.push(cb);
  return function () {
    listeners = listeners.filter(function (x) {
      return x !== cb;
    });
  };
}

/** Guna bahasa baharu tanpa menyiarkannya semula (untuk tukaran dari luar frame). */
function adoptLocale(next) {
  var locale = normalizeLocale(next);
  if (locale === getLocale()) return;
  currentLocale = locale;
  applyI18n(document);
  notify(locale);
  postLocaleToFrames(locale);
}

/** Tukar bahasa, simpan pilihan, terjemah DOM, dan beritahu frame/tab lain. */
export function setLocale(next) {
  var locale = normalizeLocale(next);
  var changed = locale !== getLocale();
  currentLocale = locale;

  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch (e) {}

  applyI18n(document);
  if (changed) notify(locale);

  try {
    if (channel) channel.postMessage({ locale: locale });
  } catch (e) {}

  postLocaleToFrames(locale);

  return locale;
}

export function toggleLocale() {
  return setLocale(getLocale() === "ms" ? "en" : "ms");
}

var wired = false;

/**
 * Sapu DOM sekali dan mula mendengar tukaran bahasa dari frame/tab lain.
 * Selamat dipanggil berkali-kali.
 */
export function initI18n() {
  applyI18n(document);
  if (wired) return getLocale();
  wired = true;

  window.addEventListener("storage", function (ev) {
    if (ev.key !== LOCALE_STORAGE_KEY) return;
    adoptLocale(ev.newValue);
  });

  window.addEventListener("message", function (ev) {
    var origin = window.location.origin;
    if (origin && origin !== "null" && ev.origin && ev.origin !== origin) return;
    if (!ev.data || typeof ev.data !== "object") return;
    if (ev.data.type === "kb-locale-hello") {
      postLocaleToFrames(getLocale());
      return;
    }
    if (ev.data.type !== FRAME_MSG_TYPE || !ev.data.locale) return;
    adoptLocale(ev.data.locale);
    postLocaleToFrames(ev.data.locale);
  });

  try {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.addEventListener("message", function (ev) {
      if (ev && ev.data && ev.data.locale) adoptLocale(ev.data.locale);
    });
  } catch (e) {
    channel = null;
  }

  bindIframeLocaleLoads();
  pingParentLocale();

  return getLocale();
}
