import { redirectIfPosPageWithoutAuth } from "./pos-page-auth.js";
await redirectIfPosPageWithoutAuth();

import {
  subscribePosHub,
  getPosHubState,
  paymentMethodLabel,
  normalizePaymentMethod,
  voidReceiptInHub,
  refundReceiptInHub,
  removeVoidedReceiptFromHub
} from "./pos-operations-hub.js";
import {
  subscribeRbac,
  canBypassStaffRestrictions,
  canAccessOperationalModules,
  canUseFinancialControls,
  isReadOnlyMode,
  getActorForAudit,
  recordManagerPinFailure,
  clearManagerPinFailures,
  isPinLocked
} from "./pos-rbac-session.js";
import { PROTOTYPE_MANAGER_PIN } from "./pos-security-constants.js";
import { t as tr, onLocaleChange } from "./i18n/locale.js";

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

function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, "&#39;");
}

var selectedReceiptNo = null;

function fmtReceiptTime(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("ms-MY", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch (e) {
    return "—";
  }
}

function lineTotalReceipt(l) {
  if (typeof l.lineTotal === "number" && !isNaN(l.lineTotal)) return l.lineTotal;
  var up = typeof l.unitPrice === "number" ? l.unitPrice : parseFloat(l.unitPrice);
  var q = typeof l.qty === "number" ? l.qty : parseFloat(l.qty);
  if (!isNaN(up) && !isNaN(q)) return Math.round(up * q * 100) / 100;
  return NaN;
}

function renderRbacBanner() {
  var el = document.getElementById("rc-rbac-banner");
  if (!el) return;
  if (canBypassStaffRestrictions()) {
    el.hidden = true;
    el.setAttribute("hidden", "");
    el.textContent = "";
    return;
  }
  if (!canAccessOperationalModules()) {
    el.hidden = false;
    el.removeAttribute("hidden");
    el.textContent = tr("receipt.banner.readOnlyStaff");
    return;
  }
  if (isReadOnlyMode()) {
    el.hidden = false;
    el.removeAttribute("hidden");
    el.textContent = tr("receipt.banner.drawerClosed");
    return;
  }
  if (!canUseFinancialControls()) {
    el.hidden = false;
    el.removeAttribute("hidden");
    el.textContent = tr("receipt.banner.drawerNotOpen");
    return;
  }
  el.hidden = true;
  el.setAttribute("hidden", "");
  el.textContent = "";
}

function applyReceiptFiltersGates() {
  // Resit ialah rekod sejarah (baca sahaja) — carian/penapis sentiasa dibenarkan.
  // Tindakan ubah (void/refund/padam) kekal dikawal oleh voidAllowed().
  var search = document.getElementById("rc-search");
  var pay = document.getElementById("rc-filter-pay");
  if (search) search.disabled = false;
  if (pay) pay.disabled = false;
}

function filteredReceipts(state) {
  var q = (document.getElementById("rc-search") && document.getElementById("rc-search").value.trim().toLowerCase()) || "";
  var pf = (document.getElementById("rc-filter-pay") && document.getElementById("rc-filter-pay").value) || "";
  return state.receipts.filter(function (r) {
    if (pf && normalizePaymentMethod(r.paymentMethod) !== pf) return false;
    if (!q) return true;
    var blob = (r.receiptNo + " " + (r.orderNo || "") + " " + (r.orderId || "")).toLowerCase();
    return blob.indexOf(q) !== -1;
  });
}

function renderReceiptList(state) {
  var el = document.getElementById("rc-list");
  var cnt = document.getElementById("rc-count");
  if (!el) return;

  // Senarai resit ialah data sejarah (baca sahaja) dan sentiasa boleh dilihat oleh
  // mana-mana pengguna POS yang sah — termasuk semasa belum clock in atau syif ditutup.
  // (Dahulu disekat penuh oleh canAccessOperationalModules(), menyebabkan resit "hilang".)
  var rows = filteredReceipts(state);
  if (cnt) {
    cnt.textContent =
      rows.length === 0
        ? tr("receipt.count.none")
        : rows.length === 1
          ? tr("receipt.count.one")
          : rows.length + tr("receipt.count.suffix");
  }
  if (!rows.length) {
    el.innerHTML = '<p class="rc-empty">' + tr("receipt.list.empty") + "</p>";
    return;
  }
  el.innerHTML = rows
    .map(function (r) {
      var stClass = r.voided ? " rc-receipt-row--void" : "";
      var pill = r.voided
        ? '<span class="rc-tag rc-tag--void">' + escapeHtml(tr("receipt.tag.void")) + "</span>"
        : '<span class="rc-tag">' + escapeHtml(tr("receipt.tag.valid")) + "</span>";
      var meta = fmtReceiptTime(r.createdAt) + " · " + paymentMethodLabel(r.paymentMethod);
      return (
        '<button type="button" class="rc-receipt-row' +
        stClass +
        '" data-receipt="' +
        escapeAttr(r.receiptNo) +
        '">' +
        '<div class="rc-receipt-row__main">' +
        '<span class="rc-receipt-row__no">' +
        escapeHtml(r.receiptNo) +
        "</span>" +
        '<span class="rc-receipt-row__meta">' +
        escapeHtml(meta) +
        "</span></div>" +
        '<div class="rc-receipt-row__aside">' +
        '<span class="rc-receipt-row__amt">' +
        formatRM(r.subtotal) +
        "</span>" +
        pill +
        "</div></button>"
      );
    })
    .join("");
  el.querySelectorAll(".rc-receipt-row[data-receipt]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      selectedReceiptNo = btn.getAttribute("data-receipt");
      openDrawer(getPosHubState());
    });
  });
}

