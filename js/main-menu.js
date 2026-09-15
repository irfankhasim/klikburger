import { auth, signOut, db, collection, query, limit, where, onSnapshot, getDocs, doc, getDoc } from "./firebase/init.js";

var LOGIN_PAGE_HREF = new URL("../html/login.html", import.meta.url).href;
import { waitForAuthUser, getPosUserRbacPayload } from "./pos-firebase-auth-bridge.js";
import { COL_STAFF } from "./firebase/collections.js";
import { OWNER_STAFF_DOC_ID } from "./staff/staff-mappers.js";
import { isTrustedPosTerminal, judgeProximity, SKIP_CLOCK_IN_GEO } from "./staff/pos-terminal-trust.js";
import { subscribePosHub } from "./pos-operations-hub.js";
import {
  subscribeRbac,
  getSnapshot,
  ROLES,
  isElevatedRole,
  canBypassStaffRestrictions,
  canAccessOperationalModules,
  canAccessBackOfficeModule,
  clockIn,
  clockOut,
  restoreClockedInSession,
  logoutSession,
  assertLogoutReady,
  applyLoginIdentity,
  staffLockMessage,
  getEffectiveOperationalStatus,
  OPERATIONAL_STATUS,
  isStaffRole,
  requiresOperationalStaffPicker,
  loadSession,
  setSession,
  setPosOperationalStaff,
  isOwnerRole,
  revokeClockInFromRoster
} from "./pos-rbac-session.js";
import { ensureOwnerStaffRecord } from "./staff/staff-repository.js";
import {
  getShiftPanelHtml,
  renderShiftPanelUI,
  ensureShiftPanelHubSync,
  bindShiftPanelDelegation,
  bindShiftModalRoot
} from "./pos-shift-panel.js";
import { t as tr, onLocaleChange, interpolate, getIntlLocale } from "./i18n/locale.js";

var STORAGE_KEY = "fyp_klikburger_module";
var RESTORE_KEY = "fyp_klikburger_restore_v1";
var RESTORE_KEY_LS = "fyp_klikburger_restore_ls_v1";
var SETTINGS_TAB_SS = "fyp_bo_settings_tab_v1";
var shellBootSuppressPersist = false;
var shellPagehideBound = false;
/** Rujukan `applyModule` dari dalam `runMainMenuShell` — dipakai semasa restore modul. */
var shellApplyModule = null;

function readRestoreState() {
  try {
    var raw = sessionStorage.getItem(RESTORE_KEY);
    if (!raw) raw = localStorage.getItem(RESTORE_KEY_LS);
    if (!raw) return null;
    var o = JSON.parse(raw);
    if (!o || o.v !== 1 || typeof o.r !== "string") return null;
    return o;
  } catch (e) {
    return null;
  }
}

function persistShellForce(obj) {
  var payload = JSON.stringify(Object.assign({ v: 1 }, obj));
  try {
    sessionStorage.setItem(RESTORE_KEY, payload);
  } catch (e) {}
  try {
    localStorage.setItem(RESTORE_KEY_LS, payload);
  } catch (e2) {}
}

function persistShell(obj) {
  if (shellBootSuppressPersist) return;
  persistShellForce(obj);
}

