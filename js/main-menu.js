import { auth, signOut, db, collection, query, limit, where, onSnapshot, getDocs, doc, getDoc } from "./firebase/init.js";

var LOGIN_PAGE_HREF = new URL("../html/login.html", import.meta.url).href;
import { waitForAuthUser, getPosUserRbacPayload } from "./pos-firebase-auth-bridge.js";
import { COL_STAFF } from "./firebase/collections.js";
import { OWNER_STAFF_DOC_ID } from "./staff/staff-mappers.js";
import { subscribePosHub } from "./pos-operations-hub.js";
import {
  subscribeRbac,
  getSnapshot,
  ROLES,
  isElevatedRole,
  canBypassStaffRestrictions,
  canAccessOperationalModules,
  canUseFinancialControls,
  canAccessBackOfficeModule,
  clockIn,
  clockOut,
  logoutSession,
  assertLogoutReady,
  loginSession,
  staffLockMessage,
  getEffectiveOperationalStatus,
  OPERATIONAL_STATUS,
  isStaffRole,
  requiresOperationalStaffPicker,
  loadSession,
  setPosOperationalStaff
} from "./pos-rbac-session.js";
import {
  getShiftPanelHtml,
  renderShiftPanelUI,
  ensureShiftPanelHubSync,
  bindShiftPanelDelegation,
  bindShiftModalRoot
} from "./pos-shift-panel.js";

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
  try {
    var st = readRestoreState();
    if (st && st.r === "bo-ai-assistant") {
      return "database";
    }
    if (st && st.r === "bo-settings" && (st.settingsTab === "database" || st.settingsTab === "staff")) {
      return st.settingsTab;
    }
  } catch (e1) {}
  try {
    var saved = sessionStorage.getItem(SETTINGS_TAB_SS);
    if (saved === "database" || saved === "staff") return saved;
  } catch (e0) {}
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
    if (a.getAttribute("data-rbac-lock") === "clocked" && !canAccessOperationalModules()) {
      persistShellForce({ r: "pos-clock", module: "pos" });
      return;
    }
    if (a.getAttribute("data-rbac-lock") === "shift-open" && !canUseFinancialControls()) {
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
    if (a.getAttribute("data-rbac-lock") === "clocked" && !canAccessOperationalModules()) {
      persistShellForce({ r: "pos-clock", module: "pos" });
      safeClick(".js-nav-pos .js-nav-clock");
      return;
    }
    if (a.getAttribute("data-rbac-lock") === "shift-open" && !canUseFinancialControls()) {
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
      sessionStorage.setItem(SETTINGS_TAB_SS, "database");
    } catch (eAi) {}
    persistShellForce({ v: 1, r: "bo-settings", module: "bo", settingsTab: "database" });
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
  var iframe = document.getElementById("content-embed");
  if (!iframe) return Promise.resolve();
  var src = String(iframe.getAttribute("src") || "").trim();
  if (!src || src === "about:blank") return Promise.resolve();
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
    var t = window.setTimeout(fin, 4500);
    function onLoad() {
      window.clearTimeout(t);
      fin();
    }
    function onErr() {
      window.clearTimeout(t);
      fin();
    }
    iframe.addEventListener("load", onLoad, { once: true });
    iframe.addEventListener("error", onErr, { once: true });
    try {
      if (iframe.contentDocument && iframe.contentDocument.readyState === "complete") {
        window.clearTimeout(t);
        fin();
      }
    } catch (ignored) {}
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
    var need = true;
    try {
      var raw = localStorage.getItem("kb_pos_rbac_session_v1");
      if (raw) {
        var o = JSON.parse(raw);
        if (o && String(o.userId) === String(payload.userId)) need = false;
      }
    } catch (e2) {}
    if (need) {
      loginSession(payload);
    }
    return true;
  } catch (e) {
    console.error("[boot] ensureSessionFromFirebase", e);
    try {
      var cu = auth && auth.currentUser;
      if (cu) {
        loginSession({
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

var copy = {
  pos: {
    tag: "Point Of Sale",
    topbar: "Laman utama — jualan",
    lead: "<strong>TAB KAUNTER</strong> — kaunter. Menu kiri untuk operasi harian.",
    panelTitle: "Ringkasan giliran kerja",
    panelBody: "Contoh: jualan hari ini, pesanan aktif, resit. Sambung data kemudian."
  },
  bo: {
    tag: "Back Office",
    topbar: "Laman utama — pentadbiran",
    lead: "<strong>TAB KAUNTER</strong> — pejabat belakang. Menu kiri: laporan, produk &amp; kakitangan, tetapan.",
    panelTitle: "Ringkasan perniagaan",
    panelBody: "Contoh: carta jualan, stok rendah. Inventori: Bahan mentah / Produk & kos."
  }
};

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

function resetContentEmbedSizing() {
  var iframe = document.getElementById("content-embed");
  if (!iframe) return;
  iframe.classList.remove("content__embed--intrinsic");
  iframe.style.height = "";
}

function hideEmbed() {
  var wrap = document.getElementById("content-embed-wrap");
  var iframe = document.getElementById("content-embed");
  var def = document.getElementById("content-default");
  if (!wrap || !def) return;
  wrap.hidden = true;
  def.hidden = false;
  if (iframe) {
    resetContentEmbedSizing();
    iframe.src = "about:blank";
    iframe.removeAttribute("title");
  }
  var m = body.getAttribute("data-module") === "bo" ? "bo" : "pos";
  var c = copy[m];
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
  var wrap = document.getElementById("content-embed-wrap");
  var iframe = document.getElementById("content-embed");
  var def = document.getElementById("content-default");
  if (!wrap || !iframe || !def) return;
  resetContentEmbedSizing();
  var page =
    tab === "modifiers"
      ? copyKind === "catalog"
        ? "packages"
        : "modifiers"
      : "ingredients";
  def.hidden = true;
  wrap.hidden = false;
  iframe.src = "pos-cost-calculator.html#" + page;
  iframe.title =
    copyKind === "catalog" ? "Menu produk — TAB KAUNTER" : "Kalkulator kos — TAB KAUNTER";
  if (topbarTitle) {
    topbarTitle.textContent =
      topbarOverride ||
      (page === "packages"
        ? "Menu produk"
        : page === "modifiers"
          ? "Produk & kos"
          : "Bahan mentah");
  }
  if (copyKind === "catalog") {
    setTopbarEmbedLead(
      "<strong>Produk</strong> — urus pakej sahaja. Item tunggal &amp; kos: <em>Inventori → Produk &amp; kos</em>."
    );
  } else if (tab === "modifiers") {
    setTopbarEmbedLead(
      "<strong>Produk</strong> — resipi &amp; harga. Pakej urus di <strong>Menu Produk</strong>."
    );
  } else {
    setTopbarEmbedLead(
      "Isi borang <strong>Tambah bahan</strong>, simpan, kemudian urus stok melalui <strong>Tambah belian</strong>."
    );
  }
  if (panelTitle) panelTitle.textContent = "";
  if (panelBody) panelBody.textContent = "";
  persistShell({
    r: "bo-calc",
    module: "bo",
    calcTab: tab || "ingredients",
    calcCopy: copyKind || "",
    calcTopbar: topbarOverride || ""
  });
}

function showBoStaff() {
  var wrap = document.getElementById("content-embed-wrap");
  var iframe = document.getElementById("content-embed");
  var def = document.getElementById("content-default");
  if (!wrap || !iframe || !def) return;
  resetContentEmbedSizing();
  def.hidden = true;
  wrap.hidden = false;
  iframe.src = "staff-dashboard.html";
  iframe.title = "Kakitangan — TAB KAUNTER";
  if (topbarTitle) topbarTitle.textContent = "Kakitangan";
  setTopbarEmbedLead(
    "<strong>Pemantauan</strong> — clock in/out, drawer tunai (audit POS), log aktiviti."
  );
  if (panelTitle) panelTitle.textContent = "";
  if (panelBody) panelBody.textContent = "";
  persistShell({ r: "bo-staff", module: "bo" });
}

function showBoSettings() {
  var wrap = document.getElementById("content-embed-wrap");
  var iframe = document.getElementById("content-embed");
  var def = document.getElementById("content-default");
  if (!wrap || !iframe || !def) return;
  resetContentEmbedSizing();
  def.hidden = true;
  wrap.hidden = false;
  var tab = readBoSettingsSubTab();
  iframe.src = "bo-settings.html#" + tab;
  iframe.title = "Tetapan — TAB KAUNTER";
  if (topbarTitle) topbarTitle.textContent = tab === "database" ? "Pangkalan data" : "Kakitangan";
  setTopbarEmbedLead(
    tab === "database"
      ? "<strong>Pangkalan data</strong> — maklumat rujukan untuk Pembantu AI."
      : "<strong>Kakitangan</strong> — sunting rekod staf operasi."
  );
  if (panelTitle) panelTitle.textContent = "";
  if (panelBody) panelBody.textContent = "";
  persistShell({ r: "bo-settings", module: "bo", settingsTab: tab });
}

function wireContentEmbedChildMessages() {
  window.addEventListener("message", function (ev) {
    try {
      var embed = document.getElementById("content-embed");
      if (!embed || ev.source !== embed.contentWindow) return;
      var d = ev.data;
      if (!d || typeof d !== "object") return;

      if (d.type === "fyp-bo-settings-tab") {
        var tab = d.tab === "database" ? "database" : "staff";
        try {
          sessionStorage.setItem(SETTINGS_TAB_SS, tab);
        } catch (e1) {}
        if (topbarTitle) {
          topbarTitle.textContent = tab === "database" ? "Pangkalan data" : "Kakitangan";
        }
        setTopbarEmbedLead(
          tab === "database"
            ? "<strong>Pangkalan data</strong> — maklumat rujukan untuk Pembantu AI."
            : "<strong>Kakitangan</strong> — sunting rekod staf operasi."
        );
        persistShellForce({ v: 1, r: "bo-settings", module: "bo", settingsTab: tab });
        return;
      }

      if (d.type === "fyp-bo-embed-height") {
        var h = +d.height;
        if (!h || h < 240) return;
        embed.classList.add("content__embed--intrinsic");
        embed.style.height = Math.ceil(h + 8) + "px";
      }
    } catch (e) {}
  });
}

function showBoMonthlyReports() {
  var wrap = document.getElementById("content-embed-wrap");
  var iframe = document.getElementById("content-embed");
  var def = document.getElementById("content-default");
  if (!wrap || !iframe || !def) return;
  resetContentEmbedSizing();
  def.hidden = true;
  wrap.hidden = false;
  iframe.src = "bo-monthly-reports.html?v=" + Date.now();
  iframe.title = "Laporan penuh — TAB KAUNTER";
  if (topbarTitle) topbarTitle.textContent = "Laporan penuh";
  setTopbarEmbedLead(
    '<strong>Paparan</strong> — mengikut <strong>tahun &amp; bulan</strong> kalendar.'
  );
  if (panelTitle) panelTitle.textContent = "";
  if (panelBody) panelBody.textContent = "";
  persistShell({ r: "bo-monthly-reports", module: "bo" });
}

function showBoDashboard() {
  var wrap = document.getElementById("content-embed-wrap");
  var iframe = document.getElementById("content-embed");
  var def = document.getElementById("content-default");
  if (!wrap || !iframe || !def) return;
  resetContentEmbedSizing();
  def.hidden = true;
  wrap.hidden = false;
  iframe.src = "dashboard.html";
  iframe.title = "Papan pemuka — TAB KAUNTER";
  if (topbarTitle) topbarTitle.textContent = "Papan pemuka";
  setTopbarEmbedLead(
    "<strong>Ringkasan pemilik</strong> — KPI, pesanan terkini, kakitangan &amp; drawer."
  );
  if (panelTitle) panelTitle.textContent = "";
  if (panelBody) panelBody.textContent = "";
  persistShell({ r: "bo-dashboard", module: "bo" });
}

function showPosEmbedPage(file, iframeTitle, leadHtml, topbarText) {
  var wrap = document.getElementById("content-embed-wrap");
  var iframe = document.getElementById("content-embed");
  var def = document.getElementById("content-default");
  if (!wrap || !iframe || !def) return;
  resetContentEmbedSizing();
  def.hidden = true;
  wrap.hidden = false;
  iframe.src = file;
  iframe.title = iframeTitle || "TAB KAUNTER";
  if (topbarTitle) topbarTitle.textContent = topbarText || iframeTitle || "Point Of Sale";
  setTopbarEmbedLead(leadHtml || "");
  if (panelTitle) panelTitle.textContent = "";
  if (panelBody) panelBody.textContent = "";
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
  hideEmbed();
  body.setAttribute("data-module", m);
  setStoredModule(m);

  var c = copy[m];
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
    } else {
      navPos.hidden = true;
      navPos.classList.add("is-hidden");
      navBo.hidden = false;
      navBo.classList.remove("is-hidden");
      setActiveNav(navBo, ".js-bo-dashboard");
      if (canAccessBackOfficeModule()) {
        showBoDashboard();
      }
    }
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
  if (code === "auth/no-user") return "Sesi tidak ditemui — sila log masuk semula.";
  if (code === "permission-denied")
    return "Akses dinafikan — semak Firestore rules untuk koleksi staff dan akaun anda.";
  if (code === "unavailable" || code === "deadline-exceeded")
    return "Rangkaian terganggu — cuba semula.";
  return "Gagal memuat senarai.";
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
    return new Date(iso).toLocaleString("ms-MY", {
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

/** Ayat mudah difahami untuk status operasi (bukan kod teknikal) */
function operationalStatusHumanLine(st) {
  if (st === OPERATIONAL_STATUS.NOT_CLOCKED_IN) {
    return "Anda <strong>belum clock in</strong>. Menu Jualan, Resit dan Senarai Pesanan kekal dikunci sehingga anda clock in.";
  }
  if (st === OPERATIONAL_STATUS.CLOCKED_IN) {
    return "Anda <strong>sudah clock in</strong>. Sila <strong>buka drawer</strong> untuk aktifkan tunai, void resit dan tutup drawer.";
  }
  if (st === OPERATIONAL_STATUS.SHIFT_OPEN) {
    return "Sistem sedia beroperasi penuh: jualan, resit, dapur, dan kawalan tunai drawer sedang aktif.";
  }
  if (st === OPERATIONAL_STATUS.SHIFT_CLOSED) {
    return "Drawer tunai <strong>telah ditutup</strong>. Skrin kaunter dalam mod baca sahaja sehingga anda clock out atau pengurus membuka drawer baharu.";
  }
  return escapeHtml(String(st));
}

/** Satu ayat ringkas tentang laci / drawer POS (tanpa ID teknikal). Ikut status operasi; bukan `hub.shift.isOpen` sahaja (stor boleh kekal “dibuka” waktu belum clock in). */
function shiftPosHumanLine(hub, eff) {
  if (eff === OPERATIONAL_STATUS.NOT_CLOCKED_IN) {
    return "Laci tunai: <strong>tutup</strong>. Clock in dahulu untuk membolehkan buka drawer dan rekod tunai.";
  }
  if (eff === OPERATIONAL_STATUS.SHIFT_CLOSED) {
    return "Laci tunai: drawer <strong>ditutup</strong>. Mod baca sahaja sehingga clock out atau buka drawer baharu.";
  }
  if (hub.shift && hub.shift.isOpen) {
    return "Laci tunai: dibuka. Rekod tunai drawer sedang aktif.";
  }
  return "Laci tunai: <strong>belum dibuka</strong>. Gunakan butang <strong>Buka drawer</strong> di bawah.";
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
    if (need === "clocked") blocked = !canAccessOperationalModules();
    else if (need === "shift-open") blocked = !canUseFinancialControls();
    if (blocked) {
      a.classList.add("is-locked");
      a.setAttribute("aria-disabled", "true");
      a.title = staffLockMessage();
    }
  });
}

/**
 * Tutup skrin terbenam Jualan / Resit / Senarai Pesanan serta nyahaktif pautan aktif
 * apabila pengguna tidak lagi dibenarkan (contoh: clock out, drawer ditutup — baca sahaja).
 */
function enforceLockedPosEmbedsClosed() {
  if (canBypassStaffRestrictions()) return;
  if (canAccessOperationalModules()) return;
  var iframe = document.getElementById("content-embed");
  var wrap = document.getElementById("content-embed-wrap");
  if (!iframe || !wrap || wrap.hidden) return;
  var src = String(iframe.getAttribute("src") || "");
  if (
    src.indexOf("pos-order.html") === -1 &&
    src.indexOf("pos-receipts.html") === -1 &&
    src.indexOf("pos-order-board.html") === -1
  ) {
    return;
  }
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
  if (need === "clocked" && !canAccessOperationalModules()) {
    e.preventDefault();
    window.alert(staffLockMessage());
    return true;
  }
  if (need === "shift-open" && !canUseFinancialControls()) {
    e.preventDefault();
    window.alert(
      canBypassStaffRestrictions()
        ? "Buka drawer untuk mengaktifkan kawalan kewangan."
        : "Sila buka drawer dari menu Clock In — diperlukan untuk void resit dan kawalan tunai."
    );
    return true;
  }
  return false;
}

/**
 * Ambil GPS semasa (kalau boleh) untuk sekatan lokasi kedai di clock-in.
 * Pulang null senyap kalau geolocation tak tersedia/ditolak/timeout — server yang tentukan
 * sama ada lokasi diperlukan (kalau Owner belum tetapkan lokasi kedai, null diterima).
 * @returns {Promise<{ lat: number, lng: number } | null>}
 */
function getCurrentCoords() {
  return new Promise(function (resolve) {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      function () {
        resolve(null);
      },
      // enableHighAccuracy:false + timeout pendek — kita cuma perlukan ketepatan tahap
      // bangunan (radius kedai), bukan navigasi. GPS ketepatan tinggi boleh ambil 5-8 saat
      // dalam bangunan; lokasi rangkaian (WiFi/sel) biasanya balas < 2 saat.
      { enableHighAccuracy: false, timeout: 4000, maximumAge: 60000 }
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
  if (!id || id === OWNER_STAFF_DOC_ID) return false;
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
 */
function showClockOutTotpModal(staffId, staffName, onConfirmed, onCancel) {
  var backdrop = document.createElement("div");
  backdrop.className = "kb-clock-in-staff-modal__backdrop";
  backdrop.setAttribute("aria-hidden", "false");

  var dialog = document.createElement("div");
  dialog.className = "kb-clock-in-staff-modal";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "kb-clockout-totp-title");

  dialog.innerHTML =
    '<h2 id="kb-clockout-totp-title" class="kb-clock-in-staff-modal__title">Sahkan Clock Out — ' +
    escapeHtml(staffName || "") +
    "</h2>" +
    '<p class="kb-clock-in-staff-modal__lead">Masukkan kod 2FA dari app authenticator untuk sahkan clock out.</p>' +
    '<label class="kb-clock-in-staff-modal__label" for="kb-clockout-totp-input">Kod 2FA (6 digit)</label>' +
    '<input type="text" inputmode="numeric" id="kb-clockout-totp-input" maxlength="6" placeholder="Kod dari app authenticator" autocomplete="off" style="width:100%;padding:0.5rem;font-size:1rem;border:1px solid var(--border);border-radius:6px;" />' +
    '<p id="kb-clockout-totp-error" style="color:var(--color-danger,#c0392b);font-size:0.82rem;margin-top:0.35rem;display:none;"></p>' +
    '<div class="kb-clock-in-staff-modal__actions">' +
    '<button type="button" class="btn btn--ghost" id="kb-clockout-totp-cancel">Batal</button>' +
    '<button type="button" class="btn btn--primary" id="kb-clockout-totp-ok">Sahkan clock out</button>' +
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
  btnCancel.onclick = function () {
    cleanup();
    if (onCancel) onCancel();
  };

  btnOk.onclick = async function () {
    var code = String(input.value || "").trim();
    if (!/^\d{6}$/.test(code)) {
      err.textContent = "Masukkan kod 2FA 6 digit.";
      err.style.display = "block";
      return;
    }
    btnOk.disabled = true;
    btnOk.textContent = "Mengesahkan…";
    try {
      var coords = await coordsPromise;
      var { verifyStaffClockIn } = await totpCallablesPromise;
      var result = await verifyStaffClockIn(staffId, code, coords, { action: "clock_out" });
      if (!result.verified) {
        err.textContent = result.error || "Kod 2FA tidak sepadan.";
        err.style.display = "block";
        input.value = "";
        input.focus();
        btnOk.disabled = false;
        btnOk.textContent = "Sahkan clock out";
        return;
      }
      cleanup();
      onConfirmed();
    } catch (e2) {
      console.warn("[clock-out] verify error:", e2);
      err.textContent = "Tidak dapat sahkan 2FA sekarang. Sila cuba lagi.";
      err.style.display = "block";
      btnOk.disabled = false;
      btnOk.textContent = "Sahkan clock out";
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
  var backdrop = document.createElement("div");
  backdrop.className = "kb-clock-in-staff-modal__backdrop";
  backdrop.setAttribute("aria-hidden", "false");

  var dialog = document.createElement("div");
  dialog.className = "kb-clock-in-staff-modal";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "kb-clock-in-staff-title");

  dialog.innerHTML =
    '<h2 id="kb-clock-in-staff-title" class="kb-clock-in-staff-modal__title">Pilih nama anda</h2>' +
    '<p class="kb-clock-in-staff-modal__lead">Pilih siapa yang sedang clock in. Rekod ini untuk kehadiran dan jualan.</p>' +
    '<label class="kb-clock-in-staff-modal__label" for="kb-clock-in-staff-sel">Kakitangan</label>' +
    '<select id="kb-clock-in-staff-sel" class="kb-clock-in-staff-modal__select" aria-label="Pilih kakitangan">' +
    '<option value="">' + escapeHtml("Memuat senarai…") + "</option></select>" +
    '<div id="kb-role-section" style="margin-top:1rem;display:none;">' +
    '<label class="kb-clock-in-staff-modal__label" for="kb-clock-in-role-sel">Tugas untuk sesi ini</label>' +
    '<select id="kb-clock-in-role-sel" class="kb-clock-in-staff-modal__select" aria-label="Pilih tugas">' +
    '<option value="">— Pilih tugas —</option>' +
    '<option value="cashier" id="kb-role-opt-cashier">Cashier</option>' +
    '<option value="kitchen">Kitchen</option>' +
    "</select>" +
    '<p id="kb-role-cashier-taken" style="color:var(--text-muted);font-size:0.78rem;margin-top:0.35rem;display:none;"></p>' +
    '<p id="kb-role-error" style="color:var(--color-danger,#c0392b);font-size:0.82rem;margin-top:0.35rem;display:none;">Sila pilih tugas (Cashier/Kitchen).</p>' +
    "</div>" +
    '<div id="kb-totp-section" style="margin-top:1rem;display:none;">' +
    '<label class="kb-clock-in-staff-modal__label" for="kb-clock-in-totp-input">Kod 2FA (6 digit)</label>' +
    '<input type="text" inputmode="numeric" id="kb-clock-in-totp-input" maxlength="6" placeholder="Kod dari app authenticator" autocomplete="off" style="width:100%;padding:0.5rem;font-size:1rem;border:1px solid var(--border);border-radius:6px;" />' +
    '<p id="kb-totp-error" style="color:var(--color-danger,#c0392b);font-size:0.82rem;margin-top:0.35rem;display:none;">Kod 2FA tidak sepadan.</p>' +
    "</div>" +
    '<div class="kb-clock-in-staff-modal__actions">' +
    '<button type="button" class="btn btn--ghost" id="kb-clock-in-staff-cancel">Batal</button>' +
    '<button type="button" class="btn btn--primary" id="kb-clock-in-staff-ok">Sahkan clock in</button>' +
    "</div>";

  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);

  // Prefetch GPS + modul callable SEKARANG (selari dengan pengguna pilih nama/tugas/masuk
  // kod 2FA) — elak pengguna nampak "Mengesahkan…" freeze tunggu GPS lock / muat modul
  // bila klik Sahkan.
  var coordsPromise = getCurrentCoords();
  var totpCallablesPromise = import("./staff/totp-callables.js");

  var sel = dialog.querySelector("#kb-clock-in-staff-sel");
  var btnOk = dialog.querySelector("#kb-clock-in-staff-ok");
  var btnCancel = dialog.querySelector("#kb-clock-in-staff-cancel");
  var actionsRow = dialog.querySelector(".kb-clock-in-staff-modal__actions");
  var roleSection = dialog.querySelector("#kb-role-section");
  var roleSel = dialog.querySelector("#kb-clock-in-role-sel");
  var roleOptCashier = dialog.querySelector("#kb-role-opt-cashier");
  var roleCashierTaken = dialog.querySelector("#kb-role-cashier-taken");
  var roleError = dialog.querySelector("#kb-role-error");
  var totpSection = dialog.querySelector("#kb-totp-section");
  var totpInput = dialog.querySelector("#kb-clock-in-totp-input");
  var totpError = dialog.querySelector("#kb-totp-error");
  var selectedStaffRequiresTotp = false;

  // Semak sekali bila modal dibuka: kalau dah ada Cashier bertugas, sekat opsyen tu.
  // Semakan ni cuma untuk UX (elak klik sia-sia) — server (verifyStaffClockIn) tetap
  // penentu muktamad, jadi tak jadi masalah kalau data ni lapuk sedikit (race condition).
  getDocs(query(collection(db, "pos_active_shift"), where("workRole", "==", "cashier"), limit(1)))
    .then(function (snap) {
      if (snap.empty) return;
      var d = snap.docs[0].data();
      if (roleOptCashier) {
        roleOptCashier.disabled = true;
        roleOptCashier.textContent = "Cashier (sudah bertugas)";
      }
      if (roleCashierTaken) {
        roleCashierTaken.textContent = "Cashier sekarang: " + String(d.staffName || "staf lain") + ". Pilih Kitchen.";
        roleCashierTaken.style.display = "block";
      }
    })
    .catch(function (e) {
      console.warn("[clock-in] cashier-slot check error:", e);
    });

  // Show/hide tugas + 2FA section bila staf dipilih
  sel.addEventListener("change", function () {
    var v = String(sel.value || "").trim();
    selectedStaffRequiresTotp = false;
    totpSection.style.display = "none";
    totpInput.value = "";
    totpError.style.display = "none";
    roleSection.style.display = v ? "block" : "none";
    roleSel.value = "";
    roleError.style.display = "none";
    if (v) {
      staffTotpEnabledCached(v).then(function (enabled) {
        if (String(sel.value || "").trim() !== v) return; // pilihan dah berubah semasa fetch
        selectedStaffRequiresTotp = enabled;
        totpSection.style.display = enabled ? "block" : "none";
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
      sel.innerHTML = '<option value="">' + escapeHtml("Memuat senarai…") + "</option>";
      return;
    }
    retryWrap.hidden = true;
    var rows = getStaffRowsCached();
    if (!rows.length) {
      modalStaffFocusOnce = false;
      sel.innerHTML =
        '<option value="">' +
        escapeHtml("— Tiada rekod kakitangan — tambah di Back Office —") +
        "</option>";
      try {
        sel.focus();
      } catch (e2) {}
      return;
    }
    var cur = String(loadSession().operationalStaffId || "").trim();
    sel.innerHTML = staffRowsBuildOptionsHtml(rows, cur, "— Pilih nama —");
    if (!modalStaffFocusOnce) {
      modalStaffFocusOnce = true;
      try {
        sel.focus();
      } catch (e2) {}
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

  btnOk.onclick = async function () {
    var v = String(sel.value || "").trim();
    if (!v) {
      window.alert("Sila pilih nama dari senarai.");
      try {
        sel.focus();
      } catch (e) {}
      return;
    }

    var workRole = String(roleSel ? roleSel.value || "" : "").trim();
    if (!workRole) {
      if (roleError) roleError.style.display = "block";
      try {
        roleSel.focus();
      } catch (e) {}
      return;
    }

    var enteredTotp = String(totpInput ? totpInput.value || "" : "").trim();

    if (selectedStaffRequiresTotp && !/^\d{6}$/.test(enteredTotp)) {
      if (totpError) {
        totpError.textContent = "Masukkan kod 2FA 6 digit dari app authenticator.";
        totpError.style.display = "block";
      }
      if (totpInput) totpInput.focus();
      return;
    }

    btnOk.disabled = true;
    btnOk.textContent = "Mengesahkan…";

    try {
      var coords = await coordsPromise;
      var { verifyStaffClockIn } = await totpCallablesPromise;
      var result = await verifyStaffClockIn(v, enteredTotp, coords, { workRole: workRole, action: "clock_in" });

      if (!result.verified) {
        var isCashierTaken = /[Cc]ashier sudah bertugas/.test(result.error || "");
        // Ralat bukan tentang kod 2FA (slot Cashier diambil, "Sudah clock in.", dll.) — papar
        // di seksyen tugas (sentiasa nampak) bukan seksyen 2FA (mungkin tersembunyi/tak relevan
        // bila staf ni tak diaktifkan 2FA langsung, elak nampak macam minta kod 2FA).
        if ((isCashierTaken || !selectedStaffRequiresTotp) && roleError) {
          roleError.textContent = result.error || "Tidak dapat clock in.";
          roleError.style.display = "block";
          if (isCashierTaken && roleOptCashier) {
            roleOptCashier.disabled = true;
            roleOptCashier.textContent = "Cashier (sudah bertugas)";
          }
        } else if (totpError) {
          totpError.textContent = result.error || "Kod 2FA tidak sepadan.";
          totpError.style.display = "block";
          if (totpSection) totpSection.style.display = "block";
          if (selectedStaffRequiresTotp && totpInput) {
            totpInput.value = "";
            totpInput.focus();
          }
        }
        var optFail = sel.options[sel.selectedIndex];
        import("./pos-firestore-hub.js")
          .then(function (hub) {
            return hub.appendPosAudit({
              type: "clockin_totp_failed",
              message: "Kod 2FA salah semasa cuba clock in.",
              meta: { staffId: v, staffName: optFail ? String(optFail.text || "").trim() : "" }
            });
          })
          .catch(function () {});
        btnOk.disabled = false;
        btnOk.textContent = "Sahkan clock in";
        return;
      }
      var opt = sel.options[sel.selectedIndex];
      var name = opt ? String(opt.text || "").trim() : "";
      cleanup({ id: v, name: name, workRole: workRole });
    } catch (err) {
      console.warn("[clock-in] verify error:", err);
      if (selectedStaffRequiresTotp || workRole !== "cashier") {
        // 2FA diaktifkan, ATAU tugas bukan-cashier (roster + staff_activity ditulis di server,
        // tiada rekod tempatan sandaran) — fail-CLOSED, jangan benarkan clock-in tanpa pengesahan.
        if (totpError) {
          totpError.textContent = "Tidak dapat sahkan clock in sekarang. Sila cuba lagi.";
          totpError.style.display = "block";
        }
        btnOk.disabled = false;
        btnOk.textContent = "Sahkan clock in";
        return;
      }
      // Cashier + 2FA tak diaktifkan — log masuk ialah lapisan keselamatan utama,
      // benarkan clock-in walaupun semakan tak tersedia (tingkah laku sedia ada).
      var opt2 = sel.options[sel.selectedIndex];
      var name2 = opt2 ? String(opt2.text || "").trim() : "";
      cleanup({ id: v, name: name2, workRole: workRole });
    } finally {
      try {
        btnOk.disabled = false;
        btnOk.textContent = "Sahkan clock in";
      } catch (e) {}
    }
  };

  loadStaffIntoSelect();
}

var activeShiftDocs = [];
var activeShiftUnsub = null;

/** Langganan realtime pos_active_shift (satu kali) — roster siapa sedang bertugas serentak. */
function ensureActiveShiftRealtimeSub() {
  if (activeShiftUnsub) return;
  activeShiftUnsub = onSnapshot(
    collection(db, "pos_active_shift"),
    function (snap) {
      activeShiftDocs = snap.docs.map(function (d) {
        return Object.assign({ id: d.id }, d.data());
      });
      renderActiveShiftRoster();
    },
    function (e) {
      console.warn("[roster] pos_active_shift sub error:", e);
    }
  );
}

function renderActiveShiftRoster() {
  var el = document.getElementById("kb-active-roster");
  if (!el) return;
  // Papar SEMUA (termasuk Cashier) — device lain (cth tablet dapur) tak nampak ringkasan
  // "Sedang bertugas" tu, ia cuma wujud di device Cashier sendiri (session tempatan). Tapi
  // baris Cashier TIADA butang "Clock out" di sini — clock-out Cashier mesti di device asal
  // (session tempatan dia), kalau tidak roster Firestore clear tapi session tempatan tersekat
  // "masih clock-in" (dua sumber kebenaran tak sync).
  var rows = activeShiftDocs.slice();
  if (!rows.length) {
    el.innerHTML = "";
    return;
  }
  el.innerHTML =
    '<p class="kb-active-roster__title" style="margin:1rem 0 0.4rem;font-size:0.8rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;">Staf bertugas (' +
    rows.length +
    ")</p>" +
    rows
      .map(function (x) {
        var isCashier = String(x.workRole || "") === "cashier";
        return (
          '<div class="kb-active-roster__row" style="display:flex;align-items:center;justify-content:space-between;gap:0.5rem;padding:0.5rem 0;border-bottom:1px solid var(--border);">' +
          '<span style="font-size:0.88rem;">' +
          escapeHtml(x.staffName || x.staffId || "") +
          ' <span style="color:var(--text-muted);font-size:0.78rem;">(' +
          escapeHtml(x.workRole || "") +
          ")</span></span>" +
          (isCashier
            ? '<span style="font-size:0.75rem;color:var(--text-muted);">Clock out di terminal asal</span>'
            : '<button type="button" class="btn btn--ghost btn--sm js-roster-clockout" data-staff-id="' +
              escapeHtml(x.staffId || x.id) +
              '" data-staff-name="' +
              escapeHtml(x.staffName || "") +
              '">Clock out</button>') +
          "</div>"
        );
      })
      .join("");

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
              window.alert(result.error || "Tidak dapat clock out sekarang.");
              btn.disabled = false;
              return;
            }
            // Panel akan auto-kemas kini bila listener pos_active_shift terima perubahan.
          })
          .catch(function (e) {
            console.warn("[roster] clock-out error:", e);
            window.alert("Tidak dapat clock out sekarang. Sila cuba lagi.");
            btn.disabled = false;
          });
      }
      staffTotpEnabledCached(staffId).then(function (enabled) {
        if (!enabled) {
          doRosterClockOut("");
          return;
        }
        showClockOutTotpModal(staffId, staffName, function () {
          // showClockOutTotpModal dah sahkan kod & panggil verifyStaffClockIn(action:"clock_out") sendiri —
          // roster akan auto-kemas kini dari listener, tiada tindakan tambahan diperlukan di sini.
        });
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
  if (panelTitle) panelTitle.textContent = "Clock In / Clock Out";
  if (topbarTitle) topbarTitle.textContent = "Kehadiran & drawer";
  if (contentLead) {
    contentLead.innerHTML = "";
    contentLead.hidden = true;
  }
  if (panelBody) {
    var shiftOpen = !!(hub.shift && hub.shift.isOpen);
    var clockInBlocked = !s.clockedIn && shiftOpen;
    var clockInBtn = clockInBlocked
      ? '<button type="button" class="btn btn--primary" id="kb-clock-in" disabled aria-disabled="true" data-clock-blocked="1" title="Tutup drawer tunai dahulu">' +
        "Clock in" +
        "</button>" +
        '<p class="kb-clock-in-blocked" style="margin:0.5rem 0 0;font-size:0.8rem;color:var(--text-muted);max-width:28rem">' +
        "Drawer tunai masih <strong>dibuka</strong>. Tutup drawer di bawah dahulu, kemudian anda boleh clock in." +
        "</p>"
      : '<button type="button" class="btn btn--primary" id="kb-clock-in">Clock in</button>';

    panelBody.innerHTML =
      '<div class="kb-clock-summary">' +
      (s.clockedIn
        ? '<p style="margin:0 0 0.65rem;font-size:0.85rem;color:var(--text-muted)">' +
          '<span class="kb-badge kb-badge--duty">Sedang bertugas</span> · Mula ' +
          escapeHtml(formatClockedInHuman(s.clockedInAt)) +
          "</p>" +
          (shiftOpen
            ? '<button type="button" class="btn btn--ghost" id="kb-clock-out" disabled aria-disabled="true" title="Tutup drawer tunai dahulu">' +
              "Clock out" +
              "</button>" +
              '<p class="kb-clock-out-blocked" style="margin:0.5rem 0 0;font-size:0.8rem;color:var(--text-muted);max-width:28rem">' +
              "Drawer tunai masih <strong>dibuka</strong> dalam Firestore. Selesaikan <strong>Tutup drawer</strong> di bawah, kemudian tekan Clock out." +
              "</p>"
            : '<button type="button" class="btn btn--ghost" id="kb-clock-out">Clock out</button>')
        : clockInBtn) +
      '<div class="kb-clock-status">' +
      '<p style="margin:0.85rem 0 0;font-size:0.85rem;line-height:1.55;color:var(--text)">' +
      operationalStatusHumanLine(eff) +
      "</p>" +
      '<p style="margin:0.45rem 0 0;font-size:0.85rem;line-height:1.55;color:var(--text-muted)">' +
      shiftPosHumanLine(hub, eff) +
      "</p>" +
      "</div>" +
      "</div>" +
      getShiftPanelHtml() +
      '<div id="kb-active-roster" class="kb-active-roster"></div>';

    ensureActiveShiftRealtimeSub();
    renderActiveShiftRoster();

    var ci = document.getElementById("kb-clock-in");
    if (ci && !clockInBlocked) {
      ci.onclick = function () {
        function afterClockInOk() {
          renderClockPanel();
          renderStatusBar();
          applyPosLinkLocks();
          if (window.confirm("Clock in berjaya. Buka drawer sekarang?")) {
            var openBtn = document.getElementById("btn-shift-open");
            if (openBtn && !openBtn.hidden) openBtn.focus();
          }
        }
        if (requiresOperationalStaffPicker()) {
          showClockInStaffPickerModal(function (picked) {
            if (!picked || !picked.id) return;
            if (picked.workRole !== "cashier") {
              // Laluan bukan-cashier (cth Kitchen): server dah urus roster + staff_activity
              // dalam verifyStaffClockIn — device ni TAK dikunci, jangan sentuh sesi tempatan.
              window.alert("Clock in berjaya — " + picked.name + " (" + picked.workRole + ").");
              renderClockPanel();
              return;
            }
            setPosOperationalStaff(picked.id, picked.name, picked.workRole);
            var r = clockIn();
            if (!r.ok) {
              window.alert(r.error);
              return;
            }
            afterClockInOk();
          });
          return;
        }
        var r = clockIn();
        if (!r.ok) {
          window.alert(r.error);
          return;
        }
        afterClockInOk();
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
        function releaseShiftSlotThenClockOut(staffId) {
          getCurrentCoords()
            .then(function (coords) {
              return import("./staff/totp-callables.js").then(function (m) {
                return m.verifyStaffClockIn(staffId, "", coords, { action: "clock_out" });
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
        if (!staffId) {
          doClockOut();
          return;
        }
        if (staffId === OWNER_STAFF_DOC_ID) {
          releaseShiftSlotThenClockOut(staffId);
          return;
        }
        staffTotpEnabledCached(staffId).then(function (enabled) {
          if (!enabled) {
            releaseShiftSlotThenClockOut(staffId);
            return;
          }
          showClockOutTotpModal(staffId, sess.operationalStaffName || "", doClockOut);
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
    await new Promise(function (r) {
      window.setTimeout(r, 80);
    });
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