function voidAllowed() {
  return (canUseFinancialControls() || canBypassStaffRestrictions()) && !isReadOnlyMode();
}

function openDrawer(state) {
  var r = state.receipts.find(function (x) {
    return x.receiptNo === selectedReceiptNo;
  });
  var back = document.getElementById("rc-drawer-back");
  var dr = document.getElementById("rc-drawer");
  var body = document.getElementById("rc-drawer-body");
  var subEl = document.getElementById("rc-drawer-sub");
  if (!r || !back || !dr || !body) return;
  if (subEl) {
    subEl.textContent = r.receiptNo;
  }
  var linesUl =
    r.lines && r.lines.length
      ? "<ul>" +
        r.lines
          .map(function (l) {
            var lt = lineTotalReceipt(l);
            var amtStr = !isNaN(lt) ? formatRM(lt) : "—";
            return (
              "<li>" +
              escapeHtml(String(l.name || "").trim() || tr("receipt.item.unnamed")) +
              " × " +
              escapeHtml(String(l.qty != null ? l.qty : "")) +
              " — " +
              amtStr +
              "</li>"
            );
          })
          .join("") +
        "</ul>"
      : "<p class=\"ops-muted\" style=\"margin:0;font-size:0.82rem\">" +
        escapeHtml(tr("receipt.detail.noLines")) +
        "</p>";

  var voidDis = r.voided || !voidAllowed();
  var refundDis = r.voided || r.refunded || !voidAllowed();
  var padamRow =
    r.voided && voidAllowed()
      ? '<div class="rc-drawer-delete"><button type="button" class="rc-btn rc-btn--line rc-btn--sm" id="rc-delete">' +
        escapeHtml(tr("receipt.action.delete")) +
        "</button></div>"
      : "";
  body.innerHTML =
    '<div class="rc-detail-hero">' +
    '<span class="rc-detail-hero__label">' +
    escapeHtml(tr("receipt.detail.total")) +
    "</span>" +
    '<span class="rc-detail-hero__amt">' +
    formatRM(r.subtotal) +
    "</span></div>" +
    '<dl class="rc-dl">' +
    "<dt>" +
    escapeHtml(tr("receipt.detail.time")) +
    "</dt><dd>" +
    escapeHtml(fmtReceiptTime(r.createdAt)) +
    "</dd>" +
    "<dt>" +
    escapeHtml(tr("receipt.detail.payment")) +
    "</dt><dd>" +
    escapeHtml(paymentMethodLabel(r.paymentMethod)) +
    "</dd>" +
    "<dt>" +
    escapeHtml(tr("receipt.detail.customer")) +
    "</dt><dd>" +
    escapeHtml(String(r.customerName || "").trim() || "—") +
    "</dd>" +
    "<dt>" +
    escapeHtml(tr("receipt.detail.saleId")) +
    "</dt><dd style=\"word-break:break-all\">" +
    escapeHtml(r.saleId || "—") +
    "</dd>" +
    "</dl>" +
    '<div class="rc-detail-lines">' +
    '<p class="rc-detail-lines__title">' +
    escapeHtml(tr("receipt.detail.items")) +
    "</p>" +
    linesUl +
    "</div>" +
    '<div class="rc-drawer-actions rc-drawer-actions--split">' +
    '<button type="button" class="rc-btn rc-btn--line rc-btn--drawer" id="rc-print"><i class="fa-solid fa-print" aria-hidden="true"></i> ' +
    escapeHtml(tr("receipt.action.print")) +
    "</button>" +
    '<button type="button" class="rc-btn rc-btn--solid rc-btn--drawer rc-btn--void" id="rc-void"' +
    (voidDis ? " disabled" : "") +
    '><i class="fa-solid fa-ban" aria-hidden="true"></i> ' +
    escapeHtml(tr("receipt.action.void")) +
    "</button>" +
    '<button type="button" class="rc-btn rc-btn--drawer rc-btn--refund js-refund-receipt" id="rc-refund" ' +
    'data-no="' +
    escapeAttr(r.receiptNo) +
    '" data-subtotal="' +
    r.subtotal +
    '" data-pm="' +
    escapeAttr(r.paymentMethod) +
    '"' +
    (refundDis ? " disabled" : "") +
    '><i class="fa-solid fa-rotate-left" aria-hidden="true"></i> ' +
    escapeHtml(tr("receipt.action.refund")) +
    "</button>" +
    "</div>" +
    padamRow;

  back.classList.add("is-open");
  dr.classList.add("is-open");
  back.setAttribute("aria-hidden", "false");
  dr.setAttribute("aria-hidden", "false");

  var close = function () {
    back.classList.remove("is-open");
    dr.classList.remove("is-open");
    back.setAttribute("aria-hidden", "true");
    dr.setAttribute("aria-hidden", "true");
  };
  document.getElementById("rc-drawer-close").onclick = close;
  back.onclick = function (e) {
    if (e.target === back) close();
  };
  document.getElementById("rc-print").onclick = function () {
    window.print();
  };
  document.getElementById("rc-void").onclick = function () {
    void promptVoid(r.receiptNo, close);
  };
  var delBtn = document.getElementById("rc-delete");
  if (delBtn) {
    delBtn.onclick = async function () {
      if (
        !window.confirm(
          tr("receipt.delete.confirmPrefix") + r.receiptNo + tr("receipt.delete.confirmSuffix")
        )
      ) {
        return;
      }
      var res = await removeVoidedReceiptFromHub(r.receiptNo, getActorForAudit());
      if (!res.ok) {
        window.alert(res.error);
        return;
      }
      close();
      renderAll(getPosHubState());
    };
  }
}