function escapeCssAttr(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function readBoSettingsSubTab() {
  return "staff";
}

function captureAndPersistShellRouteFromDom() {
  try {
    var mod = document.body.getAttribute("data-module") === "bo" ? "bo" : "pos";
    var navRoot = mod === "bo" ? document.querySelector(".js-nav-bo") : document.querySelector(".js-nav-pos");
    if (!navRoot || navRoot.hidden) {
      persistShellForce({ r: mod === "bo" ? "bo-home" : "pos-home", module: mod });
      return;
    }
    var t = navRoot.querySelector(".sidebar__link[aria-current='page']");
    if (!t) {
      persistShellForce({ r: mod === "bo" ? "bo-home" : "pos-home", module: mod });
      return;
    }
    if (t.classList.contains("js-nav-clock")) {
      persistShellForce({ r: "pos-clock", module: "pos" });
      return;
    }
    if (t.hasAttribute("data-pos-embed")) {
      persistShellForce({
        r: "pos-embed",
        module: "pos",
        embedFile: t.getAttribute("data-pos-embed") || "",
        embedTitle: t.getAttribute("data-pos-title") || "",
        embedLead: t.getAttribute("data-pos-lead") || "",
        embedTopbar: t.getAttribute("data-pos-topbar") || ""
      });
      return;
    }
    if (t.classList.contains("js-bo-dashboard")) {
      persistShellForce({ r: "bo-dashboard", module: "bo" });
      return;
    }
    if (t.classList.contains("js-bo-staff")) {
      persistShellForce({ r: "bo-staff", module: "bo" });
      return;
    }
    if (t.classList.contains("js-bo-wastage")) {
      persistShellForce({ r: "bo-wastage", module: "bo" });
      return;
    }
    if (t.classList.contains("js-bo-calc")) {
      persistShellForce({
        r: "bo-calc",
        module: "bo",
        calcTab: t.getAttribute("data-calc-tab") || "ingredients",
        calcCopy: t.getAttribute("data-bo-calc-copy") || "",
        calcTopbar: t.getAttribute("data-topbar") || ""
      });
      return;
    }
    if (t.classList.contains("js-bo-monthly-reports")) {
      persistShellForce({ r: "bo-monthly-reports", module: "bo" });
      return;
    }
    if (t.classList.contains("js-bo-settings")) {
      persistShellForce({
        v: 1,
        r: "bo-settings",
        module: "bo",
        settingsTab: readBoSettingsSubTab()
      });
      return;
    }
    var rkCap = t.getAttribute("data-kb-restore");
    if (rkCap) {
      persistShellForce({
        r: "generic",
        module: mod,
        restoreKey: String(rkCap).trim()
      });
      return;
    }
    if (t.hasAttribute("data-bo-link")) {
      persistShellForce({ r: "bo-home", module: "bo" });
      return;
    }
    persistShellForce({ r: mod === "bo" ? "bo-home" : "pos-home", module: mod });
  } catch (ignored) {}
}

function sanitizeRestoreForRbac() {
  try {
    var st = readRestoreState();
    if (!st || st.v !== 1 || st.r !== "pos-embed" || !st.embedFile) return;
    var a = document.querySelector(
      '.js-nav-pos .sidebar__link[data-pos-embed="' + escapeCssAttr(st.embedFile) + '"]'
    );
    if (!a) return;
    if (!canAccessOperationalModules()) {
      persistShellForce({ r: "pos-clock", module: "pos" });
    }
  } catch (e) {}
}

async function restoreShellRouteFromStorage() {
  var st = readRestoreState();
  if (!st || st.v !== 1 || !st.r) return;

  function inferredModule() {
    if (st.module === "bo" || st.module === "pos") return st.module;
    if (String(st.r).indexOf("bo-") === 0) return "bo";
    if (String(st.r).indexOf("pos-") === 0) return "pos";
    if (st.r === "generic") return st.module === "bo" ? "bo" : "pos";
    return "pos";
  }

  var targetMod = inferredModule();
  if (targetMod === "bo" && !canAccessBackOfficeModule()) {
    persistShellForce({ r: "pos-home", module: "pos" });
    targetMod = "pos";
  }
  var bodyMod = document.body.getAttribute("data-module") === "bo" ? "bo" : "pos";
  if (targetMod !== bodyMod && shellApplyModule) {
    shellApplyModule(targetMod === "bo" ? "bo" : "pos");
  }

  function safeClick(sel) {
    var el = document.querySelector(sel);
    if (el) el.click();
  }

  if (st.r === "pos-home" || st.r === "bo-home") return;

  if (st.r === "pos-clock") {
    safeClick(".js-nav-pos .js-nav-clock");
    return;
  }

  if (st.r === "pos-embed" && st.embedFile) {
    var sel = '.js-nav-pos .sidebar__link[data-pos-embed="' + escapeCssAttr(st.embedFile) + '"]';
    var a = document.querySelector(sel);
    if (!a) return;
    if (!canAccessOperationalModules()) {
      persistShellForce({ r: "pos-clock", module: "pos" });
      safeClick(".js-nav-pos .js-nav-clock");
      return;
    }
    a.click();
    return;
  }

  if (st.r === "bo-dashboard") {
    if (!canAccessBackOfficeModule()) return;
    safeClick(".js-nav-bo .js-bo-dashboard");
    return;
  }

  if (st.r === "bo-staff") {
    if (!canAccessBackOfficeModule()) return;
    safeClick(".js-nav-bo .js-bo-staff");
    return;
  }

  if (st.r === "bo-wastage") {
    if (!canAccessBackOfficeModule()) return;
    safeClick(".js-nav-bo .js-bo-wastage");
    return;
  }

  if (st.r === "bo-calc") {
    if (!canAccessBackOfficeModule()) return;
    var tab = st.calcTab || "ingredients";
    var copy = st.calcCopy || "";
    var q;
    if (copy === "catalog") {
      q = '.js-nav-bo .js-bo-calc[data-calc-tab="modifiers"][data-bo-calc-copy="catalog"]';
    } else if (tab === "modifiers") {
      q = '.js-nav-bo .js-bo-calc[data-calc-tab="modifiers"]:not([data-bo-calc-copy])';
    } else {
      q = '.js-nav-bo .js-bo-calc[data-calc-tab="' + escapeCssAttr(tab) + '"]';
    }
    safeClick(q);
    return;
  }

  if (st.r === "bo-monthly-reports") {
    if (!canAccessBackOfficeModule()) return;
    safeClick(".js-nav-bo .js-bo-monthly-reports");
    return;
  }

  if (st.r === "bo-ai-assistant") {
    if (!canAccessBackOfficeModule()) return;
    try {
      sessionStorage.setItem(SETTINGS_TAB_SS, "staff");
    } catch (eAi) {}
    persistShellForce({ v: 1, r: "bo-settings", module: "bo", settingsTab: "staff" });
    safeClick(".js-nav-bo .js-bo-settings");
    return;
  }

  if (st.r === "bo-settings") {
    if (!canAccessBackOfficeModule()) return;
    safeClick(".js-nav-bo .js-bo-settings");
    return;
  }

  if (st.r === "generic" && st.restoreKey === "bo-system-settings") {
    if (!canAccessBackOfficeModule()) return;
    persistShellForce({ v: 1, r: "bo-settings", module: "bo", settingsTab: "staff" });
    safeClick(".js-nav-bo .js-bo-settings");
    return;
  }

  if (st.r === "generic" && st.restoreKey) {
    var navMod = document.body.getAttribute("data-module") === "bo" ? "bo" : "pos";
    if (navMod === "bo" && !canAccessBackOfficeModule()) return;
    var navSel = navMod === "bo" ? ".js-nav-bo" : ".js-nav-pos";
    var g = document.querySelector(
      navSel + ' .sidebar__link[data-kb-restore="' + escapeCssAttr(String(st.restoreKey)) + '"]'
    );
    if (g) g.click();
  }
}

function waitForEmbeddedContentIfAny() {
  var wrap = document.getElementById("content-embed-wrap");
  if (!wrap || wrap.hidden) return Promise.resolve();
  var iframe = getActiveEmbedIframe();
  if (!iframe) return Promise.resolve();
  var src = String(iframe.getAttribute("src") || "").trim();
  if (!src || src === "about:blank") return Promise.resolve();
  try {
    if (iframe.dataset.embedReady === "1") return Promise.resolve();
    if (iframe.contentDocument && iframe.contentDocument.readyState === "complete") {
      iframe.dataset.embedReady = "1";
      return Promise.resolve();
    }
  } catch (ignored) {}
  return new Promise(function (resolve) {
    var done = false;
    function fin() {
      if (done) return;
      done = true;
      try {
        iframe.removeEventListener("load", onLoad);
      } catch (e) {}
      try {
        iframe.removeEventListener("error", onErr);
      } catch (e2) {}
      resolve();
    }
    var t = window.setTimeout(fin, 2500);
    function onLoad() {
      iframe.dataset.embedReady = "1";
      window.clearTimeout(t);
      fin();
    }
    function onErr() {
      window.clearTimeout(t);
      fin();
    }
    iframe.addEventListener("load", onLoad, { once: true });
    iframe.addEventListener("error", onErr, { once: true });
  });
}

function finishAppLoader() {
  try {
    document.body.classList.remove("kb-app-boot");
  } catch (e) {}
  var el = document.getElementById("kb-app-loader");
  if (!el) return;
  if (!el.classList.contains("kb-app-loader--out")) {
    el.classList.add("kb-app-loader--out");
    el.style.pointerEvents = "none";
    el.setAttribute("aria-busy", "false");
  }
  window.setTimeout(function () {
    try {
      el.setAttribute("hidden", "");
      el.style.display = "none";
    } catch (e2) {}
  }, 420);
}

async function ensureSessionFromFirebase() {
  try {
    var u = await waitForAuthUser();
    if (!u) {
      window.location.replace(LOGIN_PAGE_HREF);
      return false;
    }
    var payload;
    try {
      payload = await Promise.race([
        getPosUserRbacPayload(u),
        new Promise(function (_, rej) {
          window.setTimeout(function () {
            rej(new Error("rbac-timeout"));
          }, 12000);
        })
      ]);
    } catch (e) {
      console.warn("[boot] RBAC Firestore tamat masa / ralat — guna payload minimum.", e);
      payload = {
        userId: u.uid,
        displayName: (u.displayName || "").trim() || (u.email ? String(u.email).split("@")[0] : "Pengguna"),
        email: u.email || "",
        role: ROLES.CASHIER
      };
    }
    applyLoginIdentity(payload);
    try {
      var roleNow = String(loadSession().role || payload.role || "");
      if (roleNow === ROLES.OWNER) {
        await ensureOwnerStaffRecord(payload.displayName);
      }
    } catch (eOwn) {
      console.warn("[boot] ensure owner staff", eOwn);
    }
    return true;
  } catch (e) {
    console.error("[boot] ensureSessionFromFirebase", e);
    try {
      var cu = auth && auth.currentUser;
      if (cu) {
        applyLoginIdentity({
          userId: cu.uid,
          displayName: (cu.displayName || "").trim() || (cu.email ? String(cu.email).split("@")[0] : "Pengguna"),
          email: cu.email || "",
          role: ROLES.CASHIER
        });
        return true;
      }
    } catch (e3) {}
    try {
      window.location.replace(LOGIN_PAGE_HREF);
    } catch (e4) {}
    return false;
  }
}

/**
 * Refresh / boot: jika sesi tempatan hilang clock-in tetapi roster Firestore masih ada
 * untuk staf yang dipilih, pulihkan clock-in supaya Jualan kekal terbuka.
 */
async function restoreClockInFromRoster() {
  var s = loadSession();
  if (s.clockedIn) return;
  var staffId = String(s.operationalStaffId || "").trim();
  if (!staffId) return;
  try {
    var snap = await getDoc(doc(db, "pos_active_shift", staffId));
    if (!snap.exists()) return;
    var data = snap.data() || {};
    setPosOperationalStaff(
      staffId,
      data.staffName || s.operationalStaffName,
      data.workRole || s.operationalWorkRole
    );
    restoreClockedInSession();
  } catch (e) {
    console.warn("[boot] restore clock-in from roster", e);
  }
}

function runMainMenuShell() {
var body = document.body;
var trigger = document.querySelector(".js-module-trigger");
var layer = document.getElementById("module-layer");
var tagEl = document.querySelector(".js-module-tag");
var navPos = document.querySelector(".js-nav-pos");
var navBo = document.querySelector(".js-nav-bo");
var topbarTitle = document.querySelector(".js-topbar-title");
var contentLead = document.querySelector(".js-content-lead");
var panelTitle = document.querySelector(".js-panel-title");
var panelBody = document.querySelector(".js-panel-body");
var statusBar = document.getElementById("kb-status-bar");
var SIDEBAR_COLLAPSE_KEY = "kb_sidebar_collapsed_v1";

function isSidebarCollapsed() {
  return document.documentElement.classList.contains("kb-sidebar-collapsed");
}

function syncSidebarChrome() {
  var collapsed = isSidebarCollapsed();
  var label = collapsed ? tr("nav.sidebarExpand") : tr("nav.sidebarCollapse");
  document.querySelectorAll("#kb-sidebar-toggle, #kb-sidebar-collapse").forEach(function (btn) {
    btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
    btn.setAttribute("aria-label", label);
    btn.setAttribute("data-i18n-aria-label", collapsed ? "nav.sidebarExpand" : "nav.sidebarCollapse");
    btn.setAttribute("title", label);
    var icon = btn.querySelector("i");
    if (icon && btn.id === "kb-sidebar-collapse") {
      icon.className = collapsed ? "fa-solid fa-chevron-right" : "fa-solid fa-chevron-left";
    }
  });
  document.querySelectorAll(".sidebar__link").forEach(function (a) {
    var span = a.querySelector("span");
    if (span) a.setAttribute("title", span.textContent.trim());
  });
}

function setSidebarCollapsed(collapsed) {
  document.documentElement.classList.toggle("kb-sidebar-collapsed", !!collapsed);
  try {
    localStorage.setItem(SIDEBAR_COLLAPSE_KEY, collapsed ? "1" : "0");
  } catch (e) {}
  syncSidebarChrome();
}

function initSidebarCollapse() {
  var stored = false;
  try {
    stored = localStorage.getItem(SIDEBAR_COLLAPSE_KEY) === "1";
  } catch (e) {}
  setSidebarCollapsed(stored);
  function toggle() {
    setSidebarCollapsed(!isSidebarCollapsed());
  }
  var topBtn = document.getElementById("kb-sidebar-toggle");
  var sideBtn = document.getElementById("kb-sidebar-collapse");
  if (topBtn) topBtn.addEventListener("click", toggle);
  if (sideBtn) sideBtn.addEventListener("click", toggle);
}

initSidebarCollapse();

function hideTopbarEmbedLead() {
  var wrap = document.querySelector(".js-topbar-embed-lead");
  var text = document.querySelector(".js-topbar-embed-lead-text");
  if (wrap) wrap.hidden = true;
  if (text) text.innerHTML = "";
}

/** Perihalan ringkas bawah topbar (gaya sama untuk BO/POS). Kosong = sembunyi. */
function setTopbarEmbedLead(html) {
  var wrap = document.querySelector(".js-topbar-embed-lead");
  var text = document.querySelector(".js-topbar-embed-lead-text");
  if (!wrap || !text) return;
  var s = html != null ? String(html).trim() : "";
  if (!s) {
    wrap.hidden = true;
    text.innerHTML = "";
    return;
  }
  text.innerHTML = s;
  wrap.hidden = false;
}

/**
 * Teks kandungan lalai bagi satu modul, dibaca semula setiap kali dipanggil
 * supaya ia sentiasa mengikut bahasa aktif.
 */
function copyFor(m) {
  var mod = m === "bo" ? "bo" : "pos";
  return {
    tag: tr("module." + mod + ".tag"),
    topbar: tr("module." + mod + ".topbar"),
    lead: tr("module." + mod + ".lead"),
    panelTitle: tr("module." + mod + ".panelTitle"),
    panelBody: tr("module." + mod + ".panelBody")
  };
}

/**
 * Paparan shell yang sedang aktif, disimpan sebagai kunci i18n (bukan teks siap)
 * supaya `applyShellText()` boleh membinanya semula dalam bahasa lain.
 *
 * kind: "default" (kandungan modul) | "clock" (panel kehadiran) | "embed" (iframe)
 */
var activeShellView = { kind: "default" };

/**
 * Segarkan teks shell yang dijana JS selepas bahasa bertukar.
 *
 * Sengaja tidak menyentuh `iframe.src` — menetapkan src semula akan memuat ulang
 * halaman terbenam dan membuang kerja pengguna (cth. troli yang separuh diisi).
 */
function applyShellText() {
  var m = body.getAttribute("data-module") === "bo" ? "bo" : "pos";
  var c = copyFor(m);
  if (tagEl) tagEl.textContent = c.tag;

  var v = activeShellView || { kind: "default" };

  if (v.kind === "embed") {
    var iframe = getActiveEmbedIframe();
    if (iframe && v.iframeTitleKey) iframe.title = tr(v.iframeTitleKey);
    if (topbarTitle) topbarTitle.textContent = v.titleKey ? tr(v.titleKey) : c.topbar;
    setTopbarEmbedLead(v.leadKey ? tr(v.leadKey) : "");
    renderStatusBar();
    syncSidebarChrome();
    return;
  }

  if (v.kind === "clock") {
    renderClockPanel();
    renderStatusBar();
    syncSidebarChrome();
    return;
  }

  if (topbarTitle) topbarTitle.textContent = c.topbar;
  if (contentLead) {
    contentLead.innerHTML = c.lead;
    contentLead.removeAttribute("hidden");
  }
  if (panelTitle) panelTitle.textContent = c.panelTitle;
  if (panelBody) panelBody.textContent = c.panelBody;
  renderStatusBar();
  syncSidebarChrome();
}

function getStoredModule() {
  try {
    var v = sessionStorage.getItem(STORAGE_KEY);
    if (v === "pos" || v === "bo") return v;
  } catch (e) {}
  return "pos";
}

function setStoredModule(m) {
  try {
    sessionStorage.setItem(STORAGE_KEY, m);
  } catch (e) {}
}

function setActiveNav(navRoot, selector) {
  if (!navRoot) return;
  navRoot.querySelectorAll(".sidebar__link").forEach(function (a) {
    a.classList.remove("is-active");
    a.removeAttribute("aria-current");
  });
  if (!selector) return;
  var first = navRoot.querySelector(selector);
  if (first) {
    first.classList.add("is-active");
    first.setAttribute("aria-current", "page");
  }
}

var POS_EMBED_KEYS = ["pos-order.html", "pos-receipts.html", "pos-order-board.html"];
var contentEmbedFitRaf = 0;
var contentEmbedFitRo = null;

function getEmbedWrap() {
  return document.getElementById("content-embed-wrap");
}

function embedPathKey(src) {
  var raw = String(src || "").trim();
  if (!raw || raw.indexOf("about:blank") === 0) return "";
  var noHash = raw.split("#")[0].split("?")[0];
  var parts = noHash.split("/");
  return String(parts[parts.length - 1] || "").toLowerCase();
}

function embedHashValue(src) {
  var s = String(src || "");
  var i = s.indexOf("#");
  return i >= 0 ? s.slice(i + 1) : "";
}

function listEmbedFrames() {
  var wrap = getEmbedWrap();
  if (!wrap) return [];
  return Array.prototype.slice.call(wrap.querySelectorAll("iframe.content__embed"));
}

function getActiveEmbedIframe() {
  var wrap = getEmbedWrap();
  if (!wrap) return null;
  return (
    wrap.querySelector("iframe.content__embed.is-active") ||
    wrap.querySelector("iframe.content__embed:not([hidden])") ||
    document.getElementById("content-embed")
  );
}

function setActiveEmbedFrame(iframe) {
  listEmbedFrames().forEach(function (f) {
    var on = f === iframe;
    f.classList.toggle("is-active", on);
    f.hidden = !on;
    if (on) f.id = "content-embed";
    else if (f.id === "content-embed") f.removeAttribute("id");
  });
}

function applyEmbedHash(iframe, hash) {
  if (!iframe || !hash) return;
  try {
    var win = iframe.contentWindow;
    if (!win) return;
    var cur = String(win.location.hash || "").replace(/^#/, "");
    if (cur === hash) return;
    win.location.hash = hash;
  } catch (e) {}
}

function resetContentEmbedSizing() {
  unbindContentEmbedFit();
  var iframe = getActiveEmbedIframe();
  if (!iframe) return;
  iframe.classList.remove("content__embed--intrinsic");
  iframe.style.height = "";
}

function destroyEmbedFrames(keys) {
  var wrap = getEmbedWrap();
  if (!wrap) return;
  var filter = keys && keys.length ? keys : null;
  listEmbedFrames().forEach(function (f) {
    var key = String(f.getAttribute("data-embed-key") || "").toLowerCase();
    if (filter && filter.indexOf(key) === -1) return;
    try {
      f.src = "about:blank";
    } catch (e) {}
    f.remove();
  });
  unbindContentEmbedFit();
}

function unbindContentEmbedFit() {
  if (contentEmbedFitRaf) {
    cancelAnimationFrame(contentEmbedFitRaf);
    contentEmbedFitRaf = 0;
  }
  if (contentEmbedFitRo) {
    try {
      contentEmbedFitRo.disconnect();
    } catch (e) {}
    contentEmbedFitRo = null;
  }
}

function measureSameOriginEmbedHeight(iframe) {
  var doc = iframe.contentDocument;
  if (!doc) return 0;
  var html = doc.documentElement;
  var body = doc.body;
  var h = 0;
  if (html) {
    h = Math.max(h, html.scrollHeight || 0, html.offsetHeight || 0);
  }
  if (body) {
    h = Math.max(h, body.scrollHeight || 0, body.offsetHeight || 0);
  }
  var root =
    (body &&
      (body.querySelector(".sd-app") ||
        body.querySelector(".ops-app") ||
        body.querySelector(".order-app") ||
        body.querySelector(".app-main") ||
        body.querySelector(".mr-app") ||
        body.querySelector(".dash-board") ||
        body.querySelector(".layout"))) ||
    null;
  if (root) {
    var top = 0;
    try {
      top = root.getBoundingClientRect().top - (html ? html.getBoundingClientRect().top : 0);
    } catch (e1) {}
    h = Math.max(h, Math.ceil(top + (root.offsetHeight || 0) + 8));
  }
  return h;
}

function applyContentEmbedHeight() {
  var iframe = getActiveEmbedIframe();
  var wrap = getEmbedWrap();
  var pane = document.getElementById("main-content");
  if (!iframe || !wrap || wrap.hidden) return;
  var src = String(iframe.getAttribute("src") || "").trim();
  if (!src || src === "about:blank") return;
  var contentH = 0;
  try {
    contentH = measureSameOriginEmbedHeight(iframe);
  } catch (e) {
    contentH = 0;
  }
  if (!contentH) return;
  var minH = Math.max((pane && pane.clientHeight) || 0, (wrap && wrap.clientHeight) || 0, 240);
  var next = Math.max(Math.ceil(contentH), minH);
  var cur = parseInt(iframe.style.height, 10) || 0;
  if (Math.abs(cur - next) < 2) return;
  iframe.classList.add("content__embed--intrinsic");
  iframe.style.height = next + "px";
}

function scheduleContentEmbedFit() {
  if (contentEmbedFitRaf) cancelAnimationFrame(contentEmbedFitRaf);
  contentEmbedFitRaf = requestAnimationFrame(function () {
    contentEmbedFitRaf = 0;
    applyContentEmbedHeight();
  });
}

function bindContentEmbedFit(iframe) {
  unbindContentEmbedFit();
  if (!iframe) return;
  scheduleContentEmbedFit();
  var doc;
  try {
    doc = iframe.contentDocument;
  } catch (e) {
    return;
  }
  if (!doc || typeof ResizeObserver !== "function") return;
  contentEmbedFitRo = new ResizeObserver(scheduleContentEmbedFit);
  try {
    contentEmbedFitRo.observe(doc.documentElement);
    if (doc.body) contentEmbedFitRo.observe(doc.body);
  } catch (e2) {}
}

function wireContentEmbedFit() {
  window.addEventListener("resize", scheduleContentEmbedFit);
}

function revealEmbedPane() {
  var wrap = getEmbedWrap();
  var def = document.getElementById("content-default");
  if (!wrap || !def) return false;
  def.hidden = true;
  wrap.hidden = false;
  if (panelTitle) panelTitle.textContent = "";
  if (panelBody) panelBody.textContent = "";
  return true;
}

function activateContentEmbed(src, title) {
  var wrap = getEmbedWrap();
  if (!wrap || !revealEmbedPane()) return null;
  var key = embedPathKey(src);
  if (!key) return null;
  var hash = embedHashValue(src);
  var iframe = wrap.querySelector('iframe.content__embed[data-embed-key="' + key + '"]');
  if (iframe) {
    setActiveEmbedFrame(iframe);
    if (title) iframe.title = title;
    applyEmbedHash(iframe, hash);
    bindContentEmbedFit(iframe);
    return iframe;
  }
  iframe = document.createElement("iframe");
  iframe.className = "content__embed is-active";
  iframe.setAttribute("data-embed-key", key);
  iframe.setAttribute("scrolling", "no");
  iframe.title = title || "TAB KAUNTER";
  iframe.addEventListener("load", function () {
    iframe.dataset.embedReady = "1";
    if (iframe.classList.contains("is-active")) bindContentEmbedFit(iframe);
  });
  wrap.appendChild(iframe);
  setActiveEmbedFrame(iframe);
  iframe.src = src;
  return iframe;
}

function hideEmbed() {
  var wrap = getEmbedWrap();
  var def = document.getElementById("content-default");
  if (!wrap || !def) return;
  wrap.hidden = true;
  def.hidden = false;
  unbindContentEmbedFit();
  activeShellView = { kind: "default" };
  var m = body.getAttribute("data-module") === "bo" ? "bo" : "pos";
  var c = copyFor(m);
  if (topbarTitle) topbarTitle.textContent = c.topbar;
  if (contentLead) {
    contentLead.innerHTML = c.lead;
    contentLead.removeAttribute("hidden");
  }
  if (panelTitle) panelTitle.textContent = c.panelTitle;
  if (panelBody) panelBody.textContent = c.panelBody;
  hideTopbarEmbedLead();
}

function showBoCalculator(tab, topbarOverride, copyKind) {
  var page =
    tab === "modifiers"
      ? copyKind === "catalog"
        ? "packages"
        : "modifiers"
      : "ingredients";
  activeShellView = {
    kind: "embed",
    iframeTitleKey:
      copyKind === "catalog" ? "embed.title.productMenu" : "embed.title.costCalc",
    titleKey:
      topbarOverride ||
      (page === "packages"
        ? "topbar.productMenu"
        : page === "modifiers"
          ? "nav.productsCost"
          : "nav.ingredients"),
    leadKey:
      copyKind === "catalog"
        ? "lead.calcCatalog"
        : tab === "modifiers"
          ? "lead.calcModifiers"
          : "lead.calcIngredients"
  };
  var iframe = activateContentEmbed(
    "pos-cost-calculator.html?v=47#" + page,
    tr(activeShellView.iframeTitleKey)
  );
  if (!iframe) return;
  if (topbarTitle) topbarTitle.textContent = tr(activeShellView.titleKey);
  setTopbarEmbedLead(tr(activeShellView.leadKey));
  persistShell({
    r: "bo-calc",
    module: "bo",
    calcTab: tab || "ingredients",
    calcCopy: copyKind || "",
    calcTopbar: topbarOverride || ""
  });
}

function showBoStaff() {
  activeShellView = {
    kind: "embed",
    iframeTitleKey: "embed.title.staff",
    titleKey: "topbar.staff",
    leadKey: "lead.staffMonitor"
  };
  var iframe = activateContentEmbed("staff-dashboard.html", tr("embed.title.staff"));
  if (!iframe) return;
  if (topbarTitle) topbarTitle.textContent = tr("topbar.staff");
  setTopbarEmbedLead(tr("lead.staffMonitor"));
  persistShell({ r: "bo-staff", module: "bo" });
}

function showBoWastage() {
  activeShellView = {
    kind: "embed",
    iframeTitleKey: "embed.title.wastage",
    titleKey: "topbar.wastage",
    leadKey: "lead.wastage"
  };
  var iframe = activateContentEmbed("bo-wastage.html", tr("embed.title.wastage"));
  if (!iframe) return;
  if (topbarTitle) topbarTitle.textContent = tr("topbar.wastage");
  setTopbarEmbedLead(tr("lead.wastage"));
  persistShell({ r: "bo-wastage", module: "bo" });
}

function showBoSettings() {
  activeShellView = {
    kind: "embed",
    iframeTitleKey: "embed.title.settings",
    titleKey: "nav.settings",
    leadKey: "lead.settingsStaff"
  };
  var iframe = activateContentEmbed("bo-settings.html", tr(activeShellView.iframeTitleKey));
  if (!iframe) return;
  if (topbarTitle) topbarTitle.textContent = tr(activeShellView.titleKey);
  setTopbarEmbedLead(tr(activeShellView.leadKey));
  persistShell({ r: "bo-settings", module: "bo", settingsTab: "staff" });
}

function wireContentEmbedChildMessages() {
  window.addEventListener("message", function (ev) {
    try {
      var fromPool = listEmbedFrames().some(function (f) {
        return f.contentWindow && ev.source === f.contentWindow;
      });
      if (!fromPool) return;
      var d = ev.data;
      if (!d || typeof d !== "object") return;

      if (d.type === "fyp-bo-settings-tab") {
        try {
          sessionStorage.setItem(SETTINGS_TAB_SS, "staff");
        } catch (e1) {}
        if (topbarTitle) topbarTitle.textContent = tr("nav.settings");
        setTopbarEmbedLead(tr("lead.settingsStaff"));
        persistShellForce({ v: 1, r: "bo-settings", module: "bo", settingsTab: "staff" });
      }
    } catch (e) {}
  });
}

function showBoMonthlyReports() {
  activeShellView = {
    kind: "embed",
    iframeTitleKey: "embed.title.fullReport",
    titleKey: "topbar.fullReport",
    leadKey: "lead.fullReport"
  };
  var iframe = activateContentEmbed("bo-monthly-reports.html", tr("embed.title.fullReport"));
  if (!iframe) return;
  if (topbarTitle) topbarTitle.textContent = tr("topbar.fullReport");
  setTopbarEmbedLead(tr("lead.fullReport"));
  persistShell({ r: "bo-monthly-reports", module: "bo" });
}

function showBoDashboard() {
  activeShellView = {
    kind: "embed",
    iframeTitleKey: "embed.title.dashboard",
    titleKey: "topbar.dashboard",
    leadKey: "lead.dashboard"
  };
  var iframe = activateContentEmbed("dashboard.html", tr("embed.title.dashboard"));
  if (!iframe) return;
  if (topbarTitle) topbarTitle.textContent = tr("topbar.dashboard");
  setTopbarEmbedLead(tr("lead.dashboard"));
  persistShell({ r: "bo-dashboard", module: "bo" });
}

/**
 * Halaman POS terbenam. `iframeTitle`, `leadHtml` dan `topbarText` datang sebagai
 * kunci i18n dari atribut `data-pos-*`, tetapi payload restore lama menyimpan teks
 * mentah — `tr()` memulangkan input asalnya bila ia bukan kunci yang dikenali, jadi
 * kedua-dua bentuk berfungsi.
 */
function showPosEmbedPage(file, iframeTitle, leadHtml, topbarText) {
  activeShellView = {
    kind: "embed",
    iframeTitleKey: iframeTitle || "",
    titleKey: topbarText || iframeTitle || "",
    leadKey: leadHtml || ""
  };
  var iframe = activateContentEmbed(file, iframeTitle ? tr(iframeTitle) : "TAB KAUNTER");
  if (!iframe) return;
  if (topbarTitle) {
    topbarTitle.textContent = topbarText
      ? tr(topbarText)
      : iframeTitle
        ? tr(iframeTitle)
        : "Point Of Sale";
  }
  setTopbarEmbedLead(leadHtml ? tr(leadHtml) : "");
  persistShell({
    r: "pos-embed",
    module: "pos",
    embedFile: file || "",
    embedTitle: iframeTitle || "",
    embedLead: leadHtml || "",
    embedTopbar: topbarText || ""
  });
}

function syncModuleChoiceIndicator() {
  var mod = body.getAttribute("data-module") === "bo" ? "bo" : "pos";
  var posBtn = document.querySelector(".module-choice--pos");
  var boBtn = document.querySelector(".module-choice--bo");
  if (posBtn) {
    posBtn.classList.toggle("is-current", mod === "pos");
    if (mod === "pos") posBtn.setAttribute("aria-current", "true");
    else posBtn.removeAttribute("aria-current");
  }
  if (boBtn) {
    boBtn.classList.toggle("is-current", mod === "bo");
    if (mod === "bo") boBtn.setAttribute("aria-current", "true");
    else boBtn.removeAttribute("aria-current");
  }
}

function applyModule(mode) {
  var m = mode === "bo" ? "bo" : "pos";
  body.setAttribute("data-module", m);
  setStoredModule(m);

  var c = copyFor(m);
  if (tagEl) tagEl.textContent = c.tag;
  if (topbarTitle) topbarTitle.textContent = c.topbar;
  if (contentLead) {
    contentLead.innerHTML = c.lead;
    contentLead.removeAttribute("hidden");
  }
  if (panelTitle) panelTitle.textContent = c.panelTitle;
  if (panelBody) panelBody.textContent = c.panelBody;

  if (navPos && navBo) {
    if (m === "pos") {
      navBo.hidden = true;
      navBo.classList.add("is-hidden");
      navPos.hidden = false;
      navPos.classList.remove("is-hidden");
      setActiveNav(navPos, null);
      hideEmbed();
    } else {
      navPos.hidden = true;
      navPos.classList.add("is-hidden");
      navBo.hidden = false;
      navBo.classList.remove("is-hidden");
      setActiveNav(navBo, ".js-bo-dashboard");
      if (canAccessBackOfficeModule()) {
        showBoDashboard();
      } else {
        hideEmbed();
      }
    }
  } else {
    hideEmbed();
  }
  syncModuleChoiceIndicator();
  persistShell({ r: m === "bo" ? "bo-home" : "pos-home", module: m });
}

function openLayer() {
  if (!layer || !trigger) return;
  syncModuleChoiceIndicator();
  layer.hidden = false;
  trigger.setAttribute("aria-expanded", "true");
  trigger.classList.add("is-open");
  var currentChoice = layer.querySelector(".module-choice.is-current") || layer.querySelector(".js-set-module");
  if (currentChoice) currentChoice.focus();
}

function closeLayer() {
  if (!layer || !trigger) return;
  layer.hidden = true;
  trigger.setAttribute("aria-expanded", "false");
  trigger.classList.remove("is-open");
  trigger.focus();
}

/** Label mesra bar status (bukan kod dalaman RBAC). */
function roleStatusBarLabel(role) {
  var r = role || ROLES.CASHIER;
  if (r === ROLES.CASHIER) return "STAFF";
  if (r === ROLES.SHIFT_LEAD) return "SHIFT LEAD";
  if (r === ROLES.OWNER) return "OWNER";
  if (r === ROLES.ADMIN) return "ADMIN";
  return String(r);
}

function renderStatusBar() {
  if (!statusBar) return;
  var snap = getSnapshot();
  var s = snap.session;
  var hub = snap.hub;
  var eff = snap.effectiveStatus;
  /** Online = drawer/shift dibuka — jualan penuh dibenarkan (selaras `SHIFT_OPEN`). */
  var isOnline = eff === OPERATIONAL_STATUS.SHIFT_OPEN;
  var connectionLabel = isOnline ? "Online" : "Offline";
  var roleLabel = roleStatusBarLabel(s.role);
  var pinWarn = snap.isPinLocked ? '<span class="kb-badge kb-badge--warn">PIN locked</span>' : "";
  var pinRow = pinWarn ? '<span class="kb-status-bar__item">' + pinWarn + "</span>" : "";
  statusBar.innerHTML =
    '<span class="kb-status-bar__item"><strong>' +
    escapeHtml(roleLabel) +
    "</strong></span>" +
    pinRow +
    '<span class="kb-status-bar__item kb-status-bar__shift ' +
    (isOnline ? "kb-status-bar__shift--online" : "kb-status-bar__shift--offline") +
    '">' +
    escapeHtml(connectionLabel) +
    "</span>";
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Ayat ringkas untuk ralat baca koleksi `staff` (modal / sidebar). */
function staffFetchErrorHint(e) {
  var code = String((e && e.code) || "");
  if (code === "auth/no-user") return tr("clock.fetch.noSession");
  if (code === "permission-denied") return tr("clock.fetch.denied");
  if (code === "unavailable" || code === "deadline-exceeded") return tr("clock.fetch.network");
  return tr("clock.fetch.fail");
}

/** Cache senarai `staff` — dikemas kini masa nyata; satu pilihan per nama (nyahpendua). */
var staffRowsCache = [];
var staffRowsLastError = null;
var staffRowsRealtimeReady = false;
var staffRowsRealtimeUnsub = null;
var staffRowsUpdateListeners = [];

function normalizeStaffRowNameKey(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function mapDedupeSortStaffRowsFromDocs(docs) {
  var docsSorted = docs.slice().sort(function (a, b) {
    return String(a.id).localeCompare(String(b.id));
  });
  var seen = {};
  var owners = [];
  var rows = [];
  for (var i = 0; i < docsSorted.length; i++) {
    var d = docsSorted[i];
    var x = d.data();
    var name = String(x.name || x.staffName || "").trim() || d.id;
    var isOwner =
      !!x.isOwner || String(x.role || "").toLowerCase() === "owner" || d.id === "owner_01";
    if (!isOwner) {
      var emp = String(x.employmentStatus || "active").toLowerCase();
      if (emp && emp !== "active") continue;
    }
    if (isOwner) {
      owners.push({ id: d.id, name: name, isOwner: true });
      continue;
    }
    var key = normalizeStaffRowNameKey(name);
    if (seen[key]) continue;
    seen[key] = true;
    rows.push({ id: d.id, name: name, isOwner: false });
  }
  rows.sort(function (a, b) {
    return a.name.localeCompare(b.name, "ms");
  });
  owners.sort(function (a, b) {
    return a.name.localeCompare(b.name, "ms");
  });
  return owners.concat(rows);
}

function notifyStaffRowsListeners() {
  staffRowsUpdateListeners.forEach(function (fn) {
    try {
      fn();
    } catch (e) {}
  });
}

function subscribeStaffRowsListener(fn) {
  staffRowsUpdateListeners.push(fn);
  return function () {
    staffRowsUpdateListeners = staffRowsUpdateListeners.filter(function (x) {
      return x !== fn;
    });
  };
}

function getStaffRowsCached() {
  return staffRowsCache.slice();
}

function staffRowsBuildOptionsHtml(rows, curSelectedId, emptyOptionLabel) {
  var cur = String(curSelectedId || "").trim();
  var opts = '<option value="">' + escapeHtml(emptyOptionLabel) + "</option>";
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var idEsc = escapeHtml(r.id);
    var label = r.name;
    opts +=
      '<option value="' +
      idEsc +
      '"' +
      (cur === r.id ? " selected" : "") +
      ">" +
      escapeHtml(label) +
      "</option>";
  }
  return opts;
}

function ensureStaffCollectionRealtimeSub() {
  if (staffRowsRealtimeUnsub) return;
  staffRowsLastError = null;
  staffRowsRealtimeReady = false;
  waitForAuthUser()
    .then(function (u) {
      if (!u) {
        var err = new Error("AUTH_REQUIRED");
        err.code = "auth/no-user";
        staffRowsLastError = err;
        staffRowsRealtimeReady = true;
        staffRowsCache = [];
        notifyStaffRowsListeners();
        return;
      }
      return u.getIdToken(false).then(function () {
        staffRowsRealtimeUnsub = onSnapshot(
          query(collection(db, COL_STAFF), limit(200)),
          function (snap) {
            staffRowsLastError = null;
            staffRowsRealtimeReady = true;
            staffRowsCache = mapDedupeSortStaffRowsFromDocs(snap.docs);
            notifyStaffRowsListeners();
          },
          function (err) {
            console.warn("[staff collection realtime]", err);
            staffRowsLastError = err;
            staffRowsRealtimeReady = true;
            staffRowsCache = [];
            notifyStaffRowsListeners();
          }
        );
      });
    })
    .catch(function (e) {
      staffRowsLastError = e;
      staffRowsRealtimeReady = true;
      staffRowsCache = [];
      notifyStaffRowsListeners();
    });
}

function stopStaffRowsRealtimeSync() {
  try {
    if (typeof staffRowsRealtimeUnsub === "function") {
      staffRowsRealtimeUnsub();
    }
  } catch (e) {}
  staffRowsRealtimeUnsub = null;
  staffRowsRealtimeReady = false;
  staffRowsCache = [];
  staffRowsLastError = null;
}

/** Masa clock in dalam locale Malaysia */
function formatClockedInHuman(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(getIntlLocale(), {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch (e) {
    return "—";
  }
}

function opsChipHtml(kind, text) {
  return (
    '<span class="ops-chip ops-chip--' +
    escapeHtml(kind) +
    '">' +
    escapeHtml(text) +
    "</span>"
  );
}

function clockFactsHtml(s, hub) {
  var shiftOpen = !!(hub.shift && hub.shift.isOpen);
  var wr = String(s.operationalWorkRole || "").trim().toLowerCase();
  var roleText = wr || tr("clock.chip.none");
  var roleKind = wr === "kitchen" ? "kitchen" : wr === "owner" ? "owner" : wr === "cashier" ? "cashier" : "muted";
  var clockChip = s.clockedIn
    ? opsChipHtml("ok", tr("clock.onDuty"))
    : opsChipHtml("muted", tr("clock.chip.offDuty"));
  var drawerChip = shiftOpen
    ? opsChipHtml("ok", tr("shift.pill.open"))
    : hub.shift && hub.shift.closing
      ? opsChipHtml("warn", tr("shift.pill.closed"))
      : opsChipHtml("muted", tr("shift.pill.notOpen"));
  var totpChip = s.clockedIn
    ? '<span id="kb-clock-fact-totp" class="ops-chip ops-chip--muted">' +
      escapeHtml(tr("clock.chip.totpWait")) +
      "</span>"
    : opsChipHtml("muted", tr("clock.chip.none"));
  var testingRow = s.clockedIn && s.ownerTestingSession
    ? '<div class="ops-fact ops-fact--span">' +
      opsChipHtml("muted", tr("staff.badge.testing")) +
      "</div>"
    : "";
  return (
    '<div class="ops-facts" role="list">' +
    '<div class="ops-fact" role="listitem"><span class="ops-fact__lbl">' +
    escapeHtml(tr("clock.fact.clock")) +
    "</span>" +
    clockChip +
    "</div>" +
    '<div class="ops-fact" role="listitem"><span class="ops-fact__lbl">' +
    escapeHtml(tr("clock.fact.role")) +
    '</span><span class="ops-role ops-role--' +
    roleKind +
    '">' +
    escapeHtml(roleText) +
    "</span></div>" +
    '<div class="ops-fact" role="listitem"><span class="ops-fact__lbl">' +
    escapeHtml(tr("clock.fact.drawer")) +
    "</span>" +
    drawerChip +
    "</div>" +
    '<div class="ops-fact" role="listitem"><span class="ops-fact__lbl">' +
    escapeHtml(tr("clock.fact.totp")) +
    "</span>" +
    totpChip +
    "</div>" +
    testingRow +
    "</div>"
  );
}

/** Ayat mudah difahami untuk status operasi (bukan kod teknikal) */
function operationalStatusHumanLine(st) {
  if (st === OPERATIONAL_STATUS.NOT_CLOCKED_IN) return tr("clock.status.notClockedIn");
  if (st === OPERATIONAL_STATUS.CLOCKED_IN) {
    var wr = String(loadSession().operationalWorkRole || "").trim().toLowerCase();
    if (isOwnerRole() || wr === "owner") return tr("clock.status.clockedInOwner");
    return tr("clock.status.clockedInNeedDrawer");
  }
  if (st === OPERATIONAL_STATUS.SHIFT_OPEN) return tr("clock.status.shiftOpen");
  if (st === OPERATIONAL_STATUS.SHIFT_CLOSED) return tr("clock.status.shiftClosed");
  return escapeHtml(String(st));
}

/** Satu ayat ringkas tentang laci / drawer POS (tanpa ID teknikal). Ikut status operasi; bukan `hub.shift.isOpen` sahaja (stor boleh kekal “dibuka” waktu belum clock in). */
function shiftPosHumanLine(hub, eff) {
  if (eff === OPERATIONAL_STATUS.NOT_CLOCKED_IN) return tr("clock.drawer.notClockedIn");
  if (eff === OPERATIONAL_STATUS.SHIFT_CLOSED) return tr("clock.drawer.shiftClosed");
  if (hub.shift && hub.shift.isOpen) return tr("clock.drawer.open");
  return tr("clock.drawer.notOpen");
}

function applyPosWorkspaceChrome() {
  var boChoice = document.querySelector(".module-choice--bo");
  if (boChoice) {
    var allowBo = canAccessBackOfficeModule();
    boChoice.hidden = !allowBo;
    if (!allowBo) boChoice.setAttribute("hidden", "");
    else boChoice.removeAttribute("hidden");
  }
  if (trigger) {
    trigger.classList.toggle("sidebar__brand--pos-only", !isElevatedRole());
    trigger.setAttribute("aria-disabled", !isElevatedRole() ? "true" : "false");
  }
}

function enforceStaffStaysOnCounter() {
  if (isElevatedRole()) return;
  try {
    sessionStorage.setItem(STORAGE_KEY, "pos");
  } catch (e) {}
}

function applyPosLinkLocks() {
  if (!navPos) return;
  navPos.querySelectorAll(".sidebar__link[data-rbac-lock]").forEach(function (a) {
    a.classList.remove("is-locked");
    a.removeAttribute("title");
    a.removeAttribute("aria-disabled");
  });
  navPos.querySelectorAll(".sidebar__link[data-pos-embed]").forEach(function (a) {
    var need = a.getAttribute("data-rbac-lock");
    if (!need) return;
    var blocked = false;
    if (need === "clocked" || need === "shift-open") blocked = !canAccessOperationalModules();
    if (blocked) {
      a.classList.add("is-locked");
      a.setAttribute("aria-disabled", "true");
      a.title = staffLockMessage();
    }
  });
}

/**
 * Tutup skrin terbenam Jualan / Resit / Senarai Pesanan serta nyahaktif pautan aktif
 * apabila pengguna tidak lagi dibenarkan (contoh: clock out).
 */
function enforceLockedPosEmbedsClosed() {
  if (canBypassStaffRestrictions()) return;
  if (canAccessOperationalModules()) return;
  var iframe = getActiveEmbedIframe();
  var wrap = getEmbedWrap();
  var src = iframe ? String(iframe.getAttribute("src") || iframe.getAttribute("data-embed-key") || "") : "";
  var isPosEmbed =
    src.indexOf("pos-order.html") !== -1 ||
    src.indexOf("pos-receipts.html") !== -1 ||
    src.indexOf("pos-order-board.html") !== -1;
  if (wrap && !wrap.hidden && !isPosEmbed) return;
  destroyEmbedFrames(POS_EMBED_KEYS);
  if (!wrap || wrap.hidden) return;
  if (!isPosEmbed) return;
  hideEmbed();
  if (navPos) {
    navPos.querySelectorAll(".sidebar__link[data-pos-embed]").forEach(function (a) {
      a.classList.remove("is-active");
      a.removeAttribute("aria-current");
    });
    setActiveNav(navPos, ".js-nav-clock");
  }
  persistShellForce({ r: "pos-clock", module: "pos" });
}

function tryConsumePosEmbedClick(t, navRoot, e) {
  if (!navRoot.classList.contains("js-nav-pos") || !t.hasAttribute("data-pos-embed")) return false;
  var need = t.getAttribute("data-rbac-lock");
    if ((need === "clocked" || need === "shift-open") && !canAccessOperationalModules()) {
      e.preventDefault();
      window.alert(staffLockMessage());
      return true;
    }
  return false;
}

/**
 * Ambil GPS semasa untuk sekatan lokasi kedai di clock-in.
 * Staf: GPS wajib (tiada null senyap). Cache lama ditolak.
 * @returns {Promise<{ lat: number, lng: number } | null>}
 */
function getCurrentCoords() {
  return getCurrentCoordsFresh(false);
}

function getCurrentCoordsFresh(requireFix) {
  return new Promise(function (resolve) {
    var settled = false;
    function finish(value) {
      if (settled) return;
      settled = true;
      resolve(value);
    }
    var waitMs = requireFix ? 12000 : 4500;
    setTimeout(function () {
      finish(null);
    }, waitMs);
    if (!navigator.geolocation) {
      finish(null);
      return;
    }
    try {
      navigator.geolocation.getCurrentPosition(
        function (pos) {
          finish({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: typeof pos.coords.accuracy === "number" ? pos.coords.accuracy : 99999
          });
        },
        function () {
          finish(null);
        },
        {
          enableHighAccuracy: !!requireFix,
          timeout: requireFix ? 10000 : 4000,
          maximumAge: requireFix ? 0 : 60000
        }
      );
    } catch (e) {
      finish(null);
    }
  });
}

function withTimeout(promise, ms, fallback) {
  return new Promise(function (resolve) {
    var done = false;
    var t = setTimeout(function () {
      if (done) return;
      done = true;
      resolve(fallback);
    }, ms);
    Promise.resolve(promise).then(
      function (v) {
        if (done) return;
        done = true;
        clearTimeout(t);
        resolve(v);
      },
      function () {
        if (done) return;
        done = true;
        clearTimeout(t);
        resolve(fallback);
      }
    );
  });
}

var totpEnabledCache = {};

/**
 * Semak (dengan cache dalam memori) sama ada 2FA diaktifkan Owner untuk staf ini.
 * Rekod Owner sendiri tidak pernah tertakluk Staff-2FA — sentiasa false.
 */
async function staffTotpEnabledCached(staffId) {
  var id = String(staffId || "").trim();
  if (!id) return false;
  if (Object.prototype.hasOwnProperty.call(totpEnabledCache, id)) return totpEnabledCache[id];
  try {
    var snap = await getDoc(doc(db, "staff_totp_status", id));
    var enabled = snap.exists() && snap.data().enabled === true;
    totpEnabledCache[id] = enabled;
    return enabled;
  } catch (e) {
    console.warn("[clock-in] staff_totp_status check error:", e);
    return false;
  }
}

/**
 * Modal: sahkan kod 2FA sebelum clock-out (dipaparkan hanya kalau staf tu ada 2FA diaktifkan).
 * @param {string} staffId
 * @param {string} staffName
 * @param {() => void} onConfirmed — dipanggil selepas kod sah
 * @param {() => void} [onCancel]
 * @param {{ testingSession?: boolean }} [extra]
 */
function showClockOutTotpModal(staffId, staffName, onConfirmed, onCancel, extra) {
  var backdrop = document.createElement("div");
  backdrop.className = "kb-clock-in-staff-modal__backdrop";
  backdrop.setAttribute("aria-hidden", "false");

  var dialog = document.createElement("div");
  dialog.className = "kb-clock-in-staff-modal";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "kb-clockout-totp-title");

  dialog.innerHTML =
    '<div class="kb-clock-in-staff-modal__head">' +
    '<h2 id="kb-clockout-totp-title" class="kb-clock-in-staff-modal__title">' +
    escapeHtml(interpolate(tr("clock.totp.outTitle"), { name: staffName || "" })) +
    "</h2>" +
    '<button type="button" class="btn-close-x" id="kb-clockout-totp-x" aria-label="' +
    escapeHtml(tr("common.close")) +
    '">✕</button>' +
    "</div>" +
    '<p class="kb-clock-in-staff-modal__lead">' +
    escapeHtml(tr("clock.totp.outLead")) +
    "</p>" +
    '<label class="kb-clock-in-staff-modal__label" for="kb-clockout-totp-input">' +
    escapeHtml(tr("clock.totp.codeLabel")) +
    "</label>" +
    '<input type="text" inputmode="numeric" id="kb-clockout-totp-input" class="kb-clock-in-staff-modal__input" maxlength="6" placeholder="' +
    escapeHtml(tr("clock.totp.codePh")) +
    '" autocomplete="off" />' +
    '<p id="kb-clockout-totp-error" class="kb-clock-in-staff-modal__error" hidden></p>' +
    '<div class="kb-clock-in-staff-modal__actions">' +
    '<button type="button" class="btn btn--ghost" id="kb-clockout-totp-cancel">' +
    escapeHtml(tr("common.cancel")) +
    "</button>" +
    '<button type="button" class="btn btn--primary" id="kb-clockout-totp-ok">' +
    escapeHtml(tr("clock.totp.confirmOut")) +
    "</button>" +
    "</div>";

  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);

  // Prefetch GPS + modul callable SEKARANG (selari dengan pengguna masuk kod 2FA) —
  // elak freeze bila klik Sahkan.
  var coordsPromise = getCurrentCoords();
  var totpCallablesPromise = import("./staff/totp-callables.js");

  var input = dialog.querySelector("#kb-clockout-totp-input");
  var err = dialog.querySelector("#kb-clockout-totp-error");
  var btnOk = dialog.querySelector("#kb-clockout-totp-ok");
  var btnCancel = dialog.querySelector("#kb-clockout-totp-cancel");
  var btnX = dialog.querySelector("#kb-clockout-totp-x");

  function cleanup() {
    document.removeEventListener("keydown", onKey);
    try {
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
    } catch (e) {}
  }
  function onKey(e) {
    if (e.key === "Escape") {
      cleanup();
      if (onCancel) onCancel();
    }
  }
  document.addEventListener("keydown", onKey);
  backdrop.addEventListener("click", function (e) {
    if (e.target === backdrop) {
      cleanup();
      if (onCancel) onCancel();
    }
  });
  function cancelModal() {
    cleanup();
    if (onCancel) onCancel();
  }
  btnCancel.onclick = cancelModal;
  if (btnX) btnX.onclick = cancelModal;

  btnOk.onclick = async function () {
    var code = String(input.value || "").trim();
    if (!/^\d{6}$/.test(code)) {
      err.textContent = tr("clock.totp.needSix");
      err.hidden = false;
      return;
    }
    btnOk.disabled = true;
    btnOk.textContent = tr("clock.totp.verifying");
    try {
      var coords = await coordsPromise;
      var { verifyStaffClockIn } = await totpCallablesPromise;
      var result = await verifyStaffClockIn(staffId, code, coords, {
        action: "clock_out",
        testingSession: !!(extra && extra.testingSession)
      });
      if (!result.verified) {
        err.textContent = result.error || tr("clock.totp.mismatch");
        err.hidden = false;
        input.value = "";
        input.focus();
        btnOk.disabled = false;
        btnOk.textContent = tr("clock.totp.confirmOut");
        return;
      }
      cleanup();
      onConfirmed();
    } catch (e2) {
      console.warn("[clock-out] verify error:", e2);
      err.textContent = tr("clock.totp.fail");
      err.hidden = false;
      btnOk.disabled = false;
      btnOk.textContent = tr("clock.totp.confirmOut");
    }
  };
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      btnOk.click();
    }
  });
  input.focus();
}

/**
 * Modal: pilih rekod `staff` + tugas (Cashier/Kitchen) — dipaparkan selepas tekan Clock in (akaun kongsi).
 * @param {(picked: { id: string, name: string, workRole: string } | null) => void} onClose — null jika batal
 */
function showClockInStaffPickerModal(onClose) {
  var ownerPicker = isOwnerRole();
  var backdrop = document.createElement("div");
  backdrop.className = "kb-clock-in-staff-modal__backdrop";
  backdrop.setAttribute("aria-hidden", "false");

  var dialog = document.createElement("div");
  dialog.className = "kb-clock-in-staff-modal";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "kb-clock-in-staff-title");

  dialog.innerHTML =
    '<div class="kb-clock-in-staff-modal__head">' +
    '<h2 id="kb-clock-in-staff-title" class="kb-clock-in-staff-modal__title">' +
    escapeHtml(tr(ownerPicker ? "clock.picker.ownerTitle" : "clock.picker.title")) +
    "</h2>" +
    '<button type="button" class="btn-close-x" id="kb-clock-in-staff-x" aria-label="' +
    escapeHtml(tr("common.close")) +
    '">✕</button>' +
    "</div>" +
    '<p class="kb-clock-in-staff-modal__lead">' +
    escapeHtml(tr(ownerPicker ? "clock.picker.ownerLead" : "clock.picker.lead")) +
    "</p>" +
    (ownerPicker || SKIP_CLOCK_IN_GEO
      ? ""
      : '<p id="kb-clock-in-proximity" class="kb-clock-in-staff-modal__proximity" role="status">' +
        escapeHtml(tr("clock.geo.checking")) +
        "</p>") +
    '<label class="kb-clock-in-staff-modal__label" for="kb-clock-in-staff-sel">' +
    escapeHtml(tr("clock.picker.staff")) +
    "</label>" +
    '<select id="kb-clock-in-staff-sel" class="kb-clock-in-staff-modal__select" aria-label="' +
    escapeHtml(tr("clock.picker.staffAria")) +
    '">' +
    '<option value="">' +
    escapeHtml(tr("clock.picker.loading")) +
    "</option></select>" +
    '<p id="kb-totp-status" class="ops-totp-status" hidden></p>' +
    '<div id="kb-role-section">' +
    '<label class="kb-clock-in-staff-modal__label" for="kb-clock-in-role-sel">' +
    escapeHtml(tr("clock.picker.roleLabel")) +
    "</label>" +
    '<select id="kb-clock-in-role-sel" class="kb-clock-in-staff-modal__select" aria-label="' +
    escapeHtml(tr("clock.picker.roleAria")) +
    '">' +
    '<option value="">' +
    escapeHtml(tr("clock.picker.pickRole")) +
    "</option>" +
    '<option value="cashier" id="kb-role-opt-cashier">Cashier</option>' +
    '<option value="kitchen">Kitchen</option>' +
    "</select>" +
    '<p id="kb-role-cashier-taken"></p>' +
    '<p id="kb-role-error" class="kb-clock-in-staff-modal__error">' +
    escapeHtml(tr("clock.picker.roleError")) +
    "</p>" +
    "</div>" +
    '<div id="kb-totp-section">' +
    '<label class="kb-clock-in-staff-modal__label" for="kb-clock-in-totp-input">' +
    escapeHtml(tr("clock.totp.codeLabel")) +
    "</label>" +
    '<input type="text" inputmode="numeric" id="kb-clock-in-totp-input" class="kb-clock-in-staff-modal__input" maxlength="6" placeholder="' +
    escapeHtml(tr("clock.totp.codePh")) +
    '" autocomplete="off" />' +
    '<p id="kb-totp-error" class="kb-clock-in-staff-modal__error">' +
    escapeHtml(tr("clock.totp.mismatch")) +
    "</p>" +
    "</div>" +
    (ownerPicker
      ? '<label class="kb-clock-in-staff-modal__testing" for="kb-clock-in-testing">' +
        '<input type="checkbox" id="kb-clock-in-testing" />' +
        "<span>" +
        escapeHtml(tr("clock.owner.testingLabel")) +
        "</span></label>"
      : "") +
    '<p id="kb-clock-in-form-error" class="kb-clock-in-staff-modal__error" hidden></p>' +
    '<div class="kb-clock-in-staff-modal__actions">' +
    '<button type="button" class="btn btn--primary" id="kb-clock-in-staff-ok">' +
    escapeHtml(tr("clock.picker.confirm")) +
    "</button>" +
    '<button type="button" class="btn btn--ghost" id="kb-clock-in-staff-cancel">' +
    escapeHtml(tr("common.cancel")) +
    "</button>" +
    "</div>";

  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);

  // Prefetch modul callable. Staf: semak GPS vs lokasi POS dulu — clock in jauh ditolak
  // walaupun kod 2FA dikongsi dengan kawan.
  var totpCallablesPromise = import("./staff/totp-callables.js");
  var verifiedCoords = null;
  var proximityOk = !!ownerPicker || SKIP_CLOCK_IN_GEO;

  var sel = dialog.querySelector("#kb-clock-in-staff-sel");
  var btnOk = dialog.querySelector("#kb-clock-in-staff-ok");
  var btnCancel = dialog.querySelector("#kb-clock-in-staff-cancel");
  var btnX = dialog.querySelector("#kb-clock-in-staff-x");
  var actionsRow = dialog.querySelector(".kb-clock-in-staff-modal__actions");
  var roleSection = dialog.querySelector("#kb-role-section");
  var roleSel = dialog.querySelector("#kb-clock-in-role-sel");
  var roleOptCashier = dialog.querySelector("#kb-role-opt-cashier");
  var roleCashierTaken = dialog.querySelector("#kb-role-cashier-taken");
  var roleError = dialog.querySelector("#kb-role-error");
  var totpSection = dialog.querySelector("#kb-totp-section");
  var totpInput = dialog.querySelector("#kb-clock-in-totp-input");
  var totpError = dialog.querySelector("#kb-totp-error");
  var testingChk = dialog.querySelector("#kb-clock-in-testing");
  var formError = dialog.querySelector("#kb-clock-in-form-error");
  var totpStatusEl = dialog.querySelector("#kb-totp-status");
  var selectedStaffRequiresTotp = false;
  var clockInSubmitting = false;

  function showClockInFormError(msg) {
    var text = String(msg || tr("clock.picker.inFail"));
    if (formError) {
      formError.textContent = text;
      formError.hidden = false;
      formError.style.display = "block";
    }
    if (roleSection && roleSection.style.display !== "none" && roleError) {
      roleError.textContent = text;
      roleError.style.display = "block";
    }
  }

  function isProximityDeny(result) {
    var code = result && result.errorCode ? String(result.errorCode) : "";
    if (code === "too_far" || code === "gps_required" || code === "location_not_set" || code === "gps_inaccurate") {
      return code;
    }
    var msg = result && result.error ? String(result.error) : "";
    if (/gps_inaccurate|GPS tidak tepat|tidak cukup tepat/i.test(msg)) return "gps_inaccurate";
    if (/location_not_set|Store location is not set|lokasi kedai belum/i.test(msg)) return "location_not_set";
    if (/too_far|too far from the POS|terlalu jauh dari terminal|luar kawasan kedai/i.test(msg)) return "too_far";
    if (/gps_required|Location is required|Akses lokasi diperlukan|Lokasi \(GPS\)/i.test(msg)) {
      return "gps_required";
    }
    return "";
  }

  function showClockInGeoBlocked(code) {
    if (totpError) totpError.style.display = "none";
    if (roleError) roleError.style.display = "none";
    var body =
      code === "gps_required"
        ? tr("clock.geo.gpsRequired")
        : code === "location_not_set"
          ? tr("clock.geo.locationNotSet")
          : code === "gps_inaccurate"
            ? tr("clock.geo.gpsInaccurate")
            : tr("clock.geo.tooFar");
    if (formError) {
      formError.innerHTML =
        '<strong class="kb-clock-in-staff-modal__error-title">' +
        escapeHtml(tr("clock.geo.blockedTitle")) +
        "</strong>" +
        '<span class="kb-clock-in-staff-modal__error-body">' +
        escapeHtml(body) +
        "</span>";
      formError.hidden = false;
      formError.style.display = "block";
    }
    var proxEl = dialog.querySelector("#kb-clock-in-proximity");
    if (proxEl) {
      proxEl.textContent = tr("clock.geo.blockedTitle");
      proxEl.classList.add("is-blocked");
    }
  }

  function setProximityHint(text, blocked) {
    var proxEl = dialog.querySelector("#kb-clock-in-proximity");
    if (!proxEl) return;
    proxEl.textContent = text || "";
    proxEl.classList.toggle("is-blocked", !!blocked);
    proxEl.classList.toggle("is-ok", !blocked && !!text && text === tr("clock.geo.nearOk"));
  }

  async function verifyStaffProximity() {
    if (SKIP_CLOCK_IN_GEO || ownerPicker) {
      proximityOk = true;
      verifiedCoords = null;
      return { ok: true, coords: null };
    }
    if (btnOk) btnOk.disabled = true;
    setProximityHint(tr("clock.geo.checking"), false);
    var locSnap;
    try {
      locSnap = await getDoc(doc(db, "pos_meta", "store_location"));
    } catch (e) {
      showClockInGeoBlocked("gps_required");
      proximityOk = false;
      return { ok: false };
    }
    if (!locSnap || !locSnap.exists()) {
      showClockInGeoBlocked("location_not_set");
      proximityOk = false;
      return { ok: false };
    }
    var loc = locSnap.data() || {};
    var storeLat = Number(loc.lat);
    var storeLng = Number(loc.lng);
    if (!isFinite(storeLat) || !isFinite(storeLng)) {
      showClockInGeoBlocked("location_not_set");
      proximityOk = false;
      return { ok: false };
    }
    var radius = Number(loc.radiusMeters);
    if (!(radius > 0)) radius = 150;
    var trustedPos = isTrustedPosTerminal(storeLat, storeLng);
    var coords = await getCurrentCoordsFresh(true);
    var judged = judgeProximity(storeLat, storeLng, radius, coords, trustedPos);
    if (!judged.ok) {
      showClockInGeoBlocked(judged.errorCode || "too_far");
      proximityOk = false;
      verifiedCoords = null;
      if (totpInput) totpInput.disabled = true;
      return { ok: false };
    }
    var outCoords = coords
      ? {
          lat: coords.lat,
          lng: coords.lng,
          accuracy: coords.accuracy,
          trustedPos: judged.reason === "trusted_pos"
        }
      : { lat: storeLat, lng: storeLng, accuracy: 0, trustedPos: true };
    if (formError) {
      formError.textContent = "";
      formError.innerHTML = "";
      formError.hidden = true;
      formError.style.display = "none";
    }
    setProximityHint(tr("clock.geo.nearOk"), false);
    proximityOk = true;
    verifiedCoords = outCoords;
    if (totpInput) totpInput.disabled = false;
    if (btnOk) btnOk.disabled = false;
    return { ok: true, coords: outCoords };
  }

  function resetClockInSubmitBtn() {
    clockInSubmitting = false;
    if (!btnOk || !btnOk.isConnected) return;
    btnOk.disabled = ownerPicker || SKIP_CLOCK_IN_GEO ? false : !proximityOk;
    btnOk.textContent = tr("clock.picker.confirm");
  }

  function paintCashierSlotOption() {
    var slot = getActiveCashierSlot();
    if (roleOptCashier) {
      roleOptCashier.disabled = !!slot;
      roleOptCashier.textContent = slot ? tr("clock.picker.cashierTaken") : tr("clock.picker.cashierOption");
    }
    if (roleCashierTaken) {
      if (slot) {
        roleCashierTaken.textContent = interpolate(tr("clock.picker.cashierNow"), {
          name: slot.staffName || "staf lain"
        });
        roleCashierTaken.style.display = "block";
      } else {
        roleCashierTaken.textContent = "";
        roleCashierTaken.style.display = "none";
      }
    }
    if (slot && roleSel && roleSel.value === "cashier") {
      roleSel.value = "";
    }
  }
  var unsubCashierSlot = subscribeActiveShiftDocs(paintCashierSlotOption);

  // Show/hide tugas + 2FA section bila staf dipilih
  sel.addEventListener("change", function () {
    var v = String(sel.value || "").trim();
    selectedStaffRequiresTotp = false;
    totpSection.style.display = "none";
    totpInput.value = "";
    totpError.style.display = "none";
    roleSection.style.display = v && !ownerPicker ? "block" : "none";
    roleSel.value = "";
    roleError.style.display = "none";
    if (totpStatusEl) {
      if (!v) {
        totpStatusEl.hidden = true;
        totpStatusEl.textContent = "";
      } else {
        totpStatusEl.hidden = false;
        totpStatusEl.innerHTML =
          '<span class="ops-fact__lbl">' +
          escapeHtml(tr("clock.fact.totp")) +
          "</span> " +
          '<span class="ops-chip ops-chip--muted">' +
          escapeHtml(tr("clock.chip.totpWait")) +
          "</span>";
      }
    }
    function applyTotpUi(enabled) {
      selectedStaffRequiresTotp = enabled;
      totpSection.style.display = enabled ? "block" : "none";
      if (totpStatusEl && String(sel.value || "").trim() === v) {
        totpStatusEl.hidden = false;
        totpStatusEl.innerHTML =
          '<span class="ops-fact__lbl">' +
          escapeHtml(tr("clock.fact.totp")) +
          "</span> " +
          '<span class="ops-chip ops-chip--' +
          (enabled ? "ok" : "muted") +
          '">' +
          escapeHtml(enabled ? tr("clock.chip.totpOn") : tr("clock.chip.totpOff")) +
          "</span>";
      }
    }
    if (v && ownerPicker) {
      staffTotpEnabledCached(v).then(function (enabled) {
        if (String(sel.value || "").trim() !== v) return;
        applyTotpUi(enabled);
      });
    } else if (v) {
      if (roleSel && !(roleOptCashier && roleOptCashier.disabled)) {
        roleSel.value = "cashier";
      } else if (roleSel && roleOptCashier && roleOptCashier.disabled) {
        roleSel.value = "";
      }
      staffTotpEnabledCached(v).then(function (enabled) {
        if (String(sel.value || "").trim() !== v) return;
        applyTotpUi(enabled);
      });
    }
  });

  roleSel.addEventListener("change", function () {
    if (roleSel.value) roleError.style.display = "none";
  });

  // Allow Enter key in 2FA input to submit
  totpInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      btnOk.click();
    }
  });

  var retryWrap = document.createElement("p");
  retryWrap.className = "kb-clock-in-staff-modal__retry";
  retryWrap.hidden = true;
  retryWrap.innerHTML =
    '<button type="button" class="btn btn--ghost" id="kb-clock-in-staff-retry">Cuba semula</button>';
  dialog.insertBefore(retryWrap, actionsRow);
  var btnRetry = dialog.querySelector("#kb-clock-in-staff-retry");

  var unsubModalStaff = null;
  var modalStaffFocusOnce = false;

  function paintClockInModalStaffSelect() {
    if (clockInSubmitting) return;
    if (staffRowsLastError) {
      modalStaffFocusOnce = false;
      retryWrap.hidden = false;
      sel.innerHTML =
        '<option value="">' + escapeHtml("— " + staffFetchErrorHint(staffRowsLastError) + " —") + "</option>";
      try {
        btnRetry.focus();
      } catch (e) {}
      return;
    }
    if (!staffRowsRealtimeReady) {
      retryWrap.hidden = true;
      sel.innerHTML = '<option value="">' + escapeHtml(tr("clock.picker.loading")) + "</option>";
      return;
    }
    retryWrap.hidden = true;
    var rows = getStaffRowsCached();
    if (ownerPicker) {
      rows = rows.filter(function (r) {
        return r.isOwner || r.id === OWNER_STAFF_DOC_ID;
      });
    } else {
      rows = rows.filter(function (r) {
        return !r.isOwner && r.id !== OWNER_STAFF_DOC_ID;
      });
    }
    if (!rows.length) {
      modalStaffFocusOnce = false;
      sel.innerHTML =
        '<option value="">' +
        escapeHtml(tr("clock.picker.empty")) +
        "</option>";
      try {
        sel.focus();
      } catch (e2) {}
      return;
    }
    var cur = String(loadSession().operationalStaffId || "").trim();
    if (!cur && isOwnerRole()) {
      for (var oi = 0; oi < rows.length; oi++) {
        if (rows[oi].id === OWNER_STAFF_DOC_ID || rows[oi].isOwner) {
          cur = rows[oi].id;
          break;
        }
      }
    }
    var keepStaff = String(sel.value || "").trim();
    var keepRole = roleSel ? String(roleSel.value || "").trim() : "";
    var prefer = keepStaff || cur;
    sel.innerHTML = staffRowsBuildOptionsHtml(rows, prefer, "— Pilih nama —");
    if (prefer && !String(sel.value || "").trim()) {
      sel.value = prefer;
    }
    if (!modalStaffFocusOnce) {
      modalStaffFocusOnce = true;
      if (String(sel.value || "").trim()) {
        try {
          sel.dispatchEvent(new Event("change"));
        } catch (eCh) {}
      }
      try {
        sel.focus();
      } catch (e2) {}
    } else if (keepRole && roleSel) {
      roleSel.value = keepRole;
    }
  }

  function loadStaffIntoSelect() {
    if (unsubModalStaff) {
      unsubModalStaff();
      unsubModalStaff = null;
    }
    modalStaffFocusOnce = false;
    retryWrap.hidden = true;
    ensureStaffCollectionRealtimeSub();
    paintClockInModalStaffSelect();
    unsubModalStaff = subscribeStaffRowsListener(function () {
      if (!backdrop.parentNode) return;
      paintClockInModalStaffSelect();
    });
  }

  btnRetry.onclick = function () {
    stopStaffRowsRealtimeSync();
    loadStaffIntoSelect();
  };

  function cleanup(result) {
    if (unsubCashierSlot) {
      try {
        unsubCashierSlot();
      } catch (eSlot) {}
      unsubCashierSlot = null;
    }
    if (unsubModalStaff) {
      unsubModalStaff();
      unsubModalStaff = null;
    }
    try {
      document.removeEventListener("keydown", onKey);
    } catch (e) {}
    try {
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
    } catch (e2) {}
    try {
      if (typeof onClose === "function") onClose(result);
    } catch (e3) {}
  }

  function onKey(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      cleanup(null);
    }
  }
  document.addEventListener("keydown", onKey);

  backdrop.addEventListener("click", function (e) {
    if (e.target === backdrop) cleanup(null);
  });

  btnCancel.onclick = function () {
    cleanup(null);
  };
  if (btnX) {
    btnX.onclick = function () {
      cleanup(null);
    };
  }

  btnOk.onclick = async function () {
    if (clockInSubmitting) return;
    var v = String(sel.value || "").trim();
    if (!v) {
      window.alert("Sila pilih nama dari senarai.");
      try {
        sel.focus();
      } catch (e) {}
      return;
    }

    var workRole = ownerPicker
      ? "owner"
      : String(roleSel ? roleSel.value || "" : "").trim();
    if (!workRole) {
      if (roleError) roleError.style.display = "block";
      try {
        roleSel.focus();
      } catch (e) {}
      return;
    }

    clockInSubmitting = true;
    btnOk.disabled = true;
    btnOk.textContent = tr("clock.totp.verifying");

    var submitOk = false;
    try {
      var prox;
      if (SKIP_CLOCK_IN_GEO || ownerPicker) {
        prox = { ok: true, coords: null };
      } else if (proximityOk && verifiedCoords) {
        prox = { ok: true, coords: verifiedCoords };
      } else {
        btnOk.textContent = tr("clock.geo.checking");
        prox = await verifyStaffProximity();
      }
      if (!prox.ok) {
        return;
      }

      var enteredTotp = String(totpInput ? totpInput.value || "" : "").replace(/\D/g, "");
      if (selectedStaffRequiresTotp && !/^\d{6}$/.test(enteredTotp)) {
        if (totpError) {
          totpError.textContent = tr("clock.totp.needSixAuth");
          totpError.style.display = "block";
        }
        if (totpInput) totpInput.focus();
        return;
      }

      btnOk.textContent = tr("clock.totp.verifying");
      var coords = SKIP_CLOCK_IN_GEO || ownerPicker ? null : prox.coords || verifiedCoords;
      var callables = await withTimeout(totpCallablesPromise, 8000, null);
      if (!callables || typeof callables.verifyStaffClockIn !== "function") {
        showClockInFormError(tr("clock.picker.verifyFail"));
        return;
      }
      var testingSession = !!(ownerPicker && testingChk && testingChk.checked);
    var result = await withTimeout(
        callables.verifyStaffClockIn(v, enteredTotp, coords, {
          workRole: workRole,
          action: "clock_in",
          testingSession: testingSession
        }),
        15000,
        { verified: false, error: tr("clock.picker.verifyTimeout") }
      );
      if (!result || typeof result !== "object") {
        result = { verified: false, error: tr("clock.picker.verifyFail") };
      }

        var alreadyIn =
          result.alreadyActive ||
          /Sudah clock in/i.test(String(result.error || "")) ||
          /already-exists/i.test(String(result.error || "")) ||
          /ALREADY_EXISTS/i.test(String(result.error || ""));
        if (!result.verified && alreadyIn) {
          var optResume = sel.options[sel.selectedIndex];
          var nameResume = optResume ? String(optResume.text || "").trim() : "";
          submitOk = true;
          cleanup({
            id: v,
            name: nameResume,
            workRole: result.workRole || workRole,
            testingSession: testingSession,
            resume: true
          });
          return;
        }
        if (!result.verified) {
        var proximityCode = SKIP_CLOCK_IN_GEO ? "" : isProximityDeny(result);
        var isCashierTaken = result.errorCode === "cashier_taken" || /[Cc]ashier sudah bertugas/.test(result.error || "");
        var isTotpMismatch = result.errorCode === "totp_mismatch" || /Kod 2FA tidak sepadan|mismatch/i.test(String(result.error || ""));
        if (proximityCode) {
          showClockInGeoBlocked(proximityCode);
        } else if (isCashierTaken && roleOptCashier) {
          roleOptCashier.disabled = true;
          roleOptCashier.textContent = tr("clock.picker.cashierTaken");
          showClockInFormError(result.error || tr("clock.picker.inFail"));
        } else if (/internal|billing|unavailable/i.test(String(result.error || ""))) {
          showClockInFormError(tr("clock.picker.cfDown"));
        } else if (isTotpMismatch && selectedStaffRequiresTotp && totpError) {
          totpError.textContent = result.error || tr("clock.totp.mismatch");
          totpError.style.display = "block";
          if (totpSection) totpSection.style.display = "block";
          if (totpInput) {
            totpInput.value = "";
            totpInput.focus();
          }
        } else {
          showClockInFormError(result.error || tr("clock.picker.inFail"));
        }
        var optFail = sel.options[sel.selectedIndex];
        if (!proximityCode) {
          import("./pos-firestore-hub.js")
            .then(function (hub) {
              return hub.appendPosAudit({
                type: "clockin_totp_failed",
                message: "Kod 2FA salah semasa cuba clock in.",
                meta: { staffId: v, staffName: optFail ? String(optFail.text || "").trim() : "" }
              });
            })
            .catch(function () {});
        }
        return;
      }
      var opt = sel.options[sel.selectedIndex];
      var name = opt ? String(opt.text || "").trim() : "";
      submitOk = true;
      cleanup({
        id: v,
        name: name,
        workRole: result.workRole || workRole,
        testingSession: testingSession
      });
    } catch (err) {
      console.warn("[clock-in] verify error:", err);
      showClockInFormError(tr("clock.picker.verifyFail"));
    } finally {
      if (!submitOk) resetClockInSubmitBtn();
    }
  };

  loadStaffIntoSelect();
  if (!ownerPicker && !SKIP_CLOCK_IN_GEO) {
    btnOk.disabled = true;
    if (totpInput) totpInput.disabled = true;
    verifyStaffProximity().then(function (prox) {
      if (!btnOk.isConnected) return;
      if (totpInput) totpInput.disabled = !prox.ok;
    });
  }
}

