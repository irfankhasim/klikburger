/**
 * Frost modal kemas:
 * 1. Dalam dokumen sendiri — kaburkan semua kecuali overlay modal.
 * 2. Jika modal dalam iframe — tandakan shell induk (sidebar/topbar)
 *    supaya satu overlay frost menutup chrome, iframe diangkat di atasnya.
 * Dropdown dan drawer sisi tidak disertakan.
 */
var MSG = "kb-modal-frost";
var OVERLAY_SEL = [
  ".modal-backdrop",
  ".ing-ledger-backdrop",
  ".ing-drawer-backdrop",
  ".sd-modal-backdrop",
  ".ai-modal-backdrop",
  ".refund-backdrop",
  ".order-flow",
  ".kb-clock-in-staff-modal__backdrop",
  ".module-layer",
  ".lp-modal-backdrop"
].join(",");

var lastLocal = false;
var childWantsChrome = false;
var raf = 0;

function isOverlayOpen(el) {
  if (!el) return false;
  if (el.hasAttribute("hidden") || el.hidden) return false;
  if (el.classList.contains("modal-backdrop") || el.classList.contains("lp-modal-backdrop")) {
    return el.classList.contains("is-open");
  }
  if (el.classList.contains("sd-modal-backdrop")) {
    return el.classList.contains("is-open") || el.getAttribute("aria-hidden") === "false";
  }
  return true;
}

function openOverlays() {
  return Array.prototype.filter.call(document.querySelectorAll(OVERLAY_SEL), isOverlayOpen);
}

function ensureShellFrostIn(doc) {
  if (!doc || !doc.body) return null;
  var el = doc.getElementById("kb-shell-frost");
  if (el) return el;
  el = doc.createElement("div");
  el.id = "kb-shell-frost";
  el.className = "kb-shell-frost";
  el.hidden = true;
  el.setAttribute("aria-hidden", "true");
  doc.body.appendChild(el);
  return el;
}

function ensureShellFrost() {
  return ensureShellFrostIn(document);
}

function paintChromeFrost() {
  var on = !!childWantsChrome && !lastLocal;
  document.documentElement.classList.toggle("kb-frost-chrome", on);
  var layer = ensureShellFrost();
  layer.hidden = !on;
  layer.setAttribute("aria-hidden", on ? "false" : "true");
}

function notifyAncestors(open) {
  var w = window;
  try {
    while (w.parent && w.parent !== w) {
      try {
        var pdoc = w.parent.document;
        pdoc.documentElement.classList.toggle("kb-frost-chrome", !!open);
        var layer = ensureShellFrostIn(pdoc);
        if (layer) {
          layer.hidden = !open;
          layer.setAttribute("aria-hidden", open ? "false" : "true");
        }
      } catch (e1) {}
      try {
        if (typeof w.parent.__kbPaintModalFrost === "function") {
          w.parent.__kbPaintModalFrost(!!open);
        }
      } catch (e2) {}
      try {
        w.parent.postMessage({ type: MSG, open: !!open }, "*");
      } catch (e3) {}
      w = w.parent;
    }
  } catch (e) {}
}

function applyLocalFrost() {
  var open = openOverlays();
  var isOn = open.length > 0;
  document.querySelectorAll(".kb-frost-exempt").forEach(function (el) {
    if (open.indexOf(el) === -1) el.classList.remove("kb-frost-exempt");
  });
  open.forEach(function (el) {
    el.classList.add("kb-frost-exempt");
  });
  document.documentElement.classList.toggle("kb-frost-on", isOn);
  if (isOn !== lastLocal) {
    lastLocal = isOn;
    notifyAncestors(isOn);
    paintChromeFrost();
  }
}

function schedule() {
  if (raf) return;
  raf = requestAnimationFrame(function () {
    raf = 0;
    applyLocalFrost();
  });
}

export function initKbModalFrost() {
  if (document.documentElement.hasAttribute("data-kb-frost-ready")) return;
  document.documentElement.setAttribute("data-kb-frost-ready", "1");
  ensureShellFrost();

  var obs = new MutationObserver(schedule);
  function bind() {
    if (!document.body) return;
    obs.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class", "hidden", "aria-hidden"]
    });
    applyLocalFrost();
  }
  if (document.body) bind();
  else document.addEventListener("DOMContentLoaded", bind);

  window.__kbPaintModalFrost = function (open) {
    childWantsChrome = !!open;
    paintChromeFrost();
  };

  window.addEventListener("message", function (e) {
    if (!e || !e.data || e.data.type !== MSG) return;
    childWantsChrome = !!e.data.open;
    paintChromeFrost();
  });

  window.addEventListener("pagehide", function () {
    lastLocal = false;
    notifyAncestors(false);
  });
}
