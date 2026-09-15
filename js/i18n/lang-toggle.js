/**
 * Butang tukar bahasa BM | EN.
 *
 * Ia dipasang pada elemen hos dengan `data-lang-toggle`, atau dilekatkan sendiri
 * ke sudut halaman jika hos tiada. Butang ini tidak dipasang di dalam iframe
 * terbenam (`html.kb-embed`) kerana shell induk sudah memaparkannya — mengikut
 * corak yang sama seperti widget AI.
 */
import { SUPPORTED_LOCALES, getLocale, setLocale, initI18n, onLocaleChange, t } from "./locale.js";
import { initKbDropdowns } from "../ui/kb-dropdown.js";
import { initKbModalFrost } from "../ui/kb-modal-frost.js";
import { registerPwa } from "../pwa-register.js";

var MOUNTED_FLAG = "data-kb-lang-mounted";
var MODAL_CSS_HREF = new URL("../../css/kb-modal.css", import.meta.url).href;

function ensureKbModalCss() {
  if (document.querySelector('link[data-kb-modal-css], link[href*="kb-modal.css"]')) return;
  var link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = MODAL_CSS_HREF;
  link.setAttribute("data-kb-modal-css", "1");
  document.head.appendChild(link);
}

function isEmbedded() {
  try {
    if (document.documentElement.classList.contains("kb-embed")) return true;
    return window.parent !== window;
  } catch (e) {
    return false;
  }
}

function buildToggle() {
  var wrap = document.createElement("div");
  wrap.className = "kb-lang-toggle";
  wrap.setAttribute("role", "group");
  wrap.setAttribute("aria-label", t("lang.label"));

  SUPPORTED_LOCALES.forEach(function (code) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "kb-lang-toggle__btn kb-surface-btn";
    btn.setAttribute("data-locale", code);
    btn.textContent = t("lang." + code);
    btn.addEventListener("click", function () {
      setLocale(code);
    });
    wrap.appendChild(btn);
  });

  return wrap;
}

function buildRefreshButton() {
  var btn = document.createElement("button");
  btn.type = "button";
  btn.className = "kb-app-refresh";
  btn.innerHTML =
    '<svg class="kb-app-refresh__icon" viewBox="0 0 24 24" aria-hidden="true">' +
    '<path fill="currentColor" d="M17.65 6.35A7.95 7.95 0 0 0 12 4V1L7 6l5 5V7a6 6 0 1 1-6 6H4a8 8 0 1 0 13.65-6.65z"/>' +
    "</svg>";
  btn.addEventListener("click", function () {
    if (btn.disabled) return;
    btn.disabled = true;
    btn.classList.add("is-busy");
    hardRefresh();
  });
  return btn;
}

function syncRefresh(btn) {
  if (!btn) return;
  var label = t("app.refresh");
  btn.setAttribute("aria-label", label);
  btn.setAttribute("title", t("app.refreshHint"));
}

function hardRefresh() {
  var done = false;
  var go = function () {
    if (done) return;
    done = true;
    clearTimeout(cap);
    try {
      window.location.reload();
    } catch (e) {
      window.location.href = window.location.href.split("#")[0];
    }
  };

  // Jangan tunggu serviceWorker.update() — ia boleh tergantung beberapa saat.
  var cap = setTimeout(go, 150);
  if (!window.caches || !caches.keys) {
    go();
    return;
  }
  caches
    .keys()
    .then(function (keys) {
      return Promise.all(
        keys.map(function (k) {
          return caches.delete(k);
        })
      );
    })
    .then(go, go);
}

function syncToggle(wrap) {
  var active = getLocale();
  wrap.setAttribute("aria-label", t("lang.label"));
  wrap.querySelectorAll(".kb-lang-toggle__btn").forEach(function (btn) {
    var code = btn.getAttribute("data-locale");
    var on = code === active;
    btn.textContent = t("lang." + code);
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.setAttribute(
      "title",
      code === "en" ? t("lang.switchToEn") : t("lang.switchToMs")
    );
  });
}

/**
 * Pasang butang bahasa dan hidupkan i18n untuk halaman ini.
 * Selamat dipanggil berkali-kali — pemasangan kedua diabaikan.
 */
export function mountLangToggle() {
  initI18n();
  initKbDropdowns();
  ensureKbModalCss();
  initKbModalFrost();

  if (isEmbedded()) return null;
  if (document.documentElement.hasAttribute(MOUNTED_FLAG)) return null;
  document.documentElement.setAttribute(MOUNTED_FLAG, "1");

  var host = document.querySelector("[data-lang-toggle]");
  var wrap = buildToggle();
  var refresh = buildRefreshButton();
  var tools = document.createElement("div");
  tools.className = "kb-app-tools";
  tools.appendChild(wrap);
  tools.appendChild(refresh);

  if (host) {
    host.appendChild(tools);
  } else {
    tools.classList.add("kb-app-tools--floating");
    document.body.appendChild(tools);
  }

  syncToggle(wrap);
  syncRefresh(refresh);
  onLocaleChange(function () {
    syncToggle(wrap);
    syncRefresh(refresh);
  });

  return wrap;
}

function boot() {
  mountLangToggle();
  registerPwa();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