var activeShiftDocs = [];
var activeShiftUnsub = null;
var activeShiftListeners = [];
var rosterServerReady = false;

function getActiveCashierSlot() {
  for (var i = 0; i < activeShiftDocs.length; i++) {
    if (String(activeShiftDocs[i].workRole || "").toLowerCase() === "cashier") {
      return activeShiftDocs[i];
    }
  }
  return null;
}

function subscribeActiveShiftDocs(fn) {
  ensureActiveShiftRealtimeSub();
  if (typeof fn === "function") {
    activeShiftListeners.push(fn);
    try {
      fn(activeShiftDocs);
    } catch (e) {}
  }
  return function () {
    activeShiftListeners = activeShiftListeners.filter(function (x) {
      return x !== fn;
    });
  };
}

function syncLocalSessionWithRoster() {
  if (!rosterServerReady) return;
  var s = loadSession();
  if (!s.clockedIn) return;
  var sid = String(s.operationalStaffId || "").trim();
  if (!sid) return;
  var still = activeShiftDocs.some(function (d) {
    return String(d.id || d.staffId || "") === sid;
  });
  if (still) return;
  revokeClockInFromRoster();
}

/** Langganan realtime pos_active_shift (satu kali) — roster siapa sedang bertugas serentak. */
function ensureActiveShiftRealtimeSub() {
  if (activeShiftUnsub) return;
  activeShiftUnsub = onSnapshot(
    collection(db, "pos_active_shift"),
    function (snap) {
      activeShiftDocs = snap.docs.map(function (d) {
        return Object.assign({ id: d.id }, d.data());
      });
      if (!snap.metadata || !snap.metadata.fromCache) rosterServerReady = true;
      syncLocalSessionWithRoster();
      activeShiftListeners.forEach(function (fn) {
        try {
          fn(activeShiftDocs);
        } catch (e1) {}
      });
      renderActiveShiftRoster();
    },
    function (e) {
      console.warn("[roster] pos_active_shift sub error:", e);
    }
  );
}

