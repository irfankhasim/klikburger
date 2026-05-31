/**
 * Papan pemuka pemilik — data sebenar Firestore (pos_receipts, pos_orders, pos_audit_logs).
 * Tiada data contoh: keadaan kosong jika tiada rekod atau pengguna belum log masuk.
 */
import {
  db,
  auth,
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  getDocs,
  Timestamp
} from "./firebase/init.js";
import {
  COL_POS_RECEIPTS,
  COL_POS_ORDERS,
  COL_POS_AUDIT
} from "./firebase/collections.js";
import { waitForAuthUser, getPosUserRbacPayload } from "./pos-firebase-auth-bridge.js";

var KB_RESTORE_SS = "fyp_klikburger_restore_v1";
var KB_RESTORE_LS = "fyp_klikburger_restore_ls_v1";

var dashFilterMode = "today";
var dashPickKey = null;
var dashLastTodayKey = "";
var activeCalendarKey = "";
var useRealtimeForScope = true;
var dayUnsubs = [];
var latestBundle = null;
var prevDayTotals = null;
var pendingPrevFetch = null;
var prevDayFetchScheduledFor = "";

function pad2(n) {
  return (n < 10 ? "0" : "") + n;
}

function calendarKeyFromDate(d) {
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
}

function parseCalendarKeyLocal(key) {
  var p = String(key).split("-");
  if (p.length !== 3) return new Date();
  return new Date(+p[0], +p[1] - 1, +p[2]);
}

function addCalendarDaysKey(key, delta) {
  var d = parseCalendarKeyLocal(key);
  d.setDate(d.getDate() + delta);
  return calendarKeyFromDate(d);
}

function todayCalendarKey() {
  return calendarKeyFromDate(new Date());
}

function effectiveCalendarKey() {
  var t = todayCalendarKey();
  if (dashFilterMode === "today") return t;
  if (dashFilterMode === "yesterday") return addCalendarDaysKey(t, -1);
  if (dashFilterMode === "pick") {
    var pk = dashPickKey || t;
    if (pk > t) return t;
    var minK = addCalendarDaysKey(t, -60);
    if (pk < minK) return minK;
    return pk;
  }
  return t;
}

function viewingIsToday() {
  return effectiveCalendarKey() === todayCalendarKey();
}

function dayBoundsForKey(dateKey) {
  var d0 = parseCalendarKeyLocal(dateKey);
  var start = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate(), 0, 0, 0, 0);
  var end = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() + 1, 0, 0, 0, 0);
  return {
    start: start,
    end: end,
    startMs: start.getTime(),
    endMs: end.getTime(),
    startTs: Timestamp.fromDate(start),
    endTs: Timestamp.fromDate(end)
  };
}

function toMillis(ts) {
  if (!ts) return 0;
  if (typeof ts.toMillis === "function") return ts.toMillis();
  if (typeof ts.toDate === "function") {
    var d = ts.toDate();
    return d && !isNaN(d.getTime()) ? d.getTime() : 0;
  }
  return 0;
}

