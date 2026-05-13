import { redirectIfPosPageWithoutAuth } from "../../shared/utils/pos-page-auth.js";
await redirectIfPosPageWithoutAuth();

import {
  subscribePosHub,
  getPosHubState,
  updateKitchenStage,
  paymentMethodLabel
} from "./pos-operations-hub.js";
import {
  subscribeRbac,
  canBypassStaffRestrictions,
  canAccessOperationalModules,
  isReadOnlyMode,
  staffLockMessage
} from "../../shared/utils/pos-rbac-session.js";

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

function payPill(method) {
  var cls = "ops-pill";
  if (method !== "cash") cls += " ops-pill--pri";
  return '<span class="' + cls + '">' + escapeHtml(paymentMethodLabel(method)) + "</span>";
}

function kitchenMutationsAllowed() {
  if (canBypassStaffRestrictions()) return true;
  return canAccessOperationalModules() && !isReadOnlyMode();
}

function lineDisplayTotal(l) {
  var lt = typeof l.lineTotal === "number" ? l.lineTotal : parseFloat(l.lineTotal);
  if (!isNaN(lt) && lt >= 0) return lt;
  var up = typeof l.unitPrice === "number" ? l.unitPrice : parseFloat(l.unitPrice);
  var q = typeof l.qty === "number" ? l.qty : parseFloat(l.qty);
  if (!isNaN(up) && !isNaN(q) && q > 0) return Math.round(up * q * 100) / 100;
  return NaN;
}

function lineItemHtml(l) {
  var qty = l.qty != null ? l.qty : "";
  var namePart =
    '<span class="ops-ticket__line-name">' +
    escapeHtml(l.name || "") +
    " × <strong>" +
    escapeHtml(String(qty)) +
    "</strong></span>";
  var total = lineDisplayTotal(l);
  var pricePart =
    !isNaN(total) && total >= 0
      ? '<span class="ops-ticket__line-price">' + escapeHtml(formatRM(total)) + "</span>"
      : '<span class="ops-ticket__line-price">—</span>';
  return "<li>" + namePart + pricePart + "</li>";
}

function ticketCard(o) {
  var lines = (o.lines || []).map(lineItemHtml).join("");
  var actions = "";
  var canGo = kitchenMutationsAllowed();
  if (!canGo) {
    actions =
      '<p class="ops-muted" style="margin:0;font-size:0.76rem">' +
      escapeHtml(isReadOnlyMode() ? "Read-only (shift closed)." : staffLockMessage()) +
      "</p>";
  } else {
    var nextByStage = { waiting: "preparing", preparing: "ready", ready: "handed" };
    var prevByStage = { preparing: "waiting", ready: "preparing", handed: "ready" };
    var toNext = nextByStage[o.kitchenStage];
    var toPrev = prevByStage[o.kitchenStage];
    var leftBtn =
      '<button type="button" class="ops-btn ops-btn--ghost ops-btn--sm ops-btn--icon" disabled aria-hidden="true">←</button>';
    var rightBtn =
      '<button type="button" class="ops-btn ops-btn--ghost ops-btn--sm ops-btn--icon" disabled aria-hidden="true">→</button>';
    if (toPrev) {
      leftBtn =
        '<button type="button" class="ops-btn ops-btn--primary ops-btn--sm ops-btn--icon js-kb" data-to="' +
        escapeAttr(toPrev) +
        '" data-id="' +
        escapeAttr(o.id) +
        '" aria-label="Alih ke kolum sebelumnya">←</button>';
    }
    if (toNext) {
      rightBtn =
        '<button type="button" class="ops-btn ops-btn--primary ops-btn--sm ops-btn--icon js-kb" data-to="' +
        escapeAttr(toNext) +
        '" data-id="' +
        escapeAttr(o.id) +
        '" aria-label="Alih ke kolum seterusnya">→</button>';
    }
    actions = '<div class="ops-ticket__nav">' + leftBtn + rightBtn + "</div>";
  }
  return (
    '<article class="ops-ticket" data-order-id="' +
    escapeAttr(o.id) +
    '">' +
    '<div class="ops-ticket__no">' +
    escapeHtml(o.orderNo) +
    "</div>" +
    (String(o.customerName || "").trim()
      ? '<p class="ops-ticket__customer" title="' +
        escapeAttr(String(o.customerName).trim()) +
        '">' +
        escapeHtml(String(o.customerName).trim()) +
        "</p>"
      : "") +
    '<p class="ops-ticket__meta">' +
    payPill(o.paymentMethod) +
    "</p>" +
    '<ul class="ops-ticket__lines">' +
    lines +
    "</ul>" +
    '<p class="ops-ticket__total">Jumlah <strong>' +
    escapeHtml(formatRM(typeof o.subtotal === "number" ? o.subtotal : parseFloat(o.subtotal) || 0)) +
    "</strong></p>" +
    '<div class="ops-ticket__actions">' + actions + "</div></article>"
  );
}