async function promptVoid(receiptNo, closeDrawer) {
  if (!voidAllowed()) {
    window.alert(tr("receipt.void.unavailable"));
    return;
  }
  var act = getActorForAudit();
  var res;
  if (canBypassStaffRestrictions()) {
    if (!window.confirm(tr("receipt.void.ownerOverride"))) return;
    res = await voidReceiptInHub(receiptNo, { ownerBypass: true, actor: act });
  } else {
    if (isPinLocked()) {
      window.alert(tr("receipt.void.pinLocked"));
      return;
    }
    var pin = window.prompt(tr("receipt.void.pinPrompt") + PROTOTYPE_MANAGER_PIN + "):", "");
    if (pin == null) return;
    res = await voidReceiptInHub(receiptNo, { pin: pin, actor: act });
    if (!res.ok) recordManagerPinFailure({ message: "Void PIN fail" });
    else clearManagerPinFailures();
  }
  if (!res.ok) {
    window.alert(res.error);
    return;
  }
  window.alert(tr("receipt.void.done"));
  if (closeDrawer) closeDrawer();
  renderAll(getPosHubState());
}

var refundModal = {
  receiptNo: null,
  subtotal: 0,
  paymentMethod: "cash"
};

function closeReceiptDrawerUI() {
  var back = document.getElementById("rc-drawer-back");
  var dr = document.getElementById("rc-drawer");
  if (back) {
    back.classList.remove("is-open");
    back.setAttribute("aria-hidden", "true");
  }
  if (dr) {
    dr.classList.remove("is-open");
    dr.setAttribute("aria-hidden", "true");
  }
}

function setRefundStatus(text, kind) {
  var el = document.getElementById("refund-status");
  if (!el) return;
  if (!text) {
    el.textContent = "";
    el.className = "kb-status kb-status--hidden";
    return;
  }
  el.textContent = text;
  el.className = kind === "ok" ? "kb-status kb-status--ok" : "kb-status kb-status--error";
}

function refundMethodLabel(paymentMethod) {
  return paymentMethod === "cash" || paymentMethod === "tunai"
    ? tr("receipt.refund.pmCash")
    : tr("receipt.refund.pmQr");
}

function openRefundModal(receiptNo, subtotal, paymentMethod) {
  if (!voidAllowed()) {
    window.alert(tr("receipt.refund.unavailable"));
    return;
  }
  refundModal.receiptNo = receiptNo;
  refundModal.subtotal = subtotal;
  refundModal.paymentMethod = paymentMethod;

  var modal = document.getElementById("refund-modal");
  if (!modal) return;

  document.getElementById("refund-receipt-no").textContent = receiptNo;
  document.getElementById("refund-amount").textContent = "RM " + (parseFloat(subtotal) || 0).toFixed(2);
  document.getElementById("refund-pm").textContent = refundMethodLabel(paymentMethod);
  document.getElementById("refund-note").value = "";
  setRefundStatus("", null);

  modal.hidden = false;
  modal.removeAttribute("hidden");
  modal.setAttribute("aria-hidden", "false");
}

