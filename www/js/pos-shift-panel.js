/**
 * Panel drawer tunai (buka/tutup, tunai masuk-keluar) — dipasang di menu utama
 * (Clock In / Drawer). Hab: pos-operations-hub + RBAC pos-rbac-session.
 */
import {
  subscribePosHub,
  getPosHubState,
  shiftOpen,
  shiftCashMovement,
  shiftClose,
  getExpectedDrawerCash,
  getShiftSalesBreakdown
} from "./pos-operations-hub.js";
import {
  subscribeRbac,
  getSnapshot,
  canBypassStaffRestrictions,
  canAccessOperationalModules,
  canUseFinancialControls,
  isReadOnlyMode,
  getActorForAudit,
  clearManagerPinFailures,
  staffLockMessage,
  notifyShiftClosedForStaff,
  notifyShiftOpenedClearReadOnly
} from "./pos-rbac-session.js";
var hubBound = false;

function isClockedIn() {
  try {
    return !!(getSnapshot().session && getSnapshot().session.clockedIn);
  } catch (e) {
    return false;
  }
}

/** Laci & drawer — sama seperti menu operasi: mesti clock in dahulu (semua peranan). */
function requireClockInForLaci() {
  if (isClockedIn()) return true;
  window.alert("Sila clock in dahulu. Kawalan laci tunai dan drawer hanya dibuka selepas clock in.");
  return false;
}

function setShiftShellInert(locked) {
  var shell = document.getElementById("kb-shift-shell");
  if (!shell) return;
  if (locked) shell.setAttribute("inert", "");
  else shell.removeAttribute("inert");
}

function formatRM(n) {
  return "RM " + (Math.round(n * 100) / 100).toFixed(2);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtShortClock(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString("ms-MY", { hour: "2-digit", minute: "2-digit" });
  } catch (e) {
    return "—";
  }
}

export function getShiftPanelHtml() {
  return (
    '<div id="kb-shift-shell" class="kb-shift-shell">' +
    '<section class="rc-shift rc-shift--compact kb-shift-panel" aria-labelledby="kb-shift-heading">' +
    '<h2 id="kb-shift-heading" class="sr-only">Drawer tunai</h2>' +
    '<div class="rc-shift-bar">' +
    '<div class="rc-shift-bar__top">' +
    '<span id="rc-shift-pill" class="rc-shift-pill" aria-live="polite"></span>' +
    '<p id="shift-status-line" class="rc-shift-line"></p>' +
    "</div>" +
    '<div class="rc-shift-bar__metrics" role="group" aria-label="Ringkas drawer">' +
    '<div class="rc-mini-metric">' +
    '<span class="rc-mini-metric__lbl">Laci</span>' +
    '<strong id="shift-expected" class="rc-mini-metric__val">—</strong>' +
    "</div>" +
    '<div class="rc-mini-metric">' +
    '<span class="rc-mini-metric__lbl">Jualan</span>' +
    '<strong id="shift-sales-total" class="rc-mini-metric__val">RM 0.00</strong>' +
    "</div>" +
    '<div class="rc-mini-metric rc-mini-metric--wide">' +
    '<span class="rc-mini-metric__lbl">Mengikut bayaran</span>' +
    '<div id="shift-pay-chips" class="rc-pay-chips"></div>' +
    "</div>" +
    "</div>" +
    '<div class="rc-shift-bar__actions">' +
    '<button type="button" class="rc-btn rc-btn--solid rc-btn--action rc-btn--shift-open" id="btn-shift-open" title="Buka drawer">' +
    '<i class="fa-solid fa-door-open" aria-hidden="true"></i> Buka drawer' +
    "</button>" +
    '<button type="button" class="rc-btn rc-btn--line rc-btn--action" id="btn-cash-in" title="Tunai masuk">' +
    '<i class="fa-solid fa-arrow-down" aria-hidden="true"></i> Tunai masuk' +
    "</button>" +
    '<button type="button" class="rc-btn rc-btn--line rc-btn--action" id="btn-cash-out" title="Tunai keluar">' +
    '<i class="fa-solid fa-arrow-up" aria-hidden="true"></i> Tunai keluar' +
    "</button>" +
    '<button type="button" class="rc-btn rc-btn--solid rc-btn--action rc-btn--shift-close" id="btn-shift-close" title="Tutup drawer">' +
    '<i class="fa-solid fa-lock" aria-hidden="true"></i> Tutup drawer' +
    "</button>" +
    "</div>" +
    "</div>" +
    "</section>" +
    '<details class="rc-notes rc-notes--compact kb-shift-log-tunai">' +
    "<summary>Log tunai</summary>" +
    '<span class="rc-shift-details__label">Tunai masuk / keluar</span>' +
    '<div id="shift-movements" class="rc-shift-details__body"></div>' +
    "</details>" +
    "</div>"
  );
}

