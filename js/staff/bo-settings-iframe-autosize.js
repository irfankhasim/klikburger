/**
 * Halaman dipaparkan dalam iframe Tetapan (shell) — hantar tinggi kandungan
 * supaya induk boleh set tinggi iframe = satu scroll di peringkat tetingkap utama.
 */
function measureInnerHeight() {
  var main =
    document.querySelector(".sd-app.bs-settings") ||
    document.querySelector(".sd-app") ||
    document.getElementById("ai-root") ||
    document.querySelector(".ai-app");
  if (main) {
    return Math.max(120, Math.ceil(main.offsetTop + main.offsetHeight + 4));
  }
  var b = document.body;
  return Math.max(120, Math.ceil(b ? b.offsetHeight : 0));
}

function postInnerHeight() {
  if (window.parent === window) return;
  window.parent.postMessage({ type: "fyp-bs-inner-height", height: measureInnerHeight() }, "*");
}

export function notifyInnerHeight() {
  requestAnimationFrame(postInnerHeight);
}

function init() {
  if (window.parent === window) return;

  function run() {
    requestAnimationFrame(postInnerHeight);
  }

  window.addEventListener("load", run);
  run();

  window.addEventListener("resize", function () {
    requestAnimationFrame(postInnerHeight);
  });

  try {
    var ro = new ResizeObserver(function () {
      postInnerHeight();
    });
    ro.observe(document.documentElement);
    if (document.body) ro.observe(document.body);
    var layout = document.querySelector(".bs-settings__layout");
    if (layout) ro.observe(layout);
    var staffList = document.getElementById("bs-staff-list");
    if (staffList) ro.observe(staffList);
  } catch (e) {}
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
