/**
 * Service worker TAB KAUNTER — precache aset teras, fallback offline.
 * Versi cache dinaikkan bila senarai PRECACHE berubah.
 */
var CACHE_NAME = "tab-kaunter-pwa-v59";

var PRECACHE = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/manifest.json",
  "/ios-icon.png",
  "/ios-icon-precomposed.png",
  "/ios-icon-180.png",
  "/ios-icon-167.png",
  "/ios-icon-152.png",
  "/icons/ios-192.png",
  "/icons/ios-512.png",
  "/html/login.html",
  "/html/main-menu.html",
  "/css/base.css",
  "/css/kb-modal.css",
  "/css/login.css",
  "/css/main-menu.css",
  "/js/pwa-register.js"
];

function isBypass(url) {
  var u = String(url || "");
  if (u.indexOf("chrome-extension") === 0) return true;
  if (u.indexOf("googleapis.com") !== -1) return true;
  if (u.indexOf("gstatic.com") !== -1) return true;
  if (u.indexOf("google.com") !== -1) return true;
  if (u.indexOf("firebaseio.com") !== -1) return true;
  if (u.indexOf("firebasestorage") !== -1) return true;
  if (u.indexOf("cloudfunctions.net") !== -1) return true;
  if (u.indexOf("openrouter.ai") !== -1) return true;
  if (u.indexOf("cdnjs.cloudflare.com") !== -1) return true;
  return false;
}

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return Promise.all(
        PRECACHE.map(function (url) {
          return cache.add(url).catch(function (err) {
            console.warn("PWA skip precache", url, err);
          });
        })
      ).then(function () {
        return self.skipWaiting();
      });
    })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (keys) {
        return Promise.all(
          keys.map(function (key) {
            if (key !== CACHE_NAME) return caches.delete(key);
          })
        );
      })
      .then(function () {
        return self.clients.claim();
      })
  );
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;
  if (isBypass(req.url)) return;

  event.respondWith(
    fetch(req)
      .then(function (res) {
        if (res && res.status === 200 && res.type !== "opaque") {
          var copy = res.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(req, copy);
          });
        }
        return res;
      })
      .catch(function () {
        return caches.match(req).then(function (cached) {
          if (cached) return cached;
          if (req.mode === "navigate") return caches.match("/html/login.html");
          return cached;
        });
      })
  );
});