function ownerForceClockOutStaff(staffId, staffName, workRole, btn) {
  var name = staffName || staffId || "";
  var role = workRole || "";
  if (
    !window.confirm(
      interpolate(tr("clock.roster.forceOutConfirm"), { name: name, role: role })
    )
  ) {
    return;
  }
  var reason = window.prompt(tr("clock.roster.forceReason"), "");
  if (reason == null) return;
  if (btn) btn.disabled = true;

  function run(extra) {
    import("./staff/totp-callables.js")
      .then(function (m) {
        return m.forceStaffClockOut(
          staffId,
          Object.assign({ reason: String(reason || "").trim() || "Owner override" }, extra || {})
        );
      })
      .then(function (result) {
        if (result && result.needsDrawerClose && result.drawer) {
          var d = result.drawer;
          var msg =
            tr("clock.roster.drawerLead") +
            "\n" +
            tr("shift.close.opening") +
            ": RM " +
            Number(d.openingCash || 0).toFixed(2) +
            "\n" +
            tr("shift.close.expectedFull") +
            ": RM " +
            Number(d.expectedCash || 0).toFixed(2) +
            "\n" +
            tr("clock.roster.enterActual");
          var actualStr = window.prompt(msg, "");
          if (actualStr == null) {
            if (btn) btn.disabled = false;
            return;
          }
          var actual = parseFloat(actualStr);
          if (!isFinite(actual)) {
            window.alert(tr("shift.alert.needActual"));
            if (btn) btn.disabled = false;
            return;
          }
          return run({ closeDrawer: true, actualCash: actual });
        }
        if (!result.ok && !result.verified) {
          window.alert(result.error || tr("clock.roster.clockOutFail"));
          if (btn) btn.disabled = false;
        }
      })
      .catch(function (e) {
        console.warn("[roster] owner force clock-out:", e);
        window.alert(tr("clock.roster.clockOutFailRetry"));
        if (btn) btn.disabled = false;
      });
  }
  run({});
}