function applyShiftActionGates(state) {
  var sh = state.shift;
  var bypass = canBypassStaffRestrictions();
  var clockedIn = isClockedIn();
  var ops = clockedIn && (canAccessOperationalModules() || bypass);
  var fin = clockedIn && (canUseFinancialControls() || bypass);
  var ro = isReadOnlyMode() && !bypass;

  function setDis(id, dis) {
    var b = document.getElementById(id);
    if (b) b.disabled = !!dis;
  }

  var btnOpen = document.getElementById("btn-shift-open");
  if (btnOpen) {
    btnOpen.hidden = !!sh.isOpen;
    btnOpen.disabled = sh.isOpen ? true : !ops || ro;
  }
  setDis("btn-cash-in", !fin || ro || !sh.isOpen);
  setDis("btn-cash-out", !fin || ro || !sh.isOpen);
  /** Tutup drawer: jika drawer dibuka tetapi belum clock in, tetap benarkan (pecah deadlock dengan clock in disekat). */
  var closeDisabled = !sh.isOpen || ro || (clockedIn && !fin);
  setDis("btn-shift-close", closeDisabled);
  /**
   * Jangan `inert` bila drawer tunai masih dibuka — pengguna mesti boleh tekan Tutup drawer walaupun belum clock in.
   * Jika drawer tutup + belum clock in, kekalkan inert supaya Buka drawer tidak dicetus tanpa kehadiran.
   */
  setShiftShellInert(!clockedIn && !sh.isOpen);
}

function renderPayChips(b) {
  var chips = document.getElementById("shift-pay-chips");
  if (!chips) return;
  function chip(k, v) {
    return (
      '<span class="rc-pay-chip">' +
      '<span class="rc-pay-chip__k">' +
      escapeHtml(k) +
      "</span>" +
      '<span class="rc-pay-chip__v">' +
      formatRM(v) +
      "</span></span>"
    );
  }
  chips.innerHTML = chip("Tunai", b.cash) + chip("QR", b.duitnow);
}

export function renderShiftPanelUI(state) {
  if (!document.getElementById("shift-status-line")) return;

  var sh = state.shift;
  var pill = document.getElementById("rc-shift-pill");
  var line = document.getElementById("shift-status-line");
  var exp = document.getElementById("shift-expected");
  var tot = document.getElementById("shift-sales-total");
  var movEl = document.getElementById("shift-movements");
  if (!line || !exp || !tot || !movEl) return;

  if (pill) {
    if (sh.isOpen) {
      pill.textContent = "Drawer aktif";
      pill.className = "rc-shift-pill rc-shift-pill--open";
    } else if (sh.closing) {
      pill.textContent = "Drawer tutup";
      pill.className = "rc-shift-pill rc-shift-pill--done";
    } else {
      pill.textContent = "Belum buka";
      pill.className = "rc-shift-pill";
    }
  }

  if (sh.isOpen) {
    var sid = sh.shiftId ? String(sh.shiftId).slice(-10) : "—";
    line.textContent =
      fmtShortClock(sh.openedAt) +
      " · " +
      sid +
      " · Float " +
      formatRM(typeof sh.openingCash === "number" ? sh.openingCash : 0);
  } else if (sh.closing) {
    line.textContent =
      "Varians " +
      formatRM(sh.closing.variance) +
      (sh.closing.variance < 0 ? " (kurang)" : sh.closing.variance > 0 ? " (lebih)" : "");
  } else {
    line.textContent = "Buka drawer untuk rekod tunai dan jualan.";
  }

  exp.textContent = sh.isOpen ? formatRM(getExpectedDrawerCash()) : "—";
  var b = getShiftSalesBreakdown();
  tot.textContent = formatRM(b.total);
  renderPayChips(b);

  if (!sh.movements || !sh.movements.length) {
    movEl.textContent = "Tiada rekod tunai masuk atau keluar.";
  } else {
    movEl.innerHTML =
      "<ul style=\"margin:0;padding-left:1.1rem\">" +
      sh.movements
        .map(function (m) {
          return (
            "<li>" +
            escapeHtml(new Date(m.at).toLocaleString("ms-MY", { hour: "2-digit", minute: "2-digit" })) +
            " — " +
            (m.type === "out" ? "Keluar" : "Masuk") +
            " " +
            formatRM(m.amount) +
            (m.note ? " <span style=\"color:var(--text-muted)\">(" + escapeHtml(m.note) + ")</span>" : "") +
            "</li>"
          );
        })
        .join("") +
      "</ul>";
  }

  applyShiftActionGates(state);
}

