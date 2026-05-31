/**
 * Halaman dipaparkan dalam iframe Tetapan (shell) — hantar tinggi kandungan
 * supaya induk boleh set tinggi iframe = satu scroll di peringkat tetingkap utama.
 */
function postInnerHeight() {
  if (window.parent === window) return;
  var root = document.documentElement;
  var b = document.body;
  var h = Math.max(
    root.scrollHeight,
    b ? b.scrollHeight : 0,
    b ? b.offsetHeight : 0
  );
  window.parent.postMessage({ type: "fyp-bs-inner-height", height: h }, "*");
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
  } catch (e) {}
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