function $(id) {
  return document.getElementById(id);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function emptyBlock(msg) {
  return '<p class="dash-empty-state" role="status">' + escapeHtml(msg) + "</p>";
}

function formatRM(n) {
  var x = typeof n === "number" && !isNaN(n) ? n : 0;
  return "RM " + x.toLocaleString("ms-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatShortPrevLabel(scopeKey) {
  var prev = addCalendarDaysKey(scopeKey, -1);
  try {
    return parseCalendarKeyLocal(prev).toLocaleDateString("ms-MY", { day: "numeric", month: "short" });
  } catch (e) {
    return "hari sebelumnya";
  }
}

function pillClass(st) {
  if (st === "waiting") return "dash-pill dash-pill--waiting";
  if (st === "preparing") return "dash-pill dash-pill--preparing";
  if (st === "ready") return "dash-pill dash-pill--ready";
  return "dash-pill dash-pill--handed";
}

function pillLabel(st) {
  if (st === "waiting") return "Waiting";
  if (st === "preparing") return "Preparing";
  if (st === "ready") return "Ready";
  return "Handed";
}

function mapKitchenUiStage(data) {
  var stage = String(data.kitchenStage || "waiting");
  var life = String(data.lifecycle || "");
  if (life === "cancelled") return "cancelled";
  if (stage === "handed" || life === "completed") return "handed";
  return stage;
}

function roleTopbarLabel(role) {
  var r = String(role || "").toUpperCase();
  if (r === "CASHIER") return "STAFF";
  if (r === "SHIFT_LEAD") return "SHIFT LEAD";
  if (r === "OWNER") return "OWNER";
  if (r === "ADMIN") return "ADMIN";
  return r || "—";
}

function wireBoHandoff() {
  document.querySelectorAll("a[data-bo-handoff]").forEach(function (a) {
    a.addEventListener("click", function () {
      var raw = a.getAttribute("data-bo-handoff");
      if (!raw) return;
      try {
        var extra = JSON.parse(raw);
        var payload = JSON.stringify(Object.assign({ v: 1 }, extra));
        try {
          sessionStorage.setItem(KB_RESTORE_SS, payload);
        } catch (e1) {}
        try {
          localStorage.setItem(KB_RESTORE_LS, payload);
        } catch (e2) {}
      } catch (err) {}
    });
  });
}

function finishDashBoot() {
  window.requestAnimationFrame(function () {
    window.requestAnimationFrame(function () {
      document.body.classList.remove("kb-dash-boot");
    });
  });
}

function setDashError(msg) {
  var el = $("od-dash-error");
  if (!el) return;
  if (!msg) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.hidden = false;
  el.textContent = msg;
}

function tearDownDayListeners() {
  dayUnsubs.forEach(function (u) {
    try {
      if (typeof u === "function") u();
    } catch (e) {}
  });
  dayUnsubs = [];
  prevDayFetchScheduledFor = "";
}

function receiptQuery(bounds) {
  return query(
    collection(db, COL_POS_RECEIPTS),
    where("createdAt", ">=", bounds.startTs),
    where("createdAt", "<", bounds.endTs),
    orderBy("createdAt", "desc"),
    limit(800)
  );
}

function ordersQuery(bounds) {
  return query(
    collection(db, COL_POS_ORDERS),
    where("paidAt", ">=", bounds.startTs),
    where("paidAt", "<", bounds.endTs),
    orderBy("paidAt", "desc"),
    limit(800)
  );
}

function auditQuery(bounds) {
  return query(
    collection(db, COL_POS_AUDIT),
    where("at", ">=", bounds.startTs),
    where("at", "<", bounds.endTs),
    orderBy("at", "desc"),
    limit(400)
  );
}

function filterVoidedReceiptDocs(docs) {
  return docs.filter(function (d) {
    var x = d.data();
    return !x.voided;
  });
}

function receiptCustomerTotal(x) {
  if (typeof x.total === "number" && !isNaN(x.total)) return x.total;
  var parsed = parseFloat(x.total);
  if (!isNaN(parsed) && parsed > 0) return parsed;
  var sub = typeof x.subtotal === "number" ? x.subtotal : parseFloat(x.subtotal) || 0;
  var tax = typeof x.taxAmount === "number" ? x.taxAmount : parseFloat(x.taxAmount) || 0;
  return Math.round((sub + tax) * 100) / 100;
}

function sumReceiptPreTaxSubtotals(docs) {
  var sum = 0;
  docs.forEach(function (d) {
    var x = d.data();
    var sub = typeof x.subtotal === "number" ? x.subtotal : parseFloat(x.subtotal) || 0;
    sum += sub;
  });
  return Math.round(sum * 100) / 100;
}

function sumReceiptSubtotals(docs) {
  var sum = 0;
  docs.forEach(function (d) {
    sum += receiptCustomerTotal(d.data());
  });
  return Math.round(sum * 100) / 100;
}

function sumReceiptCogs(docs) {
  var sum = 0;
  docs.forEach(function (d) {
    var x = d.data();
    var cog = typeof x.totalCogsFifo === "number" ? x.totalCogsFifo : parseFloat(x.totalCogsFifo) || 0;
    sum += cog;
  });
  return Math.round(sum * 100) / 100;
}

function sumReceiptGrossProfit(docs) {
  var sales = sumReceiptPreTaxSubtotals(docs);
  var cogs = sumReceiptCogs(docs);
  return Math.round((sales - cogs) * 100) / 100;
}

function buildHourlySeries(receiptDocs, bounds) {
  var labels = ["9AM", "10AM", "11AM", "12PM", "1PM", "2PM", "3PM", "4PM", "5PM"];
  var values = labels.map(function () {
    return 0;
  });
  receiptDocs.forEach(function (d) {
    var x = d.data();
    var ms = toMillis(x.createdAt);
    if (ms < bounds.startMs || ms >= bounds.endMs) return;
    var h = new Date(ms).getHours();
    if (h >= 9 && h <= 17) {
      var idx = h - 9;
      values[idx] += receiptCustomerTotal(x);
    }
  });
  values = values.map(function (v) {
    return Math.round(v * 100) / 100;
  });
  return { labels: labels, values: values };
}

function aggregateTopProducts(receiptDocs, bounds) {
  var map = Object.create(null);
  receiptDocs.forEach(function (d) {
    var x = d.data();
    var ms = toMillis(x.createdAt);
    if (ms < bounds.startMs || ms >= bounds.endMs) return;
    var lines = Array.isArray(x.lines) ? x.lines : [];
    lines.forEach(function (ln) {
      var name = (ln && ln.name) || "Item";
      var qty = typeof ln.qty === "number" ? ln.qty : parseFloat(ln.qty) || 0;
      map[name] = (map[name] || 0) + qty;
    });
  });
  var rows = Object.keys(map).map(function (name) {
    return { name: name, raw: map[name] };
  });
  rows.sort(function (a, b) {
    return b.raw - a.raw;
  });
  var top = rows.slice(0, 5);
  var maxC = top.length ? top[0].raw : 0;
  return top.map(function (r, j) {
    return {
      rank: j + 1,
      name: r.name,
      count: String(Math.round(r.raw * 100) / 100) + "×",
      pct: maxC ? Math.round((r.raw / maxC) * 100) : 0
    };
  });
}

function aggregatePayment(receiptDocs, bounds) {
  var tunai = 0;
  var lain = 0;
  receiptDocs.forEach(function (d) {
    var x = d.data();
    var ms = toMillis(x.createdAt);
    if (ms < bounds.startMs || ms >= bounds.endMs) return;
    var pm = String(x.paymentMethod || "cash").toLowerCase();
    if (pm === "cash" || pm === "tunai") tunai += 1;
    else lain += 1;
  });
  var tot = tunai + lain;
  if (!tot) return { tunaiPct: 0, duitnowPct: 0, empty: true };
  return {
    tunaiPct: Math.round((tunai / tot) * 100),
    duitnowPct: Math.round((lain / tot) * 100),
    empty: false
  };
}

function buildDrawerRowsFromAudit(auditDocs, bounds) {
  var cashIn = 0;
  var cashOut = 0;
  auditDocs.forEach(function (d) {
    var x = d.data();
    var ms = toMillis(x.at);
    if (ms < bounds.startMs || ms >= bounds.endMs) return;
    var t = String(x.type || "");
    var meta = x.meta && typeof x.meta === "object" ? x.meta : {};
    var amt = typeof meta.amount === "number" ? meta.amount : parseFloat(meta.amount) || 0;
    if (t === "cash_in") cashIn += amt;
    if (t === "cash_out") cashOut += amt;
  });
  cashIn = Math.round(cashIn * 100) / 100;
  cashOut = Math.round(cashOut * 100) / 100;
  if (cashIn <= 0 && cashOut <= 0) return [];
  return [
    { label: "Tunai masuk (audit)", value: "+RM " + cashIn.toLocaleString("ms-MY") },
    { label: "Tunai keluar (audit)", value: "−RM " + cashOut.toLocaleString("ms-MY") }
  ];
}

function buildAlertsFromOrders(orderDocs, bounds, nowMs) {
  var out = [];
  orderDocs.forEach(function (d) {
    var x = d.data();
    if (String(x.lifecycle || "") === "cancelled") return;
    var stage = String(x.kitchenStage || "");
    if (stage !== "waiting") return;
    var ms = toMillis(x.paidAt || x.createdAt);
    if (ms < bounds.startMs || ms >= bounds.endMs) return;
    if (nowMs - ms > 10 * 60 * 1000) {
      var agoMin = Math.floor((nowMs - ms) / 60000);
      var no = String(x.orderNo || d.id).slice(0, 32);
      out.push({
        type: "amber",
        icon: "fa-solid fa-clock",
        msg: "Order " + no + " masih menunggu dapur — " + agoMin + " min",
        time: "Semak dapur"
      });
    }
  });
  return out;
}

function orderLineSummary(x) {
  var lines = Array.isArray(x.lines) ? x.lines : [];
  if (!lines.length) return "—";
  return lines
    .map(function (ln) {
      var n = (ln && ln.name) || "Item";
      var q = typeof ln.qty === "number" ? ln.qty : parseFloat(ln.qty) || 0;
      return n + " ×" + q;
    })
    .join(", ");
}

function buildOrderCards(orderDocs, bounds) {
  var dayShort = parseCalendarKeyLocal(bounds.dateKey).toLocaleDateString("ms-MY", { day: "numeric", month: "short" });
  return orderDocs
    .filter(function (d) {
      var x = d.data();
      if (String(x.lifecycle || "") === "cancelled") return false;
      var ms = toMillis(x.paidAt || x.createdAt);
      return ms >= bounds.startMs && ms < bounds.endMs;
    })
    .map(function (d) {
      var x = d.data();
      var ms = toMillis(x.paidAt || x.createdAt);
      var tstr = "—";
      try {
        tstr = new Date(ms).toLocaleString("ms-MY", { hour: "2-digit", minute: "2-digit", hour12: true });
      } catch (e) {}
      var ui = mapKitchenUiStage(x);
      if (ui === "cancelled") return null;
      return {
        no: String(x.orderNo || d.id).slice(0, 24),
        items: orderLineSummary(x),
        metaLine: tstr + " · " + dayShort,
        status: ui,
        amt: formatRM(receiptCustomerTotal(x))
      };
    })
    .filter(Boolean);
}

function computeKpiDeltas(sales, orderCount, cogs, profit, prev) {
  var prevLbl = formatShortPrevLabel(activeCalendarKey);
  if (!prev || (prev.sales <= 0 && prev.count <= 0 && sales <= 0 && orderCount <= 0)) {
    return {
      jumlahJualanDelta: "Tiada perbandingan (" + prevLbl + ")",
      jumlahOrderDelta: "Tiada perbandingan (" + prevLbl + ")",
      purataOrderDelta: "Tiada perbandingan",
      cogsDelta: "Tiada perbandingan (" + prevLbl + ")",
      profitDelta: "Tiada perbandingan (" + prevLbl + ")"
    };
  }
  var dSales = prev.sales > 0 ? ((sales - prev.sales) / prev.sales) * 100 : sales > 0 ? 100 : 0;
  var dOrd = orderCount - prev.count;
  var prevAvg = prev.count > 0 ? prev.sales / prev.count : 0;
  var avg = orderCount > 0 ? sales / orderCount : 0;
  var dAvg = avg - prevAvg;
  var prevCogs = typeof prev.cogs === "number" ? prev.cogs : 0;
  var prevProfit = typeof prev.profit === "number" ? prev.profit : prev.sales - prevCogs;
  var dCogs = prevCogs > 0 ? ((cogs - prevCogs) / prevCogs) * 100 : cogs > 0 ? 100 : 0;
  var dProfit = prevProfit > 0 ? ((profit - prevProfit) / prevProfit) * 100 : profit > 0 ? 100 : 0;
  return {
    jumlahJualanDelta: (dSales >= 0 ? "+" : "") + dSales.toFixed(1) + "% vs " + prevLbl,
    jumlahOrderDelta: (dOrd >= 0 ? "+" : "") + dOrd + " order vs " + prevLbl,
    purataOrderDelta: (dAvg >= 0 ? "+" : "−") + "RM " + Math.abs(dAvg).toFixed(2),
    cogsDelta: (dCogs >= 0 ? "+" : "") + dCogs.toFixed(1) + "% vs " + prevLbl,
    profitDelta: (dProfit >= 0 ? "+" : "") + dProfit.toFixed(1) + "% vs " + prevLbl
  };
}

function renderOrdersScope() {
  var el = $("od-orders-scope");
  if (!el || !activeCalendarKey) return;
  var d = parseCalendarKeyLocal(activeCalendarKey);
  el.textContent =
    "· " +
    d.toLocaleDateString("ms-MY", {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric"
    });
}

function syncDateInputBounds() {
  var input = $("od-filter-date");
  if (!input) return;
  var t = todayCalendarKey();
  input.max = t;
  input.min = addCalendarDaysKey(t, -60);
}

function updateFilterDateUi() {
  var input = $("od-filter-date");
  if (!input) return;
  var key = effectiveCalendarKey();
  input.value = key;
  var pick = dashFilterMode === "pick";
  input.disabled = !pick;
  input.setAttribute("aria-disabled", pick ? "false" : "true");
}

function renderOrders(cards) {
  var el = $("od-orders-mount");
  if (!el) return;
  if (!cards || !cards.length) {
    el.innerHTML = emptyBlock("Belum ada pesanan untuk tarikh ini.");
    return;
  }
  el.innerHTML = cards
    .map(function (o) {
      return (
        '<article class="dash-order-card">' +
        '<div class="dash-order-card__top">' +
        '<span class="dash-order-card__no">' +
        escapeHtml(o.no) +
        "</span>" +
        '<span class="dash-order-card__amt">' +
        escapeHtml(o.amt) +
        "</span></div>" +
        '<p class="dash-order-card__items">' +
        escapeHtml(o.items) +
        "</p>" +
        '<div class="dash-order-card__meta"><span class="dash-order-card__ago">' +
        escapeHtml(o.metaLine) +
        '</span><span class="' +
        pillClass(o.status) +
        '">' +
        escapeHtml(pillLabel(o.status)) +
        "</span></div></article>"
      );
    })
    .join("");
}

function renderDrawer(rows) {
  var el = $("od-drawer-mount");
  if (!el) return;
  if (!rows || !rows.length) {
    el.innerHTML = emptyBlock("Tiada rekod tunai (cash in/out) dalam audit untuk tarikh ini.");
    return;
  }
  el.innerHTML = rows
    .map(function (r) {
      var vc = r.valueClass ? ' class="' + r.valueClass + '"' : "";
      return (
        '<div class="dash-drawer-row"><span>' +
        escapeHtml(r.label) +
        "</span><strong" +
        vc +
        ">" +
        escapeHtml(r.value) +
        "</strong></div>"
      );
    })
    .join("");
}

function renderProducts(list) {
  var el = $("od-products-mount");
  if (!el) return;
  if (!list || !list.length) {
    el.innerHTML = emptyBlock("Tiada data produk untuk tempoh ini.");
    return;
  }
  var max = list.length ? list[0].pct : 0;
  el.innerHTML = list
    .map(function (p) {
      var w = max ? Math.round((p.pct / max) * 100) : 0;
      return (
        '<div class="dash-top-item">' +
        '<div class="dash-rank">' +
        p.rank +
        '</div><div class="dash-top-meta" style="flex:1;min-width:0">' +
        '<div class="dash-bar-row__lbl"><span class="dash-top-name">' +
        escapeHtml(p.name) +
        '</span><span class="dash-top-count">' +
        escapeHtml(p.count) +
        '</span></div>' +
        '<div class="dash-bar-track dash-bar-track--tight"><div class="dash-bar-fill" style="width:' +
        w +
        '%"></div></div></div></div>'
      );
    })
    .join("");
}

function renderPayment(pay) {
  var el = $("od-pay-mount");
  if (!el) return;
  if (!pay || pay.empty) {
    el.innerHTML = emptyBlock("Tiada data pembayaran untuk tempoh ini.");
    return;
  }
  var t = pay.tunaiPct;
  var d = pay.duitnowPct;
  el.innerHTML =
    '<div class="dash-bar-row"><div class="dash-bar-row__lbl"><span>Tunai</span><span>' +
    t +
    "%</span></div>" +
    '<div class="dash-bar-track"><div class="dash-bar-fill" style="width:' +
    t +
    '%"></div></div></div>' +
    '<div class="dash-bar-row"><div class="dash-bar-row__lbl"><span>Bukan tunai</span><span>' +
    d +
    "%</span></div>" +
    '<div class="dash-bar-track"><div class="dash-bar-fill dash-bar-fill--blue" style="width:' +
    d +
    '%"></div></div></div>';
}

function renderAlerts(alerts) {
  var el = $("od-alerts-mount");
  if (!el) return;
  if (!alerts || !alerts.length) {
    el.innerHTML = emptyBlock("Tiada amaran atau notis untuk paparan ini.");
    return;
  }
  el.innerHTML = alerts
    .map(function (a) {
      return (
        '<div class="dash-alert dash-alert--' +
        escapeHtml(a.type) +
        '"><i class="' +
        escapeHtml(a.icon) +
        '" aria-hidden="true"></i><div><div>' +
        escapeHtml(a.msg) +
        "</div><time>" +
        escapeHtml(a.time) +
        "</time></div></div>"
      );
    })
    .join("");
}

function applyKpi(payload) {
  var s = $("od-kpi-sales");
  var o = $("od-kpi-orders");
  var cg = $("od-kpi-cogs");
  var pf = $("od-kpi-profit");
  var sd = $("od-kpi-sales-delta");
  var od = $("od-kpi-orders-delta");
  var cd = $("od-kpi-cogs-delta");
  var pd = $("od-kpi-profit-delta");
  if (s) s.textContent = payload.jumlahJualan;
  if (o) o.textContent = payload.jumlahOrder;
  if (cg) cg.textContent = payload.kosBahan;
  if (pf) pf.textContent = payload.untungKasar;
  if (sd) sd.textContent = payload.jumlahJualanDelta;
  if (od) od.textContent = payload.jumlahOrderDelta;
  if (cd) cd.textContent = payload.cogsDelta;
  if (pd) pd.textContent = payload.profitDelta;
}

function renderChart(series) {
  var canvas = $("od-chart-sales");
  if (!canvas || typeof Chart === "undefined") return;
  if (typeof Chart.getChart === "function") {
    var existing = Chart.getChart(canvas);
    if (existing) existing.destroy();
  }
  var sum = (series.values || []).reduce(function (a, b) {
    return a + b;
  }, 0);
  var wrap = canvas.closest(".dash-chart-wrap");
  if (wrap) {
    var old = wrap.querySelector(".dash-empty-state");
    if (old) old.remove();
  }
  if (!sum) {
    if (wrap) wrap.insertAdjacentHTML("beforeend", emptyBlock("Tiada data jualan mengikut jam untuk tarikh ini."));
    return;
  }
  new Chart(canvas.getContext("2d"), {
    type: "line",
    data: {
      labels: series.labels,
      datasets: [
        {
          data: series.values,
          borderColor: "#f5a623",
          backgroundColor: "rgba(245, 166, 35, 0.08)",
          fill: true,
          tension: 0.4,
          pointRadius: 3,
          pointHoverRadius: 5,
          borderWidth: 2
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#ffffff",
          titleColor: "#1a1a1a",
          bodyColor: "#5c5c5c",
          borderColor: "#ddd",
          borderWidth: 1,
          boxPadding: 6
        }
      },
      scales: {
        x: {
          grid: { color: "rgba(0,0,0,0.06)" },
          ticks: { color: "#5c5c5c", maxRotation: 0 }
        },
        y: {
          grid: { color: "rgba(0,0,0,0.06)" },
          ticks: { color: "#5c5c5c" },
          beginAtZero: true
        }
      },
      interaction: { intersect: false, mode: "index" }
    }
  });
}

function renderKpiPeriod() {
  var periodEl = $("od-kpi-period");
  if (!periodEl) return;
  try {
    var key = effectiveCalendarKey();
    var d = parseCalendarKeyLocal(key);
    var shortDate = d.toLocaleDateString("ms-MY", {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric"
    });
    if (viewingIsToday()) {
      periodEl.textContent = "Hari ini · " + shortDate;
    } else {
      periodEl.textContent = "Sejarah · " + shortDate;
    }
  } catch (e2) {
    periodEl.textContent = "—";
  }
}

function renderFromBundle() {
  if (!latestBundle) return;
  var b = latestBundle;
  var bounds = b.bounds;
  var receiptDocs = b.receiptDocs;
  var orderDocs = b.orderDocs;
  var auditDocs = b.auditDocs;
  var goodReceipts = filterVoidedReceiptDocs(receiptDocs);
  var sales = sumReceiptSubtotals(goodReceipts);
  var cogs = sumReceiptCogs(goodReceipts);
  var profit = sumReceiptGrossProfit(goodReceipts);
  var orderCount = goodReceipts.length;
  var deltas = computeKpiDeltas(sales, orderCount, cogs, profit, prevDayTotals);
  applyKpi({
    jumlahJualan: formatRM(sales),
    jumlahOrder: orderCount + " order",
    kosBahan: formatRM(cogs),
    untungKasar: formatRM(profit),
    jumlahJualanDelta: deltas.jumlahJualanDelta,
    jumlahOrderDelta: deltas.jumlahOrderDelta,
    cogsDelta: deltas.cogsDelta,
    profitDelta: deltas.profitDelta
  });
  var hourly = buildHourlySeries(goodReceipts, bounds);
  renderChart(hourly);
  renderProducts(aggregateTopProducts(goodReceipts, bounds));
  renderPayment(aggregatePayment(goodReceipts, bounds));
  renderDrawer(buildDrawerRowsFromAudit(auditDocs, bounds));
  renderAlerts(buildAlertsFromOrders(orderDocs, bounds, Date.now()));
  renderOrdersScope();
  renderOrders(buildOrderCards(orderDocs, bounds));
  renderKpiPeriod();
  updateFilterDateUi();
}

async function fetchPrevDayTotals(prevKey) {
  var bounds = dayBoundsForKey(prevKey);
  try {
    var rq = receiptQuery(bounds);
    var snap = await getDocs(rq);
    var good = filterVoidedReceiptDocs(snap.docs);
    return {
      sales: sumReceiptSubtotals(good),
      cogs: sumReceiptCogs(good),
      profit: sumReceiptGrossProfit(good),
      count: good.length
    };
  } catch (e) {
    return null;
  }
}

function schedulePrevDayFetch(scopeKey) {
  var prevKey = addCalendarDaysKey(scopeKey, -1);
  if (prevDayFetchScheduledFor === scopeKey) return;
  prevDayFetchScheduledFor = scopeKey;
  pendingPrevFetch = prevKey;
  fetchPrevDayTotals(prevKey).then(function (tot) {
    if (pendingPrevFetch !== prevKey) return;
    prevDayTotals = tot;
    renderFromBundle();
  });
}

function processSnapshotDocs(receiptDocs, orderDocs, auditDocs, dateKey) {
  var bounds = Object.assign({ dateKey: dateKey }, dayBoundsForKey(dateKey));
  latestBundle = {
    bounds: bounds,
    receiptDocs: receiptDocs,
    orderDocs: orderDocs,
    auditDocs: auditDocs
  };
  setDashError("");
  renderFromBundle();
  schedulePrevDayFetch(dateKey);
}

function attachDayListeners(dateKey) {
  tearDownDayListeners();
  activeCalendarKey = dateKey;
  var bounds = dayBoundsForKey(dateKey);
  var rQ = receiptQuery(bounds);
  var oQ = ordersQuery(bounds);
  var aQ = auditQuery(bounds);
  var rec = [];
  var ord = [];
  var aud = [];
  function merge() {
    processSnapshotDocs(rec, ord, aud, dateKey);
  }
  dayUnsubs.push(
    onSnapshot(
      rQ,
      function (snap) {
        rec = snap.docs;
        merge();
      },
      function (err) {
        setDashError(err.message || String(err));
      }
    )
  );
  dayUnsubs.push(
    onSnapshot(
      oQ,
      function (snap) {
        ord = snap.docs;
        merge();
      },
      function (err) {
        setDashError(err.message || String(err));
      }
    )
  );
  dayUnsubs.push(
    onSnapshot(
      aQ,
      function (snap) {
        aud = snap.docs;
        merge();
      },
      function (err) {
        setDashError(err.message || String(err));
      }
    )
  );
}

async function loadDayOnce(dateKey) {
  tearDownDayListeners();
  activeCalendarKey = dateKey;
  var bounds = dayBoundsForKey(dateKey);
  try {
    var results = await Promise.all([getDocs(receiptQuery(bounds)), getDocs(ordersQuery(bounds)), getDocs(auditQuery(bounds))]);
    processSnapshotDocs(results[0].docs, results[1].docs, results[2].docs, dateKey);
  } catch (err) {
    setDashError(err.message || String(err));
    latestBundle = {
      bounds: Object.assign({ dateKey: dateKey }, bounds),
      receiptDocs: [],
      orderDocs: [],
      auditDocs: []
    };
    renderFromBundle();
  }
}

function clearInsightPanels() {
  renderProducts([]);
  renderDrawer([]);
  renderPayment({ empty: true });
  renderAlerts([]);
  var canvas = $("od-chart-sales");
  if (canvas && typeof Chart !== "undefined" && typeof Chart.getChart === "function") {
    var existing = Chart.getChart(canvas);
    if (existing) existing.destroy();
  }
  var wrap = canvas && canvas.closest(".dash-chart-wrap");
  if (wrap) {
    var old = wrap.querySelector(".dash-empty-state");
    if (old) old.remove();
    if (canvas) wrap.insertAdjacentHTML("beforeend", emptyBlock("Log masuk diperlukan untuk memuatkan papan pemuka."));
  }
}

function refreshDashboardForScope() {
  var key = effectiveCalendarKey();
  useRealtimeForScope = viewingIsToday();
  syncDateInputBounds();
  updateFilterDateUi();
  if (!auth.currentUser) {
    tearDownDayListeners();
    latestBundle = null;
    activeCalendarKey = key;
    applyKpi({
      jumlahJualan: "—",
      jumlahOrder: "—",
      purataOrder: "—",
      masaTungguAvg: "—",
      jumlahJualanDelta: "Log masuk untuk melihat data.",
      jumlahOrderDelta: "",
      purataOrderDelta: "",
      masaTungguDelta: "",
      waitDeltaMuted: true
    });
    $("od-orders-mount").innerHTML = emptyBlock("Log masuk diperlukan untuk memuatkan papan pemuka.");
    clearInsightPanels();
    renderOrdersScope();
    renderKpiPeriod();
    return;
  }
  if (useRealtimeForScope) {
    attachDayListeners(key);
  } else {
    loadDayOnce(key);
  }
}

function wireDashFilter() {
  var seg = document.querySelector("#od-dash-filter .dash-filter__seg");
  var input = $("od-filter-date");
  if (!seg || !input) return;
  syncDateInputBounds();
  updateFilterDateUi();
  seg.addEventListener("click", function (e) {
    var btn = e.target.closest(".dash-filter__btn");
    if (!btn || !seg.contains(btn)) return;
    var mode = btn.getAttribute("data-dash-mode");
    if (!mode) return;
    dashFilterMode = mode;
    seg.querySelectorAll(".dash-filter__btn").forEach(function (b) {
      b.classList.toggle("is-active", b === btn);
    });
    if (mode === "pick") {
      var t = todayCalendarKey();
      if (!dashPickKey || dashPickKey > t) dashPickKey = addCalendarDaysKey(t, -1);
      input.value = dashPickKey;
    }
    refreshDashboardForScope();
  });
  input.addEventListener("change", function () {
    dashPickKey = input.value || dashPickKey;
    dashFilterMode = "pick";
    seg.querySelectorAll(".dash-filter__btn").forEach(function (b) {
      b.classList.toggle("is-active", b.getAttribute("data-dash-mode") === "pick");
    });
    refreshDashboardForScope();
  });
}

function tickClock() {
  var el = $("od-clock");
  if (el) {
    try {
      el.textContent = new Date().toLocaleString("ms-MY", {
        weekday: "short",
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      });
    } catch (e) {
      el.textContent = new Date().toISOString();
    }
  }
  var tk = todayCalendarKey();
  if (dashLastTodayKey && tk !== dashLastTodayKey && dashFilterMode === "today") {
    refreshDashboardForScope();
  }
  dashLastTodayKey = tk;
  syncDateInputBounds();
  updateFilterDateUi();
  renderKpiPeriod();
}

async function bindTopbarUser() {
  var nameEl = document.querySelector(".dash-user__name");
  var roleEl = document.querySelector(".dash-user__role");
  var avEl = document.querySelector(".dash-user__avatar");
  if (!nameEl || !roleEl || !avEl) return;
  var u = auth.currentUser;
  if (!u) {
    nameEl.textContent = "Tetamu";
    roleEl.textContent = "—";
    avEl.textContent = "?";
    return;
  }
  try {
    var rbac = await getPosUserRbacPayload(u);
    var roleLabel = roleTopbarLabel(rbac.role);
    nameEl.textContent = roleLabel;
    roleEl.textContent = "";
    roleEl.hidden = true;
    avEl.textContent = roleLabel.charAt(0) || "?";
  } catch (e) {
    nameEl.textContent = "STAFF";
    roleEl.textContent = "";
    roleEl.hidden = true;
    avEl.textContent = "S";
  }
}

async function main() {
  wireBoHandoff();
  wireDashFilter();
  dashPickKey = addCalendarDaysKey(todayCalendarKey(), -1);
  dashLastTodayKey = todayCalendarKey();
  syncDateInputBounds();
  updateFilterDateUi();
  renderKpiPeriod();
  tickClock();
  window.setInterval(tickClock, 1000);
  await waitForAuthUser();
  await bindTopbarUser();
  refreshDashboardForScope();
  finishDashBoot();
}

main().catch(function (e) {
  console.error(e);
  setDashError(e.message || String(e));
  finishDashBoot();
});