function showModal(title, bodyHtml, footButtonsHtml) {
  var m = document.getElementById("kb-shift-modal");
  if (!m) return;
  var tEl = document.getElementById("kb-shift-modal-title");
  var bEl = document.getElementById("kb-shift-modal-body");
  var fEl = document.getElementById("kb-shift-modal-foot");
  if (tEl) tEl.textContent = title;
  if (bEl) bEl.innerHTML = bodyHtml;
  if (fEl) fEl.innerHTML = footButtonsHtml || "";
  m.hidden = false;
  m.setAttribute("aria-hidden", "false");
}

function hideModal() {
  var m = document.getElementById("kb-shift-modal");
  if (!m) return;
  m.hidden = true;
  m.setAttribute("aria-hidden", "true");
}

function handleShiftOpen() {
  if (!requireClockInForLaci()) return;
  if (!canAccessOperationalModules() && !canBypassStaffRestrictions()) {
    window.alert(staffLockMessage());
    return;
  }
  if (isReadOnlyMode() && !canBypassStaffRestrictions()) {
    window.alert("Mod baca sahaja — clock out atau tunggu drawer baharu.");
    return;
  }
  showModal(
    "Buka drawer",
    "<p class=\"ops-muted\" style=\"margin:0 0 0.75rem\">Tunai permulaan dalam laci sebelum jualan.</p>" +
      '<label class="rc-filters__pay" style="margin:0"><span style="font-size:0.65rem;font-weight:700;text-transform:uppercase;color:var(--text-muted)">Tunai awal (RM)</span></label>' +
      '<input type="number" id="mod-open-cash" min="0" step="0.01" value="100" class="rc-input" style="width:100%;padding:0.55rem;margin-top:0.35rem" />',
    "<button type=\"button\" class=\"rc-btn rc-btn--line\" id=\"mod-cancel\">Batal</button>" +
      "<button type=\"button\" class=\"rc-btn rc-btn--solid rc-btn--shift-open\" id=\"mod-confirm\">Sahkan</button>"
  );
}

function handleCashIn() {
  if (!requireClockInForLaci()) return;
  if (!canUseFinancialControls() && !canBypassStaffRestrictions()) return;
  showModal(
    "Tunai masuk",
    '<label class="rc-filters__pay" style="margin:0 0 0.25rem"><span style="font-size:0.65rem;font-weight:700;text-transform:uppercase;color:var(--text-muted)">Amaun (RM)</span></label>' +
      '<input type="number" id="mod-amt" min="0" step="0.01" class="rc-input" style="width:100%;padding:0.55rem;margin-bottom:0.65rem" />' +
      '<label class="rc-filters__pay" style="margin:0 0 0.25rem"><span style="font-size:0.65rem;font-weight:700;text-transform:uppercase;color:var(--text-muted)">Nota</span></label>' +
      '<input type="text" id="mod-note" class="rc-input" style="width:100%;padding:0.55rem" />',
    "<button type=\"button\" class=\"rc-btn rc-btn--line\" id=\"mod-ci-x\">Batal</button>" +
      "<button type=\"button\" class=\"rc-btn rc-btn--solid\" id=\"mod-ci-ok\">Rekod</button>"
  );
}

