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
    lead: "<strong>Klik Burger</strong> — pejabat belakang. Menu kiri: laporan, produk, kakitangan, tetapan.",
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
      (page === "modifiers" ? "Produk & kos" : "Bahan mentah");
  }
  if (contentLead) {
    if (copyKind === "catalog") {
      contentLead.innerHTML =
        "<strong>Produk</strong> — urus pakej sahaja. Item tunggal &amp; kos: <em>Inventori → Produk &amp; kos</em>.";
    } else {
      contentLead.innerHTML =
        "Inventori di bawah — <em>Bahan mentah</em> / <em>Produk &amp; kos</em>.";
    }
    contentLead.removeAttribute("hidden");
  }
  if (panelTitle) panelTitle.textContent = "";
  if (panelBody) panelBody.textContent = "";
}

function showBoStaff() {
  var wrap = document.getElementById("content-embed-wrap");
  var iframe = document.getElementById("content-embed");
  var def = document.getElementById("content-default");
  if (!wrap || !iframe || !def) return;
  def.hidden = true;
  wrap.hidden = false;
  iframe.src = "staff-dashboard.html";
  iframe.title = "Staff — Klik Burger";
  if (topbarTitle) topbarTitle.textContent = "Staff";
  if (contentLead) {
    contentLead.innerHTML =
      "Urus pekerja, syif mingguan &amp; prestasi. Jualan POS direkodkan dengan staf yang dipilih di skrin jualan.";
    contentLead.removeAttribute("hidden");
  }
  if (panelTitle) panelTitle.textContent = "";
  if (panelBody) panelBody.textContent = "";
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
  if (contentLead) {
    contentLead.innerHTML = leadHtml || "";
    contentLead.removeAttribute("hidden");
  }
  if (panelTitle) panelTitle.textContent = "";
  if (panelBody) panelBody.textContent = "";
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
    window.location.href = LOGIN_PAGE_HREF;
  });
  out.setAttribute("href", "#");
}

if (trigger && layer) {
  enforceStaffStaysOnCounter();
  var initialModule = isElevatedRole() ? getStoredModule() : "pos";
  if (initialModule === "bo" && !canAccessBackOfficeModule()) initialModule = "pos";
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
}

async function bootMainMenu() {
  var ok = await ensureSessionFromFirebase();
  if (!ok) return;
  runMainMenuShell();
}

bootMainMenu();
