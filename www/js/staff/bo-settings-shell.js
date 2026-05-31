/**
 * Shell Tetapan — sub-menu Kakitangan / Pangkalan data + iframe kandungan.
 */
var MSG_TYPE = "fyp-bo-settings-tab";

function normalizeTab(hash) {
  var h = String(hash || "").replace(/^#/, "").trim().toLowerCase();
  if (h === "database" || h === "pangkalan") return "database";
  if (h === "operasi" || h === "cukai" || h === "tax") return "operasi";
  return "staff";
}

function tabToSrc(tab) {
  if (tab === "database") return "bo-settings-database.html";
  if (tab === "operasi") return "bo-settings-operasi.html";
  return "bo-settings-staff.html";
}

function tabTitle(tab) {
  if (tab === "database") return "Pangkalan data — Tetapan";
  if (tab === "operasi") return "Operasi — Tetapan";
  return "Kakitangan — Tetapan";
}

function postTabToParent(tab) {
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: MSG_TYPE, tab: tab }, "*");
    }
  } catch (e) {}
}

function setActiveNav(tab) {
  document.querySelectorAll(".bs-settings-subnav__btn").forEach(function (btn) {
    var t = btn.getAttribute("data-tab");
    var on = t === tab;
    btn.classList.toggle("is-active", on);
    if (on) btn.setAttribute("aria-current", "page");
    else btn.removeAttribute("aria-current");
  });
}

var shellNotifyTimer = null;

function scheduleNotifyMainEmbedHeight() {
  if (shellNotifyTimer) clearTimeout(shellNotifyTimer);
  shellNotifyTimer = setTimeout(notifyMainEmbedHeight, 48);
}

/** Tinggi keseluruhan shell (tab + iframe) untuk iframe utama main-menu. */
function notifyMainEmbedHeight() {
  shellNotifyTimer = null;
  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      try {
        if (window.parent === window) return;
        var el = document.documentElement;
        var h = Math.max(
          el.scrollHeight,
          document.body ? document.body.scrollHeight : 0
        );
        window.parent.postMessage({ type: "fyp-bo-embed-height", height: h }, "*");
      } catch (e) {}
    });
  });
}

function applyTab(tab, opts) {
  opts = opts || {};
  var iframe = document.getElementById("bs-sub-iframe");
  if (!iframe) return;
  var nextSrc = tabToSrc(tab);
  if (iframe.getAttribute("src") !== nextSrc) {
    iframe.style.height = "";
    iframe.src = nextSrc;
  }
  iframe.title = tabTitle(tab);
  setActiveNav(tab);
  var wantHash = "#" + tab;
  if (!opts.skipHash && String(location.hash) !== wantHash) {
    try {
      history.replaceState(null, "", location.pathname + location.search + wantHash);
    } catch (e) {
      location.hash = wantHash;
    }
  }
  if (!opts.skipNotifyParent) postTabToParent(tab);
  scheduleNotifyMainEmbedHeight();
}

function wire() {
  var iframe = document.getElementById("bs-sub-iframe");

  window.addEventListener("message", function (ev) {
    var d = ev.data;
    if (!d || d.type !== "fyp-bs-inner-height") return;
    if (!iframe || ev.source !== iframe.contentWindow) return;
    var h = +d.height;
    if (!h || h < 120) return;
    iframe.style.height = Math.ceil(h + 24) + "px";
    scheduleNotifyMainEmbedHeight();
  });

  window.addEventListener("resize", function () {
    scheduleNotifyMainEmbedHeight();
  });

  document.querySelectorAll(".bs-settings-subnav__btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var tab = normalizeTab(btn.getAttribute("data-tab"));
      applyTab(tab, { skipNotifyParent: false });
    });
  });
  window.addEventListener("hashchange", function () {
    applyTab(normalizeTab(location.hash), { skipNotifyParent: false });
  });
  var initial = normalizeTab(location.hash);
  applyTab(initial, { skipHash: true, skipNotifyParent: true });
  if (iframe) {
    iframe.addEventListener("load", function () {
      postTabToParent(normalizeTab(location.hash) || "staff");
      scheduleNotifyMainEmbedHeight();
    });
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", wire);
} else {
  wire();
}