function renderActiveShiftRoster() {
  var el = document.getElementById("kb-active-roster");
  if (!el) return;
  var rows = activeShiftDocs.slice();
  var ownerCanManage = isOwnerRole() || isElevatedRole();
  if (!rows.length) {
    if (!ownerCanManage) {
      el.hidden = true;
      el.innerHTML = "";
      return;
    }
    el.hidden = false;
    el.innerHTML = ownerCanManage
      ? '<p class="kb-active-roster__title">' +
        escapeHtml(interpolate(tr("clock.roster.title"), { count: 0 })) +
        '</p><p class="kb-active-roster__empty">' +
        escapeHtml(tr("clock.roster.empty")) +
        "</p>"
      : "";
    return;
  }
  el.hidden = false;
  el.innerHTML =
    '<p class="kb-active-roster__title">' +
    escapeHtml(interpolate(tr("clock.roster.title"), { count: rows.length })) +
    "</p>" +
    (ownerCanManage
      ? '<p class="kb-active-roster__hint">' +
        escapeHtml(tr("clock.roster.ownerHint")) +
        "</p>"
      : "") +
    rows
      .map(function (x) {
        var isCashier = String(x.workRole || "") === "cashier";
        var sid = x.staffId || x.id;
        var actionHtml = ownerCanManage
          ? '<button type="button" class="btn btn--ghost btn--sm js-roster-force-out" data-staff-id="' +
            escapeHtml(sid) +
            '" data-staff-name="' +
            escapeHtml(x.staffName || "") +
            '" data-work-role="' +
            escapeHtml(x.workRole || "") +
            '">' +
            escapeHtml(tr("clock.roster.forceOut")) +
            "</button>"
          : isCashier
            ? '<span class="kb-active-roster__muted">' +
              escapeHtml(tr("clock.roster.clockOutHere")) +
              "</span>"
            : '<button type="button" class="btn btn--ghost btn--sm js-roster-clockout" data-staff-id="' +
              escapeHtml(sid) +
              '" data-staff-name="' +
              escapeHtml(x.staffName || "") +
              '">Clock out</button>';
        var roleCls =
          "ops-role ops-role--" +
          (String(x.workRole || "").toLowerCase() === "kitchen"
            ? "kitchen"
            : String(x.workRole || "").toLowerCase() === "owner"
              ? "owner"
              : "cashier");
        return (
          '<div class="kb-active-roster__row">' +
          '<span class="kb-active-roster__who">' +
          escapeHtml(x.staffName || x.staffId || "") +
          ' <span class="' +
          roleCls +
          '">' +
          escapeHtml(x.workRole || "") +
          "</span></span>" +
          actionHtml +
          "</div>"
        );
      })
      .join("");

  el.querySelectorAll(".js-roster-force-out").forEach(function (btn) {
    btn.onclick = function () {
      ownerForceClockOutStaff(
        btn.getAttribute("data-staff-id"),
        btn.getAttribute("data-staff-name"),
        btn.getAttribute("data-work-role"),
        btn
      );
    };
  });

  el.querySelectorAll(".js-roster-clockout").forEach(function (btn) {
    btn.onclick = function () {
      var staffId = btn.getAttribute("data-staff-id");
      var staffName = btn.getAttribute("data-staff-name");
      function doRosterClockOut(code) {
        btn.disabled = true;
        getCurrentCoords()
          .then(function (coords) {
            return import("./staff/totp-callables.js").then(function (m) {
              return m.verifyStaffClockIn(staffId, code || "", coords, { action: "clock_out" });
            });
          })
          .then(function (result) {
            if (!result.verified) {
              window.alert(result.error || tr("clock.roster.clockOutFail"));
              btn.disabled = false;
              return;
            }
          })
          .catch(function (e) {
            console.warn("[roster] clock-out error:", e);
            window.alert(tr("clock.roster.clockOutFailRetry"));
            btn.disabled = false;
          });
      }
      staffTotpEnabledCached(staffId).then(function (enabled) {
        if (!enabled) {
          doRosterClockOut("");
          return;
        }
        showClockOutTotpModal(staffId, staffName, function () {});
      });
    };
  });
}

