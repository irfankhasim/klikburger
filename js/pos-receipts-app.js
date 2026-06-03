import { redirectIfPosPageWithoutAuth } from "./pos-page-auth.js";
await redirectIfPosPageWithoutAuth();

import {
  subscribePosHub,
  getPosHubState,
  paymentMethodLabel,
  normalizePaymentMethod,
  voidReceiptInHub,
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
  isPinLocked,
  staffLockMessage
} from "./pos-rbac-session.js";
import { PROTOTYPE_MANAGER_PIN } from "./pos-security-constants.js";

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
    el.textContent = staffLockMessage();
    return;
  }
  if (isReadOnlyMode()) {
    el.hidden = false;
    el.removeAttribute("hidden");
    el.textContent =
      "Drawer ditutup — skrin ini baca sahaja sehingga anda clock out atau pengurus membuka drawer baharu.";
    return;
  }
  if (!canUseFinancialControls()) {
    el.hidden = false;
    el.removeAttribute("hidden");
    el.textContent =
      "Drawer belum dibuka — void dan kawalan tunai: buka drawer di menu utama, <strong>Clock In / Drawer</strong>.";
    return;
  }
  el.hidden = true;
  el.setAttribute("hidden", "");
  el.textContent = "";
}

function applyReceiptFiltersGates() {
  var bypass = canBypassStaffRestrictions();
  var ops = canAccessOperationalModules() || bypass;
  var search = document.getElementById("rc-search");
  var pay = document.getElementById("rc-filter-pay");
  if (search) search.disabled = !ops && !bypass;
  if (pay) pay.disabled = !ops && !bypass;
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

  if (!canAccessOperationalModules() && !canBypassStaffRestrictions()) {
    if (cnt) cnt.textContent = "0 resit dipaparkan.";
    el.innerHTML = '<p class="rc-empty">' + escapeHtml(staffLockMessage()) + "</p>";
    return;
  }

  var rows = filteredReceipts(state);
  if (cnt) {
    cnt.textContent =
      rows.length === 0 ? "Tiada resit." : rows.length === 1 ? "1 resit." : rows.length + " resit.";
  }
  if (!rows.length) {
    el.innerHTML =
      '<p class="rc-empty">Tiada resit dijumpai. Jualan daripada skrin <strong>Jualan</strong> akan muncul di sini.</p>';
    return;
  }
  el.innerHTML = rows
    .map(function (r) {
      var stClass = r.voided ? " rc-receipt-row--void" : "";
      var pill = r.voided
        ? '<span class="rc-tag rc-tag--void">Batal</span>'
        : '<span class="rc-tag">Sah</span>';
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
        '<span class="rc-receipt-row__order">Pesanan ' +
        escapeHtml(r.orderNo || "—") +
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
    subEl.textContent = r.receiptNo + " · " + (r.orderNo || "");
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
              escapeHtml(String(l.name || "").trim() || "(Item)") +
              " × " +
              escapeHtml(String(l.qty != null ? l.qty : "")) +
              " — " +
              amtStr +
              "</li>"
            );
          })
          .join("") +
        "</ul>"
      : "<p class=\"ops-muted\" style=\"margin:0;font-size:0.82rem\">Tiada baris item.</p>";

  var voidDis = r.voided || !voidAllowed();
  var padamRow =
    r.voided && voidAllowed()
      ? '<div class="rc-drawer-delete"><button type="button" class="rc-btn rc-btn--line rc-btn--sm" id="rc-delete">Padam rekod</button></div>'
      : "";
  body.innerHTML =
    '<div class="rc-detail-hero">' +
    '<span class="rc-detail-hero__label">Jumlah</span>' +
    '<span class="rc-detail-hero__amt">' +
    formatRM(r.subtotal) +
    "</span></div>" +
    '<dl class="rc-dl">' +
    "<dt>Masa</dt><dd>" +
    escapeHtml(fmtReceiptTime(r.createdAt)) +
    "</dd>" +
    "<dt>Bayaran</dt><dd>" +
    escapeHtml(paymentMethodLabel(r.paymentMethod)) +
    "</dd>" +
    "<dt>Nama pelanggan</dt><dd>" +
    escapeHtml(String(r.customerName || "").trim() || "—") +
    "</dd>" +
    "<dt>ID jualan</dt><dd style=\"word-break:break-all\">" +
    escapeHtml(r.saleId || "—") +
    "</dd>" +
    "</dl>" +
    '<div class="rc-detail-lines">' +
    '<p class="rc-detail-lines__title">Item</p>' +
    linesUl +
    "</div>" +
    '<div class="rc-drawer-actions rc-drawer-actions--split">' +
    '<button type="button" class="rc-btn rc-btn--line rc-btn--drawer" id="rc-print"><i class="fa-solid fa-print" aria-hidden="true"></i> Cetak</button>' +
    '<button type="button" class="rc-btn rc-btn--solid rc-btn--drawer rc-btn--void" id="rc-void"' +
    (voidDis ? " disabled" : "") +
    '><i class="fa-solid fa-ban" aria-hidden="true"></i> Void</button>' +
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
          "Padam rekod " +
            r.receiptNo +
            " daripada senarai? Pesanan dapur berkaitan turut dibuang daripada pangkalan data."
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
    window.alert("Void tidak tersedia — buka drawer di menu Clock In / Drawer, atau tunggu keluar mod baca sahaja.");
    return;
  }
  var act = getActorForAudit();
  var res;
  if (canBypassStaffRestrictions()) {
    if (!window.confirm("Owner override — void this receipt? (Audit will record override.)")) return;
    res = await voidReceiptInHub(receiptNo, { ownerBypass: true, actor: act });
  } else {
    if (isPinLocked()) {
      window.alert("PIN dikunci — cuba lagi kemudian.");
      return;
    }
    var pin = window.prompt("Manager PIN (prototype " + PROTOTYPE_MANAGER_PIN + "):", "");
    if (pin == null) return;
    res = await voidReceiptInHub(receiptNo, { pin: pin, actor: act });
    if (!res.ok) recordManagerPinFailure({ message: "Void PIN fail" });
    else clearManagerPinFailures();
  }
  if (!res.ok) {
    window.alert(res.error);
    return;
  }
  window.alert("Resit dibatalkan (audit).");
  if (closeDrawer) closeDrawer();
  renderAll(getPosHubState());
}

function renderAll(state) {
  renderRbacBanner();
  applyReceiptFiltersGates();
  renderReceiptList(state);
}

function wire() {
  document.getElementById("rc-search").addEventListener("input", function () {
    renderAll(getPosHubState());
  });
  document.getElementById("rc-filter-pay").addEventListener("change", function () {
    renderAll(getPosHubState());
  });

  subscribePosHub(function (state) {
    renderAll(state);
  });
  subscribeRbac(function () {
    renderAll(getPosHubState());
  });
}

wire();
