/**
 * Shell Tetapan — iframe kandungan kakitangan.
 * Iframe dalaman membesar ikut kandungan supaya skrol kekal pada pane menu utama.
 */
import { t, onLocaleChange } from "../i18n/locale.js";

var MSG_TYPE = "fyp-bo-settings-tab";
var STAFF_SRC = "bo-settings-staff.html?v=46";

function postTabToParent() {
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: MSG_TYPE, tab: "staff" }, "*");
    }
  } catch (e) {}
}

function applyStaffFrame() {
  var iframe = document.getElementById("bs-sub-iframe");
  if (!iframe) return;
  if (iframe.getAttribute("src") !== STAFF_SRC) {
    iframe.style.height = "";
    iframe.src = STAFF_SRC;
  }
  iframe.title = t("settings.iframe.staff");
  if (String(location.hash) && String(location.hash) !== "#staff") {
    try {
      history.replaceState(null, "", location.pathname + location.search);
    } catch (e) {}
  }
}

function wire() {
  var iframe = document.getElementById("bs-sub-iframe");

  window.addEventListener("message", function (ev) {
    var d = ev.data;
    if (!d || d.type !== "fyp-bs-inner-height") return;
    if (!iframe || ev.source !== iframe.contentWindow) return;
    var h = +d.height;
    if (!h || h < 120) return;
    var next = Math.ceil(h + 6);
    var cur = parseInt(iframe.style.height, 10) || 0;
    if (Math.abs(cur - next) < 2) return;
    iframe.style.height = next + "px";
  });

  applyStaffFrame();
  if (iframe) {
    iframe.addEventListener("load", function () {
      postTabToParent();
    });
  }

  onLocaleChange(function () {
    var iframeEl = document.getElementById("bs-sub-iframe");
    if (iframeEl) iframeEl.title = t("settings.iframe.staff");
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", wire);
} else {
  wire();
}