function renderClockPanel() {
  hideEmbed();
  var snap = getSnapshot();
  var s = snap.session;
  var hub = snap.hub;
  var eff = getEffectiveOperationalStatus();
  activeShellView = { kind: "clock" };
  if (panelTitle) panelTitle.textContent = tr("panel.clockInOut");
  if (topbarTitle) topbarTitle.textContent = tr("topbar.clockPanel");
  if (contentLead) {
    contentLead.innerHTML = "";
    contentLead.hidden = true;
  }
  if (panelBody) {
    var shiftOpen = !!(hub.shift && hub.shift.isOpen);
    var clockInBtn =
      '<button type="button" class="btn btn--primary" id="kb-clock-in">Clock in</button>';

    panelBody.innerHTML =
      '<div class="ops-stack">' +
      '<section class="ops-card">' +
      '<p class="ops-card__title">' +
      escapeHtml(tr("clock.card.status")) +
      "</p>" +
      clockFactsHtml(s, hub) +
      '<div class="kb-clock-summary">' +
      (s.clockedIn
        ? '<p class="kb-clock-duty">' +
          "<span>" +
          escapeHtml(tr("clock.started")) +
          " " +
          escapeHtml(formatClockedInHuman(s.clockedInAt)) +
          "</span></p>" +
          (shiftOpen
            ? '<button type="button" class="btn btn--ghost" id="kb-clock-out" disabled aria-disabled="true" title="' +
              escapeHtml(tr("clock.closeDrawerFirstTitle")) +
              '">' +
              "Clock out" +
              "</button>" +
              '<p class="kb-clock-out-blocked">' +
              tr("clock.drawerOpenBlockOut") +
              "</p>"
            : '<button type="button" class="btn btn--ghost" id="kb-clock-out">Clock out</button>')
        : clockInBtn) +
      '<div class="kb-clock-status">' +
      "<p>" +
      operationalStatusHumanLine(eff) +
      "</p>" +
      "<p>" +
      shiftPosHumanLine(hub, eff) +
      "</p>" +
      "</div>" +
      "</div>" +
      "</section>" +
      getShiftPanelHtml() +
      '<section class="ops-card kb-active-roster" id="kb-active-roster"></section>' +
      "</div>";

    ensureActiveShiftRealtimeSub();
    renderActiveShiftRoster();
    renderShiftPanelUI(hub);
    var totpFact = document.getElementById("kb-clock-fact-totp");
    if (totpFact && s.clockedIn && s.operationalStaffId) {
      staffTotpEnabledCached(s.operationalStaffId).then(function (on) {
        if (!totpFact.isConnected) return;
        totpFact.textContent = on ? tr("clock.chip.totpOn") : tr("clock.chip.totpOff");
        totpFact.className = "ops-chip ops-chip--" + (on ? "ok" : "muted");
      });
    }

    var ci = document.getElementById("kb-clock-in");
    if (ci) {
      ci.onclick = function () {
        function afterClockInOk(picked) {
          renderClockPanel();
          renderStatusBar();
          applyPosLinkLocks();
          var wr = picked && picked.workRole ? String(picked.workRole).toLowerCase() : "";
          if (wr === "kitchen") return;
          setTimeout(function () {
            var openBtn = document.getElementById("btn-shift-open");
            if (openBtn && !openBtn.hidden && !openBtn.disabled) {
              openBtn.click();
            }
          }, 50);
        }
        if (requiresOperationalStaffPicker()) {
          showClockInStaffPickerModal(function (picked) {
            if (!picked || !picked.id) return;
            setPosOperationalStaff(picked.id, picked.name, picked.workRole);
            setSession({ ownerTestingSession: !!picked.testingSession });
            var r = clockIn();
            if (!r.ok) {
              if (picked.resume || /Sudah clock in/i.test(String(r.error || ""))) {
                afterClockInOk(picked);
                return;
              }
              window.alert(r.error);
              return;
            }
            afterClockInOk(picked);
          });
          return;
        }
        var r = clockIn();
        if (!r.ok) {
          window.alert(r.error);
          return;
        }
        afterClockInOk(null);
      };
    }
    var co = document.getElementById("kb-clock-out");
    if (co && !co.disabled) {
      co.onclick = function () {
        function doClockOut() {
          var r = clockOut();
          if (!r.ok) {
            window.alert(r.error);
            return;
          }
          renderClockPanel();
          renderStatusBar();
          applyPosLinkLocks();
        }
        // Lepaskan slot roster pos_active_shift (kalau ada) — best-effort, tak sekat clock-out
        // tempatan kalau gagal (fail-open sama macam tingkah laku PIN lama).
        function releaseShiftSlotThenClockOut(staffId, testingSession) {
          getCurrentCoords()
            .then(function (coords) {
              return import("./staff/totp-callables.js").then(function (m) {
                return m.verifyStaffClockIn(staffId, "", coords, {
                  action: "clock_out",
                  testingSession: !!testingSession
                });
              });
            })
            .catch(function (e) {
              console.warn("[clock-out] release shift slot error:", e);
            })
            .finally(function () {
              doClockOut();
            });
        }
        var sess = loadSession();
        var staffId = String(sess.operationalStaffId || "").trim();
        var testingSession = !!sess.ownerTestingSession;
        if (!staffId) {
          doClockOut();
          return;
        }
        staffTotpEnabledCached(staffId).then(function (enabled) {
          if (!enabled) {
            releaseShiftSlotThenClockOut(staffId, testingSession);
            return;
          }
          showClockOutTotpModal(
            staffId,
            sess.operationalStaffName || "",
            doClockOut,
            null,
            { testingSession: testingSession }
          );
        });
      };
    }
    renderShiftPanelUI(hub);
  }
  setActiveNav(navPos, ".js-nav-clock");
  persistShell({ r: "pos-clock", module: "pos" });
}

