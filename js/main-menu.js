import { auth, signOut } from "./firebase/init.js";

var LOGIN_PAGE_HREF = new URL("../html/login.html", import.meta.url).href;
import { waitForAuthUser, getPosUserRbacPayload } from "./pos-firebase-auth-bridge.js";
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
  loginSession,
  staffLockMessage,
  getEffectiveOperationalStatus,
  OPERATIONAL_STATUS
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
      resolve();
    }
    var t = window.setTimeout(fin, 12000);
    iframe.addEventListener(
      "load",
      function onLoad() {
        iframe.removeEventListener("load", onLoad);
        window.clearTimeout(t);
        fin();
      },
      { once: true }
    );
    try {
      if (iframe.contentDocument && iframe.contentDocument.readyState === "complete") {
        window.clearTimeout(t);
        fin();
      }
    } catch (ignored) {}
  });
}

function finishAppLoader() {
  document.body.classList.remove("kb-app-boot");
  var el = document.getElementById("kb-app-loader");
  if (!el || el.classList.contains("kb-app-loader--out")) return;
  el.classList.add("kb-app-loader--out");
  el.style.pointerEvents = "none";
  el.setAttribute("aria-busy", "false");
  window.setTimeout(function () {
    el.setAttribute("hidden", "");
    el.style.display = "none";
  }, 420);
}

async function ensureSessionFromFirebase() {
  var u = await waitForAuthUser();
  if (!u) {
    window.location.replace(LOGIN_PAGE_HREF);
    return false;
  }
  var payload = await getPosUserRbacPayload(u);
  var need = true;
  try {
    var raw = localStorage.getItem("kb_pos_rbac_session_v1");
    if (raw) {
      var o = JSON.parse(raw);
      if (o && String(o.userId) === String(payload.userId)) need = false;
    }
  } catch (e) {}
  if (need) {
    loginSession(payload);
  }
  return true;
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
    lead: "<strong>Klik Burger</strong> — kaunter. Menu kiri untuk operasi harian.",
    panelTitle: "Ringkasan giliran kerja",
    panelBody: "Contoh: jualan hari ini, pesanan aktif, resit. Sambung data kemudian."
  },
  bo: {
    tag: "Back Office",
    topbar: "Laman utama — pentadbiran",
    lead: "<strong>Klik Burger</strong> — pejabat belakang. Menu kiri: laporan, produk &amp; kakitangan, tetapan.",
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

function hideEmbed() {
  var wrap = document.getElementById("content-embed-wrap");
  var iframe = document.getElementById("content-embed");
  var def = document.getElementById("content-default");
  if (!wrap || !def) return;
  wrap.hidden = true;
  def.hidden = false;
  if (iframe) {
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
    copyKind === "catalog" ? "Menu produk — Klik Burger" : "Kalkulator kos — Klik Burger";
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
  def.hidden = true;
  wrap.hidden = false;
  iframe.src = "staff-dashboard.html";
  iframe.title = "Kakitangan — Klik Burger";
  if (topbarTitle) topbarTitle.textContent = "Kakitangan";
  setTopbarEmbedLead(
    "Urus <strong>rekod staf</strong>, pantau <strong>prestasi</strong> mengikut bulan, dan tetapkan <strong>bonus pasukan</strong> daripada jualan POS."
  );
  if (panelTitle) panelTitle.textContent = "";
  if (panelBody) panelBody.textContent = "";
  persistShell({ r: "bo-staff", module: "bo" });
}

function showBoMonthlyReports() {
  var wrap = document.getElementById("content-embed-wrap");
  var iframe = document.getElementById("content-embed");
  var def = document.getElementById("content-default");
  if (!wrap || !iframe || !def) return;
  def.hidden = true;
  wrap.hidden = false;
  iframe.src = "bo-monthly-reports.html";
  iframe.title = "Laporan penuh — Klik Burger";
  if (topbarTitle) topbarTitle.textContent = "Laporan penuh";
  setTopbarEmbedLead(
    '<strong>Paparan</strong> — mengikut <strong>tahun &amp; bulan</strong> kalendar. Sambungan data penuh boleh diaktifkan kemudian; gunakan <code class="topbar__embed-code">?demo=1</code> pada URL untuk <strong>pratonton UI</strong> tanpa Firestore.'
  );
  if (panelTitle) panelTitle.textContent = "";
  if (panelBody) panelBody.textContent = "";
  persistShell({ r: "bo-monthly-reports", module: "bo" });
}

function showPosEmbedPage(file, iframeTitle, leadHtml, topbarText) {
  var wrap = document.getElementById("content-embed-wrap");
  var iframe = document.getElementById("content-embed");
  var def = document.getElementById("content-default");
  if (!wrap || !iframe || !def) return;
  def.hidden = true;
  wrap.hidden = false;
  iframe.src = file;
  iframe.title = iframeTitle || "Klik Burger";
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
      setActiveNav(navBo, "[data-bo-link]");
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
    escapeHtml(String(s.displayName || "—").toLowerCase()) +
    "</strong> . " +
    escapeHtml(roleLabel) +
    "</span>" +
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
      ? '<button type="button" class="btn btn--primary" id="kb-clock-in" disabled aria-disabled="true" title="Tutup drawer tunai dahulu">' +
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
      getShiftPanelHtml();

    var ci = document.getElementById("kb-clock-in");
    if (ci && !ci.disabled) {
      ci.onclick = function () {
        var r = clockIn();
        if (!r.ok) {
          window.alert(r.error);
          return;
        }
        renderClockPanel();
        renderStatusBar();
        applyPosLinkLocks();
        if (window.confirm("Clock in berjaya. Buka drawer sekarang?")) {
          var openBtn = document.getElementById("btn-shift-open");
          if (openBtn && !openBtn.hidden) openBtn.focus();
        }
      };
    }
    var co = document.getElementById("kb-clock-out");
    if (co && !co.disabled) {
      co.onclick = function () {
        var r = clockOut();
        if (!r.ok) {
          window.alert(r.error);
          return;
        }
        renderClockPanel();
        renderStatusBar();
        applyPosLinkLocks();
      };
    }
    renderShiftPanelUI(getPosHubState());
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
        t.getAttribute("data-pos-title") || "Klik Burger",
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

function wireLogout() {
  var out = document.querySelector(".sidebar__out");
  if (!out) return;
  out.addEventListener("click", async function (e) {
    e.preventDefault();
    try {
      await signOut(auth);
    } catch (err) {
      console.warn(err);
    }
    logoutSession();
    try {
      sessionStorage.removeItem(RESTORE_KEY);
      localStorage.removeItem(RESTORE_KEY_LS);
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
  });
}
}

async function bootMainMenu() {
  var safetyDismiss = window.setTimeout(function () {
    if (document.body && document.body.classList.contains("kb-app-boot")) {
      console.warn("[boot] Loader tamat masa — semak rangkaian / Firebase.");
      shellBootSuppressPersist = false;
      finishAppLoader();
    }
  }, 15000);
  shellBootSuppressPersist = true;
  try {
    var ok = await ensureSessionFromFirebase();
    if (!ok) {
      return;
    }
    try {
      runMainMenuShell();
    } catch (shellErr) {
      console.error("[boot] runMainMenuShell", shellErr);
    }
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
      window.clearTimeout(safetyDismiss);
    } catch (e2) {}
    shellBootSuppressPersist = false;
    finishAppLoader();
  }
}

bootMainMenu();