function receiptVoidedForOrder(state, o) {
  var r = state.receipts.find(function (x) {
    return x.receiptNo === o.receiptNo;
  });
  return r && r.voided;
}

function columnHtml(title, stageKey, orders, state, extraClass) {
  var list = orders.filter(function (o) {
    if (receiptVoidedForOrder(state, o)) return false;
    return o.kitchenStage === stageKey && o.lifecycle !== "cancelled";
  });
  if (stageKey === "handed") {
    list = list.slice(0, 18);
  }
  return (
    '<div class="ops-kcol ' +
    extraClass +
    '">' +
    '<div class="ops-kcol__head"><span>' +
    escapeHtml(title) +
    '</span><span class="ops-kcol__count">' +
    list.length +
    "</span></div>" +
    '<div class="ops-kcol__body" data-stage="' +
    stageKey +
    '">' +
    list.map(ticketCard).join("") +
    (list.length ? "" : '<p class="ops-muted" style="margin:0.35rem;font-size:0.78rem">Tiada pesanan</p>') +
    "</div></div>"
  );
}

function render() {
  renderBoardRbacBanner();
  var state = getPosHubState();
  var root = document.getElementById("kb-root");
  if (!root) return;
  var orders = state.orders || [];
  root.innerHTML =
    columnHtml("Menunggu", "waiting", orders, state, "ops-kcol--waiting") +
    columnHtml("Penyediaan", "preparing", orders, state, "ops-kcol--prep") +
    columnHtml("Siap", "ready", orders, state, "ops-kcol--ready") +
    columnHtml("Diserahkan", "handed", orders, state, "ops-kcol--handed");
  root.querySelectorAll(".js-kb").forEach(function (btn) {
    btn.addEventListener("click", async function () {
      if (!kitchenMutationsAllowed()) return;
      var id = btn.getAttribute("data-id");
      var to = btn.getAttribute("data-to");
      if (!id || !to) return;
      try {
        await updateKitchenStage(id, to);
      } catch (e) {}
      render();
    });
  });
}

function renderBoardRbacBanner() {
  var el = document.getElementById("kb-board-rbac");
  if (!el) return;
  if (canBypassStaffRestrictions()) {
    el.style.display = "none";
    el.hidden = true;
    el.textContent = "";
    return;
  }
  if (!canAccessOperationalModules()) {
    el.style.display = "block";
    el.hidden = false;
    el.textContent = staffLockMessage();
    return;
  }
  if (isReadOnlyMode()) {
    el.style.display = "block";
    el.hidden = false;
    el.textContent = "Drawer ditutup — papan pesanan dalam mod baca sahaja.";
    return;
  }
  el.style.display = "none";
  el.hidden = true;
  el.textContent = "";
}

var autoTimer = null;
function setupAutoSim() {
  var cb = document.getElementById("kb-auto-sim");
  if (!cb) return;
  cb.addEventListener("change", function () {
    if (autoTimer) {
      clearInterval(autoTimer);
      autoTimer = null;
    }
    if (!cb.checked) return;
    autoTimer = setInterval(function () {
      if (!kitchenMutationsAllowed()) return;
      var st = getPosHubState();
      var waiting = st.orders.filter(function (o) {
        return o.kitchenStage === "waiting" && o.lifecycle !== "cancelled";
      });
      if (waiting.length) {
        void updateKitchenStage(waiting[waiting.length - 1].id, "preparing").then(function () {
          render();
        });
      }
    }, 22000);
  });
}

subscribePosHub(function () {
  render();
});
subscribeRbac(function () {
  render();
});
setupAutoSim();
render();