function wireNavClicks(navRoot) {
  if (!navRoot) return;
  navRoot.addEventListener("click", function (e) {
    var t = e.target.closest(".sidebar__link");
    if (!t || !navRoot.contains(t)) return;

    if (t.classList.contains("js-nav-clock")) {
      e.preventDefault();
      navRoot.querySelectorAll(".sidebar__link").forEach(function (a) {
        a.classList.remove("is-active");
        a.removeAttribute("aria-current");
      });
      t.classList.add("is-active");
      t.setAttribute("aria-current", "page");
      renderClockPanel();
      return;
    }

    if (navRoot.classList.contains("js-nav-bo") && t.classList.contains("js-bo-dashboard")) {
      if (!canAccessBackOfficeModule()) {
        e.preventDefault();
        window.alert("Akses pejabat belakang tidak dibenarkan untuk peranan ini.");
        return;
      }
      e.preventDefault();
      navRoot.querySelectorAll(".sidebar__link").forEach(function (a) {
        a.classList.remove("is-active");
        a.removeAttribute("aria-current");
      });
      t.classList.add("is-active");
      t.setAttribute("aria-current", "page");
      showBoDashboard();
      return;
    }

    if (navRoot.classList.contains("js-nav-bo") && t.classList.contains("js-bo-staff")) {
      if (!canAccessBackOfficeModule()) {
        e.preventDefault();
        window.alert("Akses pejabat belakang tidak dibenarkan untuk peranan ini.");
        return;
      }
      e.preventDefault();
      navRoot.querySelectorAll(".sidebar__link").forEach(function (a) {
        a.classList.remove("is-active");
        a.removeAttribute("aria-current");
      });
      t.classList.add("is-active");
      t.setAttribute("aria-current", "page");
      showBoStaff();
      return;
    }

    if (navRoot.classList.contains("js-nav-bo") && t.classList.contains("js-bo-wastage")) {
      if (!canAccessBackOfficeModule()) {
        e.preventDefault();
        window.alert("Akses pejabat belakang tidak dibenarkan untuk peranan ini.");
        return;
      }
      e.preventDefault();
      navRoot.querySelectorAll(".sidebar__link").forEach(function (a) {
        a.classList.remove("is-active");
        a.removeAttribute("aria-current");
      });
      t.classList.add("is-active");
      t.setAttribute("aria-current", "page");
      showBoWastage();
      return;
    }

    if (navRoot.classList.contains("js-nav-bo") && t.classList.contains("js-bo-calc")) {
      if (!canAccessBackOfficeModule()) {
        e.preventDefault();
        window.alert("Akses pejabat belakang tidak dibenarkan untuk peranan ini.");
        return;
      }
      e.preventDefault();
      navRoot.querySelectorAll(".sidebar__link").forEach(function (a) {
        a.classList.remove("is-active");
        a.removeAttribute("aria-current");
      });
      t.classList.add("is-active");
      t.setAttribute("aria-current", "page");
      showBoCalculator(
        t.getAttribute("data-calc-tab") || "ingredients",
        t.getAttribute("data-topbar"),
        t.getAttribute("data-bo-calc-copy")
      );
      return;
    }

    if (navRoot.classList.contains("js-nav-bo") && t.classList.contains("js-bo-monthly-reports")) {
      if (!canAccessBackOfficeModule()) {
        e.preventDefault();
        window.alert("Akses pejabat belakang tidak dibenarkan untuk peranan ini.");
        return;
      }
      e.preventDefault();
      navRoot.querySelectorAll(".sidebar__link").forEach(function (a) {
        a.classList.remove("is-active");
        a.removeAttribute("aria-current");
      });
      t.classList.add("is-active");
      t.setAttribute("aria-current", "page");
      showBoMonthlyReports();
      return;
    }

    if (navRoot.classList.contains("js-nav-bo") && t.classList.contains("js-bo-settings")) {
      if (!canAccessBackOfficeModule()) {
        e.preventDefault();
        window.alert("Akses pejabat belakang tidak dibenarkan untuk peranan ini.");
        return;
      }
      e.preventDefault();
      navRoot.querySelectorAll(".sidebar__link").forEach(function (a) {
        a.classList.remove("is-active");
        a.removeAttribute("aria-current");
      });
      t.classList.add("is-active");
      t.setAttribute("aria-current", "page");
      showBoSettings();
      return;
    }

    if (navRoot.classList.contains("js-nav-pos") && t.hasAttribute("data-pos-embed")) {
      if (tryConsumePosEmbedClick(t, navRoot, e)) return;
      e.preventDefault();
      navRoot.querySelectorAll(".sidebar__link").forEach(function (a) {
        a.classList.remove("is-active");
        a.removeAttribute("aria-current");
      });
      t.classList.add("is-active");
      t.setAttribute("aria-current", "page");
      showPosEmbedPage(
        t.getAttribute("data-pos-embed"),
        t.getAttribute("data-pos-title") || "TAB KAUNTER",
        t.getAttribute("data-pos-lead") || "",
        t.getAttribute("data-pos-topbar")
      );
      return;
    }

    var href = t.getAttribute("href");
    if (href && href !== "#" && href.indexOf("#") !== 0) {
      return;
    }
    e.preventDefault();
    hideEmbed();
    navRoot.querySelectorAll(".sidebar__link").forEach(function (a) {
      a.classList.remove("is-active");
      a.removeAttribute("aria-current");
    });
    t.classList.add("is-active");
    t.setAttribute("aria-current", "page");
    if (t.hasAttribute("data-kb-restore")) {
      persistShell({
        r: "generic",
        module: document.body.getAttribute("data-module") === "bo" ? "bo" : "pos",
        restoreKey: String(t.getAttribute("data-kb-restore") || "").trim()
      });
    } else if (t.hasAttribute("data-bo-link")) {
      persistShell({ r: "bo-home", module: "bo" });
    } else if (navRoot.classList.contains("js-nav-bo")) {
      persistShell({ r: "bo-home", module: "bo" });
    } else {
      persistShell({ r: "pos-home", module: "pos" });
    }
    var labelEl = t.querySelector("span");
    var navLabel = labelEl ? labelEl.textContent.trim() : "";
    if (navLabel && panelTitle && panelBody) {
      if (navRoot.classList.contains("js-nav-pos") || navRoot.classList.contains("js-nav-bo")) {
        panelTitle.textContent = navLabel;
        panelBody.textContent =
          "Ruangan demo untuk “" + navLabel + "”. Sambungkan ke data sebenar kemudian.";
      }
    }
  });
}

