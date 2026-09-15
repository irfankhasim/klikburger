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
  canUseFinancialControls,
  canOpenCashDrawer,
  isReadOnlyMode,
  getActorForAudit,
  clearManagerPinFailures,
  notifyShiftClosedForStaff,
  notifyShiftOpenedClearReadOnly
} from "./pos-rbac-session.js";
// Fail ini sudah guna `t` sebagai pembolehubah sasaran peristiwa, jadi import sebagai `tr`.
import { t as tr, onLocaleChange } from "./i18n/locale.js";
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
  window.alert(tr("shift.alert.clockInFirst"));
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

/**
 * Templat statik panel. Teks ditulis melalui tr() supaya betul sebaik dipasang
 * (panel ini disuntik selepas applyI18n awal berjalan), dan ditanda data-i18n
 * supaya applyI18n menyapunya semula bila bahasa bertukar. Elemen yang teksnya
 * ditulis oleh renderShiftPanelUI() sengaja TIDAK ditanda.
 */
export function getShiftPanelHtml() {
  return (
    '<div id="kb-shift-shell" class="kb-shift-shell">' +
    '<section class="rc-shift rc-shift--compact kb-shift-panel" aria-labelledby="kb-shift-heading">' +
    '<p id="kb-shift-heading" class="ops-card__title">' +
    escapeHtml(tr("clock.card.drawer")) +
    "</p>" +
    '<div class="rc-shift-bar">' +
    '<div class="rc-shift-bar__top">' +
    '<span id="rc-shift-pill" class="rc-shift-pill" aria-live="polite"></span>' +
    '<p id="shift-status-line" class="rc-shift-line"></p>' +
    "</div>" +
    '<div class="rc-shift-bar__metrics" role="group" aria-label="' +
    escapeHtml(tr("shift.metricsLabel")) +
    '" data-i18n-aria-label="shift.metricsLabel">' +
    '<div class="rc-mini-metric">' +
    '<span class="rc-mini-metric__lbl" data-i18n="shift.metric.opening">' +
    escapeHtml(tr("shift.metric.opening")) +
    "</span>" +
    '<strong id="shift-opening-cash" class="rc-mini-metric__val">—</strong>' +
    "</div>" +
    '<div class="rc-mini-metric">' +
    '<span class="rc-mini-metric__lbl" data-i18n="shift.metric.drawer">' +
    escapeHtml(tr("shift.metric.drawer")) +
    "</span>" +
    '<strong id="shift-expected" class="rc-mini-metric__val">—</strong>' +
    "</div>" +
    '<div class="rc-mini-metric">' +
    '<span class="rc-mini-metric__lbl" data-i18n="shift.metric.sales">' +
    escapeHtml(tr("shift.metric.sales")) +
    "</span>" +
    '<strong id="shift-sales-total" class="rc-mini-metric__val">RM 0.00</strong>' +
    "</div>" +
    '<div class="rc-mini-metric rc-mini-metric--wide">' +
    '<span class="rc-mini-metric__lbl" data-i18n="shift.metric.byPayment">' +
    escapeHtml(tr("shift.metric.byPayment")) +
    "</span>" +
    '<div id="shift-pay-chips" class="rc-pay-chips"></div>' +
    "</div>" +
    "</div>" +
    '<div class="rc-shift-bar__actions">' +
    '<button type="button" class="rc-btn rc-btn--solid rc-btn--action rc-btn--shift-open" id="btn-shift-open" title="' +
    escapeHtml(tr("shift.action.open")) +
    '" data-i18n-title="shift.action.open">' +
    '<i class="fa-solid fa-door-open" aria-hidden="true"></i> <span data-i18n="shift.action.open">' +
    escapeHtml(tr("shift.action.open")) +
    "</span>" +
    "</button>" +
    '<button type="button" class="rc-btn rc-btn--line rc-btn--action" id="btn-cash-in" title="' +
    escapeHtml(tr("shift.action.cashIn")) +
    '" data-i18n-title="shift.action.cashIn">' +
    '<i class="fa-solid fa-arrow-down" aria-hidden="true"></i> <span data-i18n="shift.action.cashIn">' +
    escapeHtml(tr("shift.action.cashIn")) +
    "</span>" +
    "</button>" +
    '<button type="button" class="rc-btn rc-btn--line rc-btn--action" id="btn-cash-out" title="' +
    escapeHtml(tr("shift.action.cashOut")) +
    '" data-i18n-title="shift.action.cashOut">' +
    '<i class="fa-solid fa-arrow-up" aria-hidden="true"></i> <span data-i18n="shift.action.cashOut">' +
    escapeHtml(tr("shift.action.cashOut")) +
    "</span>" +
    "</button>" +
    '<button type="button" class="rc-btn rc-btn--solid rc-btn--action rc-btn--shift-close" id="btn-shift-close" title="' +
    escapeHtml(tr("shift.action.close")) +
    '" data-i18n-title="shift.action.close">' +
    '<i class="fa-solid fa-lock" aria-hidden="true"></i> <span data-i18n="shift.action.close">' +
    escapeHtml(tr("shift.action.close")) +
    "</span>" +
    "</button>" +
    "</div>" +
    "</div>" +
    "</section>" +
    '<details class="rc-notes rc-notes--compact kb-shift-log-tunai">' +
    '<summary data-i18n="shift.log.summary">' +
    escapeHtml(tr("shift.log.summary")) +
    "</summary>" +
    '<span class="rc-shift-details__label" data-i18n="shift.log.label">' +
    escapeHtml(tr("shift.log.label")) +
    "</span>" +
    '<div id="shift-movements" class="rc-shift-details__body"></div>' +
    "</details>" +
    "</div>"
  );
}

