/**
 * PWA bootstrap — daftar service worker supaya app boleh dipasang ke skrin utama
 * (standalone, tiada bar alamat).
 *
 * Firebase Auth + Firestore sudah diinisialisasi dalam `js/firebase/init.js`
 * (SDK modular v10 CDN). Jangan cipta App kedua di sini.
 */
(function () {
  var statusEl = document.getElementById("pwa-status");

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) {
      setStatus("Pelayar ini tidak menyokong service worker.");
      return;
    }
    navigator.serviceWorker
      .register("/service-worker.js")
      .then(function (reg) {
        setStatus("Aplikasi sedia. Membuka…");
        window.setTimeout(function () {
          window.location.replace("/html/login.html");
        }, 700);
      })
      .catch(function (err) {
        console.warn("PWA: gagal daftar service worker", err);
        setStatus("Gagal daftar service worker.");
      });
  }

  if (document.readyState === "complete") {
    registerServiceWorker();
  } else {
    window.addEventListener("load", registerServiceWorker);
  }

  var openBtn = document.getElementById("pwa-open-app");
  if (openBtn) {
    openBtn.addEventListener("click", function () {
      window.location.href = "/html/login.html";
    });
  }
})();