function handleCashOut() {
  if (!requireClockInForLaci()) return;
  if (!canUseFinancialControls() && !canBypassStaffRestrictions()) return;
  showModal(
    "Tunai keluar",
    '<label class="rc-filters__pay" style="margin:0 0 0.25rem"><span style="font-size:0.65rem;font-weight:700;text-transform:uppercase;color:var(--text-muted)">Amaun (RM)</span></label>' +
      '<input type="number" id="mod-amt-o" min="0" step="0.01" class="rc-input" style="width:100%;padding:0.55rem;margin-bottom:0.65rem" />' +
      '<label class="rc-filters__pay" style="margin:0 0 0.25rem"><span style="font-size:0.65rem;font-weight:700;text-transform:uppercase;color:var(--text-muted)">Sebab</span></label>' +
      '<input type="text" id="mod-note-o" class="rc-input" style="width:100%;padding:0.55rem" />',
    "<button type=\"button\" class=\"rc-btn rc-btn--line\" id=\"mod-co-x\">Batal</button>" +
      "<button type=\"button\" class=\"rc-btn rc-btn--solid\" id=\"mod-co-ok\">Rekod</button>"
  );
}

function handleShiftClose() {
  var st0 = getPosHubState();
  if (!isClockedIn() && !(st0.shift && st0.shift.isOpen)) {
    window.alert("Sila clock in dahulu. Kawalan laci tunai dan drawer hanya dibuka selepas clock in.");
    return;
  }
  var st = getPosHubState();
  if (!st.shift.isOpen) {
    window.alert("Tiada drawer aktif.");
    return;
  }
  var exp = getExpectedDrawerCash();
  var br = getShiftSalesBreakdown();
  showModal(
    "Tutup drawer — ringkasan",
    "<p class=\"ops-muted\" style=\"margin:0 0 0.65rem\">Sahkan kiraan tunai sebelum tutup.</p>" +
      '<dl class="rc-dl" style="margin-bottom:0.75rem">' +
      "<dt>Jualan drawer</dt><dd><strong>" +
      formatRM(br.total) +
      "</strong></dd>" +
      "<dt>Jangkaan laci</dt><dd><strong>" +
      formatRM(exp) +
      "</strong></dd>" +
      "<dt>Tunai</dt><dd><strong>" +
      formatRM(br.cash) +
      "</strong></dd>" +
      "<dt>QR</dt><dd><strong>" +
      formatRM(br.duitnow) +
      "</strong></dd>" +
      "</dl>" +
      '<label class="rc-filters__pay" style="margin:0 0 0.25rem"><span style="font-size:0.65rem;font-weight:700;text-transform:uppercase;color:var(--text-muted)">Kiraan tunai sebenar dalam laci (RM)</span></label>' +
      '<input type="number" id="mod-act" min="0" step="0.01" class="rc-input" style="width:100%;padding:0.55rem;margin-bottom:0.65rem" />' +
      '<label class="rc-filters__pay" style="margin:0 0 0.25rem"><span style="font-size:0.65rem;font-weight:700;text-transform:uppercase;color:var(--text-muted)">Catatan bayaran balik (pilihan)</span></label>' +
      '<textarea id="mod-close-refund" rows="2" class="rc-textarea"></textarea>',
    "<button type=\"button\" class=\"rc-btn rc-btn--line\" id=\"mod-cl-x\">Batal</button>" +
      "<button type=\"button\" class=\"rc-btn rc-btn--solid rc-btn--shift-close\" id=\"mod-cl-ok\">Tutup drawer</button>"
  );
}