function applyShiftActionGates(state) {
  var sh = state.shift;
  var bypass = canBypassStaffRestrictions();
  var clockedIn = isClockedIn();
  var fin = clockedIn && (canUseFinancialControls() || bypass);
  var ro = isReadOnlyMode() && !bypass;

  function setDis(id, dis) {
    var b = document.getElementById(id);
    if (b) b.disabled = !!dis;
  }

  var btnOpen = document.getElementById("btn-shift-open");
  if (btnOpen) {
    btnOpen.hidden = !!sh.isOpen;
    btnOpen.disabled = sh.isOpen ? true : !clockedIn || ro || !canOpenCashDrawer();
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
  chips.innerHTML = chip(tr("shift.pay.cash"), b.cash) + chip(tr("shift.pay.qr"), b.qr);
}

export function renderShiftPanelUI(state) {
  if (!document.getElementById("shift-status-line")) return;

  var sh = state.shift;
  var pill = document.getElementById("rc-shift-pill");
  var line = document.getElementById("shift-status-line");
  var exp = document.getElementById("shift-expected");
  var tot = document.getElementById("shift-sales-total");
  var openEl = document.getElementById("shift-opening-cash");
  var movEl = document.getElementById("shift-movements");
  if (!line || !exp || !tot || !movEl) return;

  if (pill) {
    if (sh.isOpen) {
      pill.textContent = tr("shift.pill.open");
      pill.className = "rc-shift-pill rc-shift-pill--open";
    } else if (sh.closing) {
      pill.textContent = tr("shift.pill.closed");
      pill.className = "rc-shift-pill rc-shift-pill--done";
    } else {
      pill.textContent = tr("shift.pill.notOpen");
      pill.className = "rc-shift-pill";
    }
  }

  if (sh.isOpen) {
    var sid = sh.shiftId ? String(sh.shiftId).slice(-10) : "—";
    line.textContent =
      fmtShortClock(sh.openedAt) +
      " · " +
      sid +
      " · " +
      tr("shift.line.float") +
      " " +
      formatRM(typeof sh.openingCash === "number" ? sh.openingCash : 0);
  } else if (sh.closing) {
    line.textContent =
      tr("shift.line.variancePrefix") +
      " " +
      formatRM(sh.closing.variance) +
      (sh.closing.variance < 0
        ? " " + tr("shift.line.varianceShort")
        : sh.closing.variance > 0
          ? " " + tr("shift.line.varianceOver")
          : "");
  } else {
    line.textContent = tr("shift.line.idle");
  }

  exp.textContent = sh.isOpen ? formatRM(getExpectedDrawerCash()) : "—";
  if (openEl) {
    openEl.textContent = sh.isOpen
      ? formatRM(typeof sh.openingCash === "number" ? sh.openingCash : 0)
      : "—";
  }
  var b = getShiftSalesBreakdown();
  tot.textContent = formatRM(b.total);
  renderPayChips(b);

  if (!sh.movements || !sh.movements.length) {
    movEl.textContent = tr("shift.movements.empty");
  } else {
    movEl.innerHTML =
      "<ul style=\"margin:0;padding-left:1.1rem\">" +
      sh.movements
        .map(function (m) {
          return (
            "<li>" +
            escapeHtml(new Date(m.at).toLocaleString("ms-MY", { hour: "2-digit", minute: "2-digit" })) +
            " — " +
            escapeHtml(m.type === "out" ? tr("shift.movement.out") : tr("shift.movement.in")) +
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
  if (isReadOnlyMode() && !canBypassStaffRestrictions()) {
    window.alert(tr("shift.alert.readOnly"));
    return;
  }
  if (!canOpenCashDrawer()) {
    window.alert(tr("shift.alert.cashierOnly"));
    return;
  }
  var stOpen = getPosHubState();
  var lastOpen =
    typeof stOpen.shift.openingCash === "number" ? stOpen.shift.openingCash : 100;
  showModal(
    tr("shift.action.open"),
    "<p class=\"ops-muted\">" +
      escapeHtml(tr("shift.open.lead")) +
      "</p>" +
      "<p class=\"ops-muted\"><strong>" +
      escapeHtml(tr("shift.open.yours")) +
      "</strong></p>" +
      '<div class="ops-field">' +
      '<label class="rc-filters__pay" for="mod-open-cash"><span>' +
      escapeHtml(tr("shift.open.amount")) +
      "</span></label>" +
      '<input type="number" id="mod-open-cash" min="0" step="0.01" value="' +
      escapeHtml(String(lastOpen)) +
      '" class="rc-input" />' +
      "</div>",
    "<button type=\"button\" class=\"rc-btn rc-btn--line\" id=\"mod-cancel\">" +
      escapeHtml(tr("shift.modal.cancel")) +
      "</button>" +
      "<button type=\"button\" class=\"rc-btn rc-btn--solid rc-btn--shift-open\" id=\"mod-confirm\">" +
      escapeHtml(tr("shift.modal.confirm")) +
      "</button>"
  );
}

function handleCashIn() {
  if (!requireClockInForLaci()) return;
  if (!canUseFinancialControls() && !canBypassStaffRestrictions()) return;
  showModal(
    tr("shift.action.cashIn"),
    '<div class="ops-field">' +
      '<label class="rc-filters__pay" for="mod-amt"><span>' +
      escapeHtml(tr("shift.field.amount")) +
      "</span></label>" +
      '<input type="number" id="mod-amt" min="0" step="0.01" class="rc-input" />' +
      "</div>" +
      '<div class="ops-field">' +
      '<label class="rc-filters__pay" for="mod-note"><span>' +
      escapeHtml(tr("shift.field.note")) +
      "</span></label>" +
      '<input type="text" id="mod-note" class="rc-input" />' +
      "</div>",
    "<button type=\"button\" class=\"rc-btn rc-btn--line\" id=\"mod-ci-x\">" +
      escapeHtml(tr("shift.modal.cancel")) +
      "</button>" +
      "<button type=\"button\" class=\"rc-btn rc-btn--solid\" id=\"mod-ci-ok\">" +
      escapeHtml(tr("shift.modal.record")) +
      "</button>"
  );
}

function handleCashOut() {
  if (!requireClockInForLaci()) return;
  if (!canUseFinancialControls() && !canBypassStaffRestrictions()) return;
  showModal(
    tr("shift.action.cashOut"),
    '<div class="ops-field">' +
      '<label class="rc-filters__pay" for="mod-amt-o"><span>' +
      escapeHtml(tr("shift.field.amount")) +
      "</span></label>" +
      '<input type="number" id="mod-amt-o" min="0" step="0.01" class="rc-input" />' +
      "</div>" +
      '<div class="ops-field">' +
      '<label class="rc-filters__pay" for="mod-note-o"><span>' +
      escapeHtml(tr("shift.field.reason")) +
      "</span></label>" +
      '<input type="text" id="mod-note-o" class="rc-input" />' +
      "</div>",
    "<button type=\"button\" class=\"rc-btn rc-btn--line\" id=\"mod-co-x\">" +
      escapeHtml(tr("shift.modal.cancel")) +
      "</button>" +
      "<button type=\"button\" class=\"rc-btn rc-btn--solid\" id=\"mod-co-ok\">" +
      escapeHtml(tr("shift.modal.record")) +
      "</button>"
  );
}

function handleShiftClose() {
  var st0 = getPosHubState();
  if (!isClockedIn() && !(st0.shift && st0.shift.isOpen)) {
    window.alert(tr("shift.alert.clockInFirst"));
    return;
  }
  var st = getPosHubState();
  if (!st.shift.isOpen) {
    window.alert(tr("shift.alert.noDrawer"));
    return;
  }
  var stClose = getPosHubState();
  var opening = typeof stClose.shift.openingCash === "number" ? stClose.shift.openingCash : 0;
  var br = getShiftSalesBreakdown();
  var expFull = getExpectedDrawerCash();
  var expSimple = Math.round((opening + br.cash) * 100) / 100;
  showModal(
    tr("shift.close.title"),
    "<p class=\"ops-muted\">" +
      escapeHtml(tr("shift.close.lead")) +
      "</p>" +
      '<dl class="ops-cash-sheet">' +
      "<dt>" +
      escapeHtml(tr("shift.close.opening")) +
      "</dt><dd><strong>" +
      formatRM(opening) +
      "</strong></dd>" +
      "<dt>" +
      escapeHtml(tr("shift.close.cashSales")) +
      "</dt><dd>" +
      formatRM(br.cash) +
      "</dd>" +
      "<dt>" +
      escapeHtml(tr("shift.close.qrSales")) +
      "</dt><dd>" +
      formatRM(br.qr) +
      "</dd>" +
      "<dt>" +
      escapeHtml(tr("shift.close.expectedSimple")) +
      "</dt><dd>" +
      formatRM(expSimple) +
      "</dd>" +
      "<dt class=\"ops-cash-sheet__emphasis\">" +
      escapeHtml(tr("shift.close.expectedFull")) +
      "</dt><dd class=\"ops-cash-sheet__emphasis\"><strong>" +
      formatRM(expFull) +
      "</strong></dd>" +
      "</dl>" +
      '<div class="ops-field">' +
      '<label class="rc-filters__pay" for="mod-act"><span>' +
      escapeHtml(tr("shift.close.actualCount")) +
      "</span></label>" +
      '<input type="number" id="mod-act" min="0" step="0.01" class="rc-input" />' +
      "</div>" +
      '<p id="mod-diff-live" class="ops-diff-live ops-diff-live--pending">' +
      escapeHtml(tr("shift.close.diffPending")) +
      "</p>" +
      '<div class="ops-field">' +
      '<label class="rc-filters__pay" for="mod-close-refund"><span>' +
      escapeHtml(tr("shift.close.refundNotes")) +
      "</span></label>" +
      '<textarea id="mod-close-refund" rows="2" class="rc-textarea"></textarea>' +
      "</div>",
    "<button type=\"button\" class=\"rc-btn rc-btn--line\" id=\"mod-cl-x\">" +
      escapeHtml(tr("shift.modal.cancel")) +
      "</button>" +
      "<button type=\"button\" class=\"rc-btn rc-btn--solid rc-btn--shift-close\" id=\"mod-cl-ok\">" +
      escapeHtml(tr("shift.action.close")) +
      "</button>"
  );
  var actLive = document.getElementById("mod-act");
  var liveEl = document.getElementById("mod-diff-live");
  function paintLiveDiff() {
    if (!liveEl || !actLive) return;
    var actual = parseFloat(actLive.value);
    if (!isFinite(actual)) {
      liveEl.className = "ops-diff-live ops-diff-live--pending";
      liveEl.textContent = tr("shift.close.diffPending");
      return;
    }
    var diff = Math.round((actual - expFull) * 100) / 100;
    if (Math.abs(diff) < 0.005) {
      liveEl.className = "ops-diff-live ops-diff-live--ok";
      liveEl.textContent = tr("shift.close.diffNone");
    } else if (diff < 0) {
      liveEl.className = "ops-diff-live ops-diff-live--short";
      liveEl.textContent =
        tr("shift.close.diffShort") +
        " " +
        formatRM(Math.abs(diff)) +
        " · " +
        tr("shift.closed.toPayLabel") +
        " " +
        formatRM(Math.abs(diff));
    } else {
      liveEl.className = "ops-diff-live ops-diff-live--over";
      liveEl.textContent = tr("shift.close.diffOver") + " " + formatRM(diff);
    }
  }
  if (actLive) actLive.addEventListener("input", paintLiveDiff);
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
      window.alert(tr("shift.alert.clockInFirst"));
      return;
    }
    var actInput = document.getElementById("mod-act");
    var actual = parseFloat(actInput && actInput.value);
    if (!isFinite(actual)) {
      window.alert(tr("shift.alert.needActual"));
      if (actInput) actInput.focus();
      return;
    }
    var refund = document.getElementById("mod-close-refund").value;
    var act = getActorForAudit();
    if (t instanceof HTMLButtonElement) t.disabled = true;
    var resC;
    try {
      resC = await shiftClose({
        actualCount: actual,
        refundNotes: refund,
        ownerBypass: canBypassStaffRestrictions(),
        actor: act
      });
    } catch (err) {
      console.error(err);
      if (t instanceof HTMLButtonElement) t.disabled = false;
      window.alert(
        tr("shift.alert.closeFailPrefix") + (err && err.message ? err.message : String(err))
      );
      return;
    }
    if (!resC || !resC.ok) {
      if (t instanceof HTMLButtonElement) t.disabled = false;
      window.alert(resC && resC.error ? resC.error : tr("shift.alert.closeFail"));
      return;
    }
    clearManagerPinFailures();
    if (!canBypassStaffRestrictions()) notifyShiftClosedForStaff();
    var v = resC.closing.variance;
    var vLine = tr("shift.close.diffNone");
    if (v < -0.005) vLine = tr("shift.close.diffShort") + " " + formatRM(Math.abs(v));
    else if (v > 0.005) vLine = tr("shift.close.diffOver") + " " + formatRM(v);
    var payLine = "";
    if (resC.closing.amountToBePaid > 0) {
      payLine =
        "\n" +
        tr("shift.closed.toPayLabel") +
        " " +
        formatRM(resC.closing.amountToBePaid);
    }
    window.alert(
      tr("shift.closed.title") +
        "\n" +
        tr("shift.closed.expectedLabel") +
        " " +
        formatRM(resC.closing.expectedDrawer) +
        "\n" +
        tr("shift.closed.actualLabel") +
        " " +
        formatRM(resC.closing.actualDrawer) +
        "\n" +
        vLine +
        payLine
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
  if (bd) {
    bd.addEventListener("click", function (ev) {
      if (ev.target === bd) hideModal();
    });
  }
  if (x) {
    x.addEventListener("click", hideModal);
  }
  // Delegasi pada modal keseluruhan — butang foot dijana semula (innerHTML)
  // setiap kali modal dibuka, jadi delegasi lebih selamat daripada ikat pada foot.
  m.addEventListener("click", function (e) {
    var btn = e.target && e.target.closest ? e.target.closest("button") : null;
    if (!btn || btn.id === "kb-shift-modal-x") return;
    onModalFootClick(e);
  });
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

/**
 * Teks statik panel disapu oleh applyI18n; di sini kita render semula teks yang
 * ditulis oleh JS. renderShiftPanelUI() keluar awal apabila panel belum dipasang,
 * jadi ini tidak melakukan apa-apa di halaman tanpa panel.
 */
onLocaleChange(function () {
  renderShiftPanelUI(getPosHubState());
});
