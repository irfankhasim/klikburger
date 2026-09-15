/**
 * Daftar service worker pada setiap halaman app (login, menu, POS, back office).
 */
export function registerPwa() {
  if (!("serviceWorker" in navigator)) return;

  function register() {
    navigator.serviceWorker.register("/service-worker.js").then(function (reg) {
      if (reg && reg.update) reg.update();
    }).catch(function (err) {
      console.warn("PWA: gagal daftar service worker", err);
    });
  }

  if (document.readyState === "complete") {
    register();
    return;
  }
  window.addEventListener("load", register);
}

registerPwa();