function closeRefundModal() {
  var modal = document.getElementById("refund-modal");
  if (modal) {
    modal.hidden = true;
    modal.setAttribute("hidden", "");
    modal.setAttribute("aria-hidden", "true");
  }
}

async function processRefund() {
  var note = document.getElementById("refund-note").value.trim() || tr("receipt.refund.defaultNote");
  var confirmBtn = document.getElementById("btn-refund-confirm");

  if (!voidAllowed()) {
    setRefundStatus(tr("receipt.refund.needDrawer"), "error");
    return;
  }

  confirmBtn.disabled = true;
  confirmBtn.textContent = tr("receipt.refund.processing");
  setRefundStatus("", null);

  try {
    var actor = getActorForAudit();
    var result = await refundReceiptInHub(refundModal.receiptNo, {
      ownerBypass: canBypassStaffRestrictions(),
      actor: actor,
      refundNote: note
    });

    if (!result.ok) {
      setRefundStatus(result.error, "error");
      return;
    }

    var msg = result.cashRefunded
      ? tr("receipt.refund.okCashPrefix") +
        (parseFloat(refundModal.subtotal) || 0).toFixed(2) +
        tr("receipt.refund.okCashSuffix")
      : tr("receipt.refund.okQr");

    setRefundStatus(msg, "ok");
    closeReceiptDrawerUI();
    renderAll(getPosHubState());
    setTimeout(closeRefundModal, 2000);
  } catch (err) {
    setRefundStatus(
      tr("receipt.refund.errorPrefix") + (err && err.message ? err.message : String(err)),
      "error"
    );
  } finally {
    confirmBtn.disabled = false;
    confirmBtn.textContent = tr("receipt.refund.confirm");
  }
}

/** Butang sahkan refund ditulis semula oleh JS semasa memproses, jadi labelnya diurus di sini. */
function renderRefundChrome() {
  var confirmBtn = document.getElementById("btn-refund-confirm");
  if (confirmBtn && !confirmBtn.disabled) confirmBtn.textContent = tr("receipt.refund.confirm");
  var modal = document.getElementById("refund-modal");
  var pm = document.getElementById("refund-pm");
  if (modal && !modal.hidden && pm && refundModal.receiptNo) {
    pm.textContent = refundMethodLabel(refundModal.paymentMethod);
  }
}

function renderAll(state) {
  renderRbacBanner();
  applyReceiptFiltersGates();
  renderReceiptList(state);
  renderRefundChrome();
}

function wire() {
  document.getElementById("rc-search").addEventListener("input", function () {
    renderAll(getPosHubState());
  });
  document.getElementById("rc-filter-pay").addEventListener("change", function () {
    renderAll(getPosHubState());
  });

  document.addEventListener("click", function (e) {
    var btn = e.target && e.target.closest ? e.target.closest(".js-refund-receipt") : null;
    if (!btn || btn.disabled) return;
    openRefundModal(
      btn.getAttribute("data-no"),
      parseFloat(btn.getAttribute("data-subtotal")) || 0,
      btn.getAttribute("data-pm") || "cash"
    );
  });

  var refundConfirm = document.getElementById("btn-refund-confirm");
  if (refundConfirm) refundConfirm.addEventListener("click", processRefund);
  var refundCancel = document.getElementById("btn-refund-cancel");
  if (refundCancel) refundCancel.addEventListener("click", closeRefundModal);
  var refundCloseX = document.getElementById("btn-refund-close");
  if (refundCloseX) refundCloseX.addEventListener("click", closeRefundModal);
  var refundBack = document.getElementById("refund-modal");
  if (refundBack) {
    refundBack.addEventListener("click", function (e) {
      if (e.target === refundBack) closeRefundModal();
    });
  }

  subscribePosHub(function (state) {
    renderAll(state);
  });
  subscribeRbac(function () {
    renderAll(getPosHubState());
  });

  // Teks statik disapu oleh applyI18n; di sini kita render semula bahagian yang
  // dibina oleh JS — termasuk butiran resit jika drawer sedang terbuka.
  onLocaleChange(function () {
    renderAll(getPosHubState());
    var dr = document.getElementById("rc-drawer");
    if (dr && dr.classList.contains("is-open") && selectedReceiptNo) {
      openDrawer(getPosHubState());
    }
  });
}

wire();