async function onModalFootClick(e) {
  var t = e.target;
  if (!(t instanceof HTMLElement)) return;
  var id = t.id;
  if (id === "mod-cancel" || id === "mod-ci-x" || id === "mod-co-x" || id === "mod-cl-x") {
    hideModal();
    return;
  }
  if (id === "mod-confirm") {
    if (!requireClockInForLaci()) return;
    var v = parseFloat(document.getElementById("mod-open-cash").value) || 0;
    var act = getActorForAudit();
    var auth = { userId: act.userId, userName: act.userName, role: act.role, ownerBypass: !!canBypassStaffRestrictions() };
    var res = await shiftOpen(v, auth);
    if (!res.ok) {
      window.alert(res.error);
      hideModal();
      renderShiftPanelUI(getPosHubState());
      return;
    }
    clearManagerPinFailures();
    notifyShiftOpenedClearReadOnly();
    hideModal();
    renderShiftPanelUI(getPosHubState());
    return;
  }
  if (id === "mod-ci-ok") {
    if (!requireClockInForLaci()) return;
    var amt = parseFloat(document.getElementById("mod-amt").value) || 0;
    var note = document.getElementById("mod-note").value;
    var res = await shiftCashMovement("in", amt, note, getActorForAudit());
    if (!res.ok) window.alert(res.error);
    hideModal();
    renderShiftPanelUI(getPosHubState());
    return;
  }
  if (id === "mod-co-ok") {
    if (!requireClockInForLaci()) return;
    var amtO = parseFloat(document.getElementById("mod-amt-o").value) || 0;
    var noteO = document.getElementById("mod-note-o").value;
    var resO = await shiftCashMovement("out", amtO, noteO, getActorForAudit());
    if (!resO.ok) window.alert(resO.error);
    hideModal();
    renderShiftPanelUI(getPosHubState());
    return;
  }
  if (id === "mod-cl-ok") {
    var stPre = getPosHubState();
    if (!isClockedIn() && !(stPre.shift && stPre.shift.isOpen)) {
      window.alert("Sila clock in dahulu. Kawalan laci tunai dan drawer hanya dibuka selepas clock in.");
      return;
    }
    var actual = parseFloat(document.getElementById("mod-act").value);
    var refund = document.getElementById("mod-close-refund").value;
    var act = getActorForAudit();
    var resC = await shiftClose({
      actualCount: actual,
      refundNotes: refund,
      ownerBypass: canBypassStaffRestrictions(),
      actor: act
    });
    if (!resC.ok) {
      window.alert(resC.error);
      return;
    }
    clearManagerPinFailures();
    if (!canBypassStaffRestrictions()) notifyShiftClosedForStaff();
    window.alert(
      "Drawer ditutup.\nJangkaan laci: " +
        formatRM(resC.closing.expectedDrawer) +
        "\nSebenar: " +
        formatRM(resC.closing.actualDrawer) +
        "\nVarians: " +
        formatRM(resC.closing.variance)
    );
    hideModal();
    renderShiftPanelUI(getPosHubState());
  }
}

export function bindShiftPanelDelegation(container) {
  if (!container || container.dataset.kbShiftDelegBound) return;
  container.dataset.kbShiftDelegBound = "1";
  container.addEventListener("click", function (e) {
    var btn = e.target && e.target.closest ? e.target.closest("button") : null;
    if (!btn || !container.contains(btn)) return;
    var bid = btn.id;
    if (bid === "btn-shift-open") {
      e.preventDefault();
      handleShiftOpen();
      return;
    }
    if (bid === "btn-cash-in") {
      e.preventDefault();
      handleCashIn();
      return;
    }
    if (bid === "btn-cash-out") {
      e.preventDefault();
      handleCashOut();
      return;
    }
    if (bid === "btn-shift-close") {
      e.preventDefault();
      handleShiftClose();
      return;
    }
  });
}

export function bindShiftModalRoot() {
  var m = document.getElementById("kb-shift-modal");
  if (!m) return;
  if (m.dataset.kbModalBound) return;
  m.dataset.kbModalBound = "1";
  var bd = document.getElementById("kb-shift-modal-bd");
  var x = document.getElementById("kb-shift-modal-x");
  var foot = document.getElementById("kb-shift-modal-foot");
  if (bd) {
    bd.addEventListener("click", function (ev) {
      if (ev.target === bd) hideModal();
    });
  }
  if (x) {
    x.addEventListener("click", hideModal);
  }
  if (foot) {
    foot.addEventListener("click", onModalFootClick);
  }
}

export function ensureShiftPanelHubSync() {
  if (hubBound) return;
  hubBound = true;
  subscribePosHub(function (state) {
    renderShiftPanelUI(state);
  });
  subscribeRbac(function () {
    renderShiftPanelUI(getPosHubState());
  });
}