function openClockPanelForLogout() {
  try {
    if (shellApplyModule) shellApplyModule("pos");
    persistShellForce({ r: "pos-clock", module: "pos" });
    var clockNav = document.querySelector(".js-nav-pos .js-nav-clock");
    if (clockNav) clockNav.click();
    else if (typeof renderClockPanel === "function") renderClockPanel();
  } catch (e) {}
}

function wireLogout() {
  var out = document.querySelector(".sidebar__out");
  if (!out) return;
  out.addEventListener("click", async function (e) {
    e.preventDefault();
    var blockReason = await assertLogoutReady();
    if (blockReason) {
      window.alert(blockReason);
      openClockPanelForLogout();
      return;
    }
    try {
      await signOut(auth);
    } catch (err) {
      console.warn(err);
    }
    logoutSession();
    destroyEmbedFrames(null);
    try {
      sessionStorage.removeItem(RESTORE_KEY);
      localStorage.removeItem(RESTORE_KEY_LS);
      sessionStorage.removeItem(SETTINGS_TAB_SS);
    } catch (e) {}
    window.location.href = LOGIN_PAGE_HREF;
  });
  out.setAttribute("href", "#");
}

shellApplyModule = applyModule;

if (trigger && layer) {
  enforceStaffStaysOnCounter();
  var stBoot = readRestoreState();
  var initialModule = isElevatedRole() ? getStoredModule() : "pos";
  if (stBoot && stBoot.module === "bo" && canAccessBackOfficeModule()) {
    initialModule = "bo";
  } else if (stBoot && stBoot.module === "pos") {
    initialModule = "pos";
  }
  if (initialModule === "bo" && !canAccessBackOfficeModule()) initialModule = "pos";
  if (!isElevatedRole()) initialModule = "pos";
  applyModule(initialModule);
  renderStatusBar();
  applyPosWorkspaceChrome();
  applyPosLinkLocks();
  wireLogout();

  trigger.addEventListener("click", function () {
    if (!isElevatedRole()) {
      return;
    }
    if (layer.hidden) openLayer();
    else closeLayer();
  });

  layer.querySelectorAll(".js-module-close").forEach(function (el) {
    el.addEventListener("click", closeLayer);
  });

  layer.querySelectorAll(".js-set-module").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var mod = btn.getAttribute("data-module");
      if (mod === "bo" && !canAccessBackOfficeModule()) {
        window.alert("Back Office hanya untuk pemilik / pentadbir.");
        return;
      }
      applyModule(mod);
      closeLayer();
    });
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !layer.hidden) {
      e.preventDefault();
      closeLayer();
    }
  });
}

wireNavClicks(navPos);
wireNavClicks(navBo);
wireContentEmbedChildMessages();
wireContentEmbedFit();

// Teks statik disapu oleh applyI18n dalam setLocale; ini menangani teks yang
// dijana JS (tag modul, tajuk topbar, lead, kandungan lalai). Render pertama tidak
// perlu dipanggil di sini — applyModule() di atas sudah membaca bahasa tersimpan.
onLocaleChange(applyShellText);

var contentDefaultEl = document.getElementById("content-default");
if (contentDefaultEl) {
  bindShiftPanelDelegation(contentDefaultEl);
}
bindShiftModalRoot();
ensureShiftPanelHubSync();
function refreshClockPanelIfVisible() {
  var clockNav = document.querySelector(".js-nav-pos .js-nav-clock");
  if (clockNav && clockNav.classList.contains("is-active")) {
    renderClockPanel();
  }
}

subscribePosHub(function () {
  renderStatusBar();
  applyPosLinkLocks();
  enforceLockedPosEmbedsClosed();
  refreshClockPanelIfVisible();
});
subscribeRbac(function () {
  renderStatusBar();
  applyPosWorkspaceChrome();
  applyPosLinkLocks();
  enforceLockedPosEmbedsClosed();
  refreshClockPanelIfVisible();
});
ensureActiveShiftRealtimeSub();

if (!shellPagehideBound) {
  shellPagehideBound = true;
  window.addEventListener("pagehide", function () {
    captureAndPersistShellRouteFromDom();
    stopStaffRowsRealtimeSync();
  });
}
}

async function bootMainMenu() {
  var forceLoaderDown = window.setTimeout(function () {
    console.warn("[boot] Paksa tutup loader (keselamatan 8s).");
    finishAppLoader();
  }, 8000);
  var safetyDismiss = window.setTimeout(function () {
    if (document.body && document.body.classList.contains("kb-app-boot")) {
      console.warn("[boot] Loader tamat masa — semak rangkaian / Firebase.");
      shellBootSuppressPersist = false;
      finishAppLoader();
    }
  }, 15000);
  shellBootSuppressPersist = true;
  try {
    var ok = false;
    try {
      ok = await ensureSessionFromFirebase();
    } catch (sessErr) {
      console.error("[boot] ensureSession", sessErr);
      ok = false;
    }
    if (!ok) {
      return;
    }
    try {
      await restoreClockInFromRoster();
    } catch (rosterErr) {
      console.warn("[boot] restoreClockInFromRoster", rosterErr);
    }
    try {
      runMainMenuShell();
    } catch (shellErr) {
      console.error("[boot] runMainMenuShell", shellErr);
    }
    finishAppLoader();
    sanitizeRestoreForRbac();
    try {
      await restoreShellRouteFromStorage();
    } catch (reErr) {
      console.warn("[boot] restore", reErr);
    }
    await waitForEmbeddedContentIfAny();
    await new Promise(function (resolve) {
      requestAnimationFrame(function () {
        requestAnimationFrame(resolve);
      });
    });
    captureAndPersistShellRouteFromDom();
  } catch (e) {
    console.error("[boot]", e);
  } finally {
    try {
      window.clearTimeout(forceLoaderDown);
    } catch (e0) {}
    try {
      window.clearTimeout(safetyDismiss);
    } catch (e2) {}
    shellBootSuppressPersist = false;
    finishAppLoader();
    warmEmbedAssets();
  }
}

function warmEmbedAssets() {
  var urls = [
    "pos-order.html",
    "pos-receipts.html",
    "pos-order-board.html",
    "dashboard.html",
    "pos-cost-calculator.html",
    "staff-dashboard.html",
    "bo-wastage.html",
    "bo-settings.html",
    "bo-monthly-reports.html"
  ];
  function run() {
    urls.forEach(function (u) {
      try {
        fetch(u, { credentials: "same-origin" }).catch(function () {});
      } catch (e) {}
    });
  }
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(run, { timeout: 2500 });
  } else {
    window.setTimeout(run, 500);
  }
}

bootMainMenu();

// ==========================================
// TABLET — rotation, network status
// ==========================================

// Handle orientation change untuk tablet
window.addEventListener("orientationchange", function () {
  setTimeout(function () {
    window.scrollTo(0, 0);
    var mainEl = document.querySelector(".app-main");
    if (mainEl) {
      mainEl.style.height = window.innerHeight + "px";
    }
  }, 300);
});

// Network status
window.addEventListener("online", function () {
  var banner = document.getElementById("offline-banner");
  if (banner) banner.remove();
});

window.addEventListener("offline", function () {
  if (document.getElementById("offline-banner")) return;
  var banner = document.createElement("div");
  banner.id = "offline-banner";
  banner.style.cssText =
    "position:fixed;top:0;left:0;right:0;z-index:9999;" +
    "background:#854F0B;color:white;text-align:center;" +
    "padding:10px;font-size:14px;font-weight:500";
  banner.textContent = "Tiada sambungan internet. Data mungkin tidak terkini.";
  document.body.prepend(banner);
});
