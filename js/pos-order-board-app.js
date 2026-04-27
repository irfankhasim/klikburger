import { redirectIfPosPageWithoutAuth } from "./pos-page-auth.js";
await redirectIfPosPageWithoutAuth();

import {
  subscribePosHub,
  getPosHubState,
  updateKitchenStage,
  orderPriorityFlag,
  paymentMethodLabel
} from "./pos-operations-hub.js";
import {
  subscribeRbac,
  canBypassStaffRestrictions,
  canAccessOperationalModules,
  isReadOnlyMode,
  staffLockMessage
} from "./pos-rbac-session.js";

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

function elapsedLabel(iso) {
  if (!iso) return "—";
  var sec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  var m = Math.floor(sec / 60);
  var s = sec % 60;
  if (m >= 60) {
    var h = Math.floor(m / 60);
    m = m % 60;
    return h + "j " + m + "m";
  }
  return m + "m " + s + "s";
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

function ticketCard(o) {
  var pri = orderPriorityFlag(o) ? '<span class="ops-pill ops-pill--pri">Utama</span> ' : "";
  var lines = (o.lines || [])
    .map(function (l) {
      return "<li>" + escapeHtml(l.name) + " × <strong>" + l.qty + "</strong></li>";
    })
    .join("");
  var actions = "";
  var canGo = kitchenMutationsAllowed();
  if (!canGo) {
    actions =
      '<p class="ops-muted" style="margin:0;font-size:0.76rem">' +
      escapeHtml(isReadOnlyMode() ? "Read-only (shift closed)." : staffLockMessage()) +
      "</p>";
  } else if (o.kitchenStage === "waiting") {
    actions =
      '<button type="button" class="ops-btn ops-btn--primary ops-btn--sm js-kb" data-act="prep" data-id="' +
      escapeAttr(o.id) +
      '">Terima → penyediaan</button>';
  } else if (o.kitchenStage === "preparing") {
    actions =
      '<button type="button" class="ops-btn ops-btn--primary ops-btn--sm js-kb" data-act="ready" data-id="' +
      escapeAttr(o.id) +
      '">Tanda siap</button>';
  } else if (o.kitchenStage === "ready") {
    actions =
      '<button type="button" class="ops-btn ops-btn--primary ops-btn--sm js-kb" data-act="hand" data-id="' +
      escapeAttr(o.id) +
      '">Diserahkan</button>';
  }
  return (
    '<article class="ops-ticket" data-order-id="' +
    escapeAttr(o.id) +
    '">' +
    '<div class="ops-ticket__no">' +
    pri +
    escapeHtml(o.orderNo) +
    "</div>" +
    '<p class="ops-ticket__meta"><span class="js-elapsed" data-paid="' +
    escapeHtml(o.paidAt || "") +
    '">' +
    escapeHtml(elapsedLabel(o.paidAt)) +
    "</span> · " +
    payPill(o.paymentMethod) +
    "</p>" +
    '<ul class="ops-ticket__lines">' +
    lines +
    "</ul>" +
    '<div class="ops-ticket__actions">' +
    actions +
    "</div></article>"
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
      var act = btn.getAttribute("data-act");
      try {
        if (act === "prep") await updateKitchenStage(id, "preparing");
        else if (act === "ready") await updateKitchenStage(id, "ready");
        else if (act === "hand") await updateKitchenStage(id, "handed");
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

setInterval(function () {
  document.querySelectorAll(".js-elapsed").forEach(function (el) {
    var paid = el.getAttribute("data-paid");
    el.textContent = elapsedLabel(paid);
  });
}, 1000);

subscribePosHub(function () {
  render();
});
subscribeRbac(function () {
  render();
});
setupAutoSim();
render();
