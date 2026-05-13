/**
 * Laporan bulanan — papar / jana / automasi bulan lepas.
 * Tambah ?demo=1 pada URL untuk pratonton UI tanpa Firestore.
 */
import { redirectIfPosPageWithoutAuth } from "./pos-page-auth.js";
await redirectIfPosPageWithoutAuth();

import { db, doc, getDoc, auth } from "./firebase/init.js";
import { COL_MONTHLY_REPORTS } from "./firebase/collections.js";
import { isElevatedRole } from "./pos-rbac-session.js";
import {
  monthDocId,
  lastCompletedCalendarMonthParts,
  generateAndWriteMonthlyReport
} from "./monthly-reports/generate-monthly-report.js";

var MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mac",
  "Apr",
  "Mei",
  "Jun",
  "Jul",
  "Ogs",
  "Sep",
  "Okt",
  "Nov",
  "Dis"
];

var TAB_ORDER = ["sales", "raw", "staff", "company"];

var currentReport = null;
var currentKey = "";
var activeTabId = "sales";

function isDemoMode() {
  try {
    return new URLSearchParams(window.location.search).get("demo") === "1";
  } catch (e) {
    return false;
  }
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

function formatRM(n) {
  var x = typeof n === "number" ? n : parseFloat(n) || 0;
  return "RM " + (Math.round(x * 100) / 100).toFixed(2);
}

function setStatus(msg, kind) {
  var el = $("mr-status");
  if (!el) return;
  if (!msg) {
    el.textContent = "";
    el.classList.add("mr-status--hidden");
    el.classList.remove("mr-status--ok", "mr-status--err");
    return;
  }
  el.classList.remove("mr-status--hidden", "mr-status--ok", "mr-status--err");
  el.textContent = msg;
  if (kind === "err") el.classList.add("mr-status--err");
  else if (kind === "ok") el.classList.add("mr-status--ok");
}

function selectedYearMonth() {
  var yEl = $("mr-year");
  var mEl = $("mr-month");
  var y = yEl ? parseInt(yEl.value, 10) || new Date().getFullYear() : new Date().getFullYear();
  var m = mEl ? parseInt(mEl.value, 10) || 1 : 1;
  return { year: y, month: m };
}

function fillYearMonthSelectors() {
  var yEl = $("mr-year");
  var mEl = $("mr-month");
  if (!yEl || !mEl) return;
  var now = new Date();
  var cy = now.getFullYear();
  yEl.innerHTML = "";
  for (var y = cy; y >= cy - 6; y -= 1) {
    var o = document.createElement("option");
    o.value = String(y);
    o.textContent = String(y);
    yEl.appendChild(o);
  }
  mEl.innerHTML = "";
  for (var mi = 1; mi <= 12; mi += 1) {
    var om = document.createElement("option");
    om.value = String(mi);
    om.textContent = MONTH_LABELS[mi - 1] + " (" + mi + ")";
    mEl.appendChild(om);
  }
  yEl.value = String(cy);
  mEl.value = String(now.getMonth() + 1);
}

/** Data contoh untuk pratonton UI (?demo=1). */
function buildDemoPayload(year, month) {
  return {
    monthKey: monthDocId(year, month),
    calendarYear: year,
    calendarMonth: month,
    generatedAt: null,
    source: "demo_ui",
    actorUid: "",
    sales: {
      posReceiptDocumentsInRange: 24,
      nonVoidReceiptCount: 22,
      voidedReceiptCount: 2,
      grossSalesSubtotalRm: 4680.5,
      totalCogsFifoRm: 1820.25,
      grossProfitRm: 2860.25,
      byPaymentMethodRm: { cash: 2100, card: 2280.5, qr: 300 },
      legacyColSalesDocumentCount: 0,
      legacyColSalesSubtotalRm: 0
    },
    rawMaterials: {
      purchaseHistoryDocumentCount: 5,
      purchaseHistoryTotalRm: 920,
      purchaseTop: [
        { id: "demo-ph-1", totalAmountRm: 340, supplier: "Pembekal A", notes: "" },
        { id: "demo-ph-2", totalAmountRm: 280, supplier: "Pembekal B", notes: "" }
      ],
      ingredientLedgerEntriesInRange: 18,
      ledgerSpendInitialPurchaseAdjustRm: 880,
      ledgerKindCounts: { purchase: 12, initial: 4, price_adjust: 2 },
      topIngredientsByLedgerSpendRm: [
        { ingredientId: "ing1", name: "Daging lembu", entryCount: 4, ledgerSpendRm: 420 },
        { ingredientId: "ing2", name: "Roti burger", entryCount: 6, ledgerSpendRm: 210 }
      ],
      ingredientsCatalogCount: 24,
      boundsNote: "Contoh demo — bukan data sebenar."
    },
    staffSalary: {
      note: "Contoh: hourly × 160 atau bulanan mengikut tetapan staf.",
      staffCount: 4,
      activeStaffPayrollEstimateRm: 4120,
      lines: [
        {
          staffId: "s1",
          name: "Aina",
          role: "cashier",
          employmentStatus: "active",
          payType: "hourly",
          payAmount: 12,
          estimatedMonthlySalaryRm: 1920
        },
        {
          staffId: "s2",
          name: "Riz",
          role: "kitchen",
          employmentStatus: "active",
          payType: "monthly",
          payAmount: 2200,
          estimatedMonthlySalaryRm: 2200
        },
        {
          staffId: "s3",
          name: "Sam",
          role: "supervisor",
          employmentStatus: "leave",
          payType: "hourly",
          payAmount: 14,
          estimatedMonthlySalaryRm: 2240
        }
      ]
    },
    company: {
      revenuePosReceiptsRm: 4680.5,
      costOfGoodsFifoRm: 1820.25,
      grossProfitRm: 2860.25,
      inventoryPurchasesRecordedRm: 920,
      payrollEstimateRm: 4120,
      otherExpensesRm: 0,
      netOperatingEstimateRm: -2179.75,
      includesLegacySalesCollection: false,
      narrative:
        "Ini contoh demo. Apabila data sebenar disambungkan, angka dijana daripada resit POS, belian stok, dan anggaran gaji."
    }
  };
}

function formatGeneratedAt(data) {
  var g = data && data.generatedAt;
  if (!g) return "—";
  try {
    if (typeof g.toDate === "function") return g.toDate().toLocaleString("ms-MY");
  } catch (e) {}
  return "—";
}

function renderMetrics(rows) {
  return (
    '<div class="mr-metrics">' +
    rows
      .map(function (r) {
        return (
          '<div class="mr-metric">' +
          '<span class="mr-metric__label">' +
          escapeHtml(r.label) +
          "</span>" +
          '<span class="mr-metric__val">' +
          r.html +
          "</span></div>"
        );
      })
      .join("") +
    "</div>"
  );
}

function renderSalesPanel(d) {
  var s = d.sales || {};
  var rows = [
    { label: "Resit (bukan void)", html: escapeHtml(String(s.nonVoidReceiptCount != null ? s.nonVoidReceiptCount : "—")) },
    { label: "Resit void", html: escapeHtml(String(s.voidedReceiptCount != null ? s.voidedReceiptCount : "—")) },
    { label: "Jumlah jualan (POS)", html: escapeHtml(formatRM(s.grossSalesSubtotalRm)) },
    { label: "COGS (FIFO)", html: escapeHtml(formatRM(s.totalCogsFifoRm)) },
    { label: "Untung kasar", html: escapeHtml(formatRM(s.grossProfitRm)) }
  ];
  var by = s.byPaymentMethodRm || {};
  var payRows = Object.keys(by)
    .sort()
    .map(function (k) {
      return "<tr><td>" + escapeHtml(k) + "</td><td>" + escapeHtml(formatRM(by[k])) + "</td></tr>";
    })
    .join("");
  var legacy =
    (s.legacyColSalesDocumentCount || 0) > 0
      ? "<p class=\"mr-note\">Terdapat <strong>" +
        escapeHtml(String(s.legacyColSalesDocumentCount)) +
        "</strong> rekod lama dalam koleksi <code>sales</code> (jumlah " +
        escapeHtml(formatRM(s.legacyColSalesSubtotalRm)) +
        ") — rujukan silang; jualan utama dari <code>pos_receipts</code>.</p>"
      : "";
  return (
    renderMetrics(rows) +
    '<div class="mr-table-wrap"><table class="mr-table"><thead><tr><th>Kaedah bayaran</th><th>Jumlah</th></tr></thead><tbody>' +
    (payRows || "<tr><td colspan=\"2\">Tiada data</td></tr>") +
    "</tbody></table></div>" +
    legacy
  );
}

function renderRawPanel(d) {
  var r = d.rawMaterials || {};
  var rows1 = [
    { label: "Belian (purchase_history)", html: escapeHtml(formatRM(r.purchaseHistoryTotalRm)) },
    { label: "Bil dokumen belian", html: escapeHtml(String(r.purchaseHistoryDocumentCount != null ? r.purchaseHistoryDocumentCount : "—")) },
    {
      label: "Lejar (initial/purchase/adjust) RM",
      html: escapeHtml(formatRM(r.ledgerSpendInitialPurchaseAdjustRm))
    },
    { label: "Entri lejar dalam julat", html: escapeHtml(String(r.ingredientLedgerEntriesInRange != null ? r.ingredientLedgerEntriesInRange : "—")) }
  ];
  var pt = (r.purchaseTop || [])
    .map(function (x) {
      return (
        "<tr><td>" +
        escapeHtml(x.id) +
        "</td><td>" +
        escapeHtml(formatRM(x.totalAmountRm)) +
        "</td><td>" +
        escapeHtml(x.supplier || "—") +
        "</td></tr>"
      );
    })
    .join("");
  var ing = (r.topIngredientsByLedgerSpendRm || [])
    .map(function (x) {
      return (
        "<tr><td>" +
        escapeHtml(x.name || x.ingredientId) +
        "</td><td>" +
        escapeHtml(String(x.entryCount)) +
        "</td><td>" +
        escapeHtml(formatRM(x.ledgerSpendRm)) +
        "</td></tr>"
      );
    })
    .join("");
  return (
    renderMetrics(rows1) +
    "<h3>Belian tertinggi</h3>" +
    '<div class="mr-table-wrap"><table class="mr-table"><thead><tr><th>ID</th><th>Jumlah</th><th>Pembekal</th></tr></thead><tbody>' +
    (pt || "<tr><td colspan=\"3\">Tiada</td></tr>") +
    "</tbody></table></div>" +
    "<h3>Bahan — perbelanjaan lejar</h3>" +
    '<div class="mr-table-wrap"><table class="mr-table"><thead><tr><th>Bahan</th><th>Bil entri</th><th>RM (pakej)</th></tr></thead><tbody>' +
    (ing || "<tr><td colspan=\"3\">Tiada</td></tr>") +
    "</tbody></table></div>" +
    '<p class="mr-note">' +
    escapeHtml(
      r.boundsNote ||
        "Anggaran peringkat bahan: gabungan purchase_history + entri lejar (bukan penggunaan resipi sebenar bulan ini)."
    ) +
    "</p>"
  );
}

function renderStaffPanel(d) {
  var s = d.staffSalary || {};
  var lines = s.lines || [];
  var body = lines
    .map(function (x) {
      return (
        "<tr><td>" +
        escapeHtml(x.name) +
        "</td><td>" +
        escapeHtml(x.role || "—") +
        "</td><td>" +
        escapeHtml(x.employmentStatus || "—") +
        "</td><td>" +
        escapeHtml(x.payType || "—") +
        "</td><td>" +
        escapeHtml(formatRM(x.payAmount)) +
        "</td><td>" +
        escapeHtml(formatRM(x.estimatedMonthlySalaryRm)) +
        "</td></tr>"
      );
    })
    .join("");
  return (
    renderMetrics([
      {
        label: "Anggaran gaji (aktif sahaja)",
        html: escapeHtml(formatRM(s.activeStaffPayrollEstimateRm))
      },
      { label: "Bil rekod staf", html: escapeHtml(String(lines.length)) }
    ]) +
    '<p class="mr-note">' +
    escapeHtml(s.note || "") +
    "</p>" +
    '<div class="mr-table-wrap"><table class="mr-table"><thead><tr><th>Nama</th><th>Peranan</th><th>Status</th><th>Jenis gaji</th><th>Amaun asas</th><th>Anggaran /bln</th></tr></thead><tbody>' +
    (body || "<tr><td colspan=\"6\">Tiada kakitangan</td></tr>") +
    "</tbody></table></div>"
  );
}

function renderCompanyPanel(d) {
  var c = d.company || {};
  var rows = [
    { label: "Hasil (resit POS)", html: escapeHtml(formatRM(c.revenuePosReceiptsRm)) },
    { label: "COGS", html: escapeHtml(formatRM(c.costOfGoodsFifoRm)) },
    { label: "Untung kasar", html: escapeHtml(formatRM(c.grossProfitRm)) },
    { label: "Beli stok (purchase_history)", html: escapeHtml(formatRM(c.inventoryPurchasesRecordedRm)) },
    { label: "Anggaran gaji", html: escapeHtml(formatRM(c.payrollEstimateRm)) },
    { label: "Lain (manual)", html: escapeHtml(formatRM(c.otherExpensesRm)) },
    { label: "Operasi bersih (anggapan)", html: escapeHtml(formatRM(c.netOperatingEstimateRm)) }
  ];
  return (
    renderMetrics(rows) +
    '<p class="mr-note">' +
    escapeHtml(c.narrative || "") +
    "</p>"
  );
}

function updateTabPanelsVisibility() {
  document.querySelectorAll(".mr-tab").forEach(function (b) {
    var id = b.getAttribute("data-tab") || "sales";
    var on = id === activeTabId;
    b.classList.toggle("is-active", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
    b.setAttribute("tabindex", on ? "0" : "-1");
  });
  TAB_ORDER.forEach(function (id) {
    var p = $("mr-panel-" + id);
    if (p) p.hidden = id !== activeTabId;
  });
}

function setActiveTab(name) {
  activeTabId = name && TAB_ORDER.indexOf(name) >= 0 ? name : "sales";
  updateTabPanelsVisibility();
}

function renderEmpty() {
  var demoHint = isDemoMode()
    ? ""
    : ' Atau tambah <code class="mr-code">?demo=1</code> pada URL untuk data contoh.';
  var msg =
    '<p class="mr-panel__empty">Tiada laporan tersimpan untuk <strong>' +
    escapeHtml(currentKey) +
    "</strong>. Tekan <strong>Muat laporan</strong> selepas data tersedia, atau <strong>Jana / Jana semula</strong> (pemilik / pentadbir)." +
    demoHint +
    "</p>";
  TAB_ORDER.forEach(function (id) {
    var p = $("mr-panel-" + id);
    if (p) p.innerHTML = msg;
  });
  updateTabPanelsVisibility();
}

function renderAllPanels() {
  if (!currentReport) {
    renderEmpty();
    return;
  }
  var d = currentReport;
  var head =
    '<p class="mr-note" style="margin-top:0">Kunci: <code class="mr-code">' +
    escapeHtml(currentKey) +
    "</code> · Dijana: " +
    escapeHtml(formatGeneratedAt(d)) +
    " · Sumber: " +
    escapeHtml(String(d.source || "—")) +
    "</p>";
  var ps = $("mr-panel-sales");
  var pr = $("mr-panel-raw");
  var pf = $("mr-panel-staff");
  var pc = $("mr-panel-company");
  if (ps) ps.innerHTML = head + renderSalesPanel(d);
  if (pr) pr.innerHTML = head + renderRawPanel(d);
  if (pf) pf.innerHTML = head + renderStaffPanel(d);
  if (pc) pc.innerHTML = head + renderCompanyPanel(d);
  updateTabPanelsVisibility();
}

async function loadReport() {
  if (!$("mr-year") || !$("mr-month")) return;
  var sel = selectedYearMonth();
  currentKey = monthDocId(sel.year, sel.month);
  setStatus("Memuatkan…", null);

  if (isDemoMode()) {
    currentReport = buildDemoPayload(sel.year, sel.month);
    setStatus("Mod demo: data contoh (URL mengandungi ?demo=1).", "ok");
    renderAllPanels();
    return;
  }

  try {
    var snap = await getDoc(doc(db, COL_MONTHLY_REPORTS, currentKey));
    if (!snap.exists()) {
      currentReport = null;
      setStatus("Tiada laporan untuk " + currentKey + ".", null);
      renderEmpty();
      return;
    }
    currentReport = snap.data();
    setStatus("Laporan dimuatkan.", "ok");
    renderAllPanels();
  } catch (e) {
    console.error(e);
    currentReport = null;
    setStatus(e.message || String(e), "err");
    renderEmpty();
  }
}

async function onGenerate() {
  if (!isDemoMode() && !isElevatedRole()) {
    window.alert("Hanya pemilik / pentadbir boleh menjana laporan.");
    return;
  }
  var sel = selectedYearMonth();
  var now = new Date();
  if (sel.year > now.getFullYear() || (sel.year === now.getFullYear() && sel.month > now.getMonth() + 1)) {
    window.alert("Bulan hadapan tidak boleh dijana.");
    return;
  }

  if (isDemoMode()) {
    setStatus("Mod demo — laporan contoh dikemas kini (tiada simpanan pelayan).", "ok");
    currentReport = buildDemoPayload(sel.year, sel.month);
    currentKey = monthDocId(sel.year, sel.month);
    renderAllPanels();
    return;
  }

  var btn = $("mr-generate");
  setStatus("Menjana laporan (boleh ambil masa jika data banyak)…", null);
  if (btn) btn.disabled = true;
  try {
    await generateAndWriteMonthlyReport(sel.year, sel.month, {
      source: "user_regenerate",
      actorUid: auth.currentUser ? auth.currentUser.uid : ""
    });
    setStatus("Laporan " + monthDocId(sel.year, sel.month) + " disimpan.", "ok");
    await loadReport();
  } catch (e) {
    console.error(e);
    setStatus(e.message || String(e), "err");
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function maybeAutoGenerateLastMonth() {
  if (isDemoMode()) return;
  if (!isElevatedRole()) return;
  var last = lastCompletedCalendarMonthParts(new Date());
  var key = monthDocId(last.year, last.month);
  try {
    if (sessionStorage.getItem("kb_mr_autogen_ok_" + key) === "1") return;
    var snap = await getDoc(doc(db, COL_MONTHLY_REPORTS, key));
    if (snap.exists()) {
      sessionStorage.setItem("kb_mr_autogen_ok_" + key, "1");
      return;
    }
    await generateAndWriteMonthlyReport(last.year, last.month, {
      source: "auto_month_close",
      actorUid: auth.currentUser ? auth.currentUser.uid : ""
    });
    sessionStorage.setItem("kb_mr_autogen_ok_" + key, "1");
    setStatus("Laporan automatik untuk " + key + " telah dijana.", "ok");
    var sel = selectedYearMonth();
    if (monthDocId(sel.year, sel.month) === key) await loadReport();
  } catch (e) {
    console.warn("Auto monthly report:", e);
  }
}

function wireTabs() {
  var tablist = document.querySelector(".mr-tabs");
  if (!tablist) return;
  tablist.querySelectorAll(".mr-tab").forEach(function (btn) {
    btn.addEventListener("click", function () {
      setActiveTab(btn.getAttribute("data-tab") || "sales");
    });
  });

  tablist.addEventListener("keydown", function (e) {
    var t = e.target && e.target.closest && e.target.closest(".mr-tab");
    if (!t || !tablist.contains(t)) return;
    var key = e.key;
    var tabs = TAB_ORDER.map(function (id) {
      return tablist.querySelector('.mr-tab[data-tab="' + id + '"]');
    }).filter(Boolean);
    var cur = TAB_ORDER.indexOf(activeTabId);
    if (cur < 0) cur = 0;
    var next = cur;
    if (key === "ArrowRight") next = (cur + 1) % TAB_ORDER.length;
    else if (key === "ArrowLeft") next = (cur - 1 + TAB_ORDER.length) % TAB_ORDER.length;
    else if (key === "Home") next = 0;
    else if (key === "End") next = TAB_ORDER.length - 1;
    if (next !== cur) {
      e.preventDefault();
      setActiveTab(TAB_ORDER[next]);
      var nb = tabs[next];
      if (nb) nb.focus();
    }
  });
}

fillYearMonthSelectors();
wireTabs();

var yEl = $("mr-year");
var mEl = $("mr-month");
if (yEl) {
  yEl.addEventListener("change", function () {
    setStatus("", null);
  });
}
if (mEl) {
  mEl.addEventListener("change", function () {
    setStatus("", null);
  });
}

var btnLoad = $("mr-load");
var btnGen = $("mr-generate");
if (btnLoad) btnLoad.addEventListener("click", function () {
  loadReport();
});
if (btnGen) btnGen.addEventListener("click", onGenerate);

if (btnGen && !isElevatedRole() && !isDemoMode()) {
  btnGen.disabled = true;
  btnGen.title = "Jana laporan: pemilik / pentadbir sahaja.";
}

if (isDemoMode() && btnGen) {
  btnGen.disabled = false;
  btnGen.title = "Mod demo — kemas kini data contoh pada skrin.";
}

updateTabPanelsVisibility();

(async function () {
  await maybeAutoGenerateLastMonth();
  await loadReport();
})();
