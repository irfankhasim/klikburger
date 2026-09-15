import { redirectIfPosPageWithoutAuth } from "./pos-page-auth.js";
await redirectIfPosPageWithoutAuth();

import { db, doc, getDocFromServer } from "./firebase/init.js?v=20260825b";
import { COL_MONTHLY_REPORTS } from "./firebase/collections.js";
import { isElevatedRole } from "./pos-rbac-session.js";
import { waitForAuthUser } from "./pos-firebase-auth-bridge.js";
import { monthDocId, generateAndWriteMonthlyReport } from "./monthly-reports/generate-monthly-report.js";
import { t as tr, onLocaleChange, getIntlLocale } from "./i18n/locale.js";

var currentReport = null;
var currentKey = "";
var OPENROUTER_API_KEY = ""; // paste your key from ai-service.js

/**
 * Nama bulan mengikut bahasa aktif. Satu-satunya sumber nama bulan untuk halaman
 * ini — penapis dalam HTML dahulunya menyimpan salinan kedua, kini dibina di sini.
 * Kunci dipanggil secara literal supaya scripts/check-i18n-keys.mjs nampak ia dipakai.
 */
function monthLabels() {
  return [
    tr("report.month.0"),
    tr("report.month.1"),
    tr("report.month.2"),
    tr("report.month.3"),
    tr("report.month.4"),
    tr("report.month.5"),
    tr("report.month.6"),
    tr("report.month.7"),
    tr("report.month.8"),
    tr("report.month.9"),
    tr("report.month.10"),
    tr("report.month.11")
  ];
}

/** Label cara pembayaran — kunci kekal nilai Firestore, hanya teks diterjemah. */
function paymentLabels() {
  var cash = tr("report.pay.cash");
  var qr = tr("report.pay.qr");
  return { cash: cash, tunai: cash, qr: qr, duitnow: qr, ewallet: qr, card: qr };
}

function $(id) { return document.getElementById(id); }

function rm(n) {
  var x = typeof n === "number" ? n : parseFloat(n) || 0;
  return "RM " + x.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function pct(a, b) {
  if (!b || b === 0) return "—";
  var r = (a / b) * 100;
  if (Math.abs(r) > 999) return ">999%";
  return r.toFixed(1) + "%";
}

function escapeHtml(s) {
  return String(s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function setStatus(msg, kind) {
  var el = $("mr-status");
  if (!el) return;
  if (!msg) { el.className = "mr-status mr-status--hidden"; el.textContent = ""; return; }
  el.className = "mr-status" + (kind === "err" ? " mr-status--err" : kind === "ok" ? " mr-status--ok" : "");
  el.textContent = msg;
}

function selectedYearMonth() {
  var y = parseInt(($("mr-year") || {}).value) || new Date().getFullYear();
  var m = parseInt(($("mr-month") || {}).value) || 1;
  return { year: y, month: m };
}

/**
 * Isi penapis tahun & bulan. Dahulunya sebuah <script> sebaris dalam
 * html/bo-monthly-reports.html; dipindahkan ke sini supaya nama bulan hanya ada
 * di satu tempat dan boleh mengikut bahasa aktif. Julat tahun dan nilai lalai
 * kekal sama (tahun semasa hingga 6 tahun ke belakang, bulan semasa dipilih).
 */
function populateFilters() {
  var now = new Date();
  var cy = now.getFullYear();
  var yEl = $("mr-year");
  var mEl = $("mr-month");
  if (yEl && !yEl.options.length) {
    for (var y = cy; y >= cy - 6; y--) {
      var o = document.createElement("option");
      o.value = String(y); o.textContent = String(y);
      yEl.appendChild(o);
    }
    yEl.value = String(cy);
  }
  if (mEl && !mEl.options.length) {
    for (var mi = 1; mi <= 12; mi++) {
      var om = document.createElement("option");
      om.value = String(mi);
      mEl.appendChild(om);
    }
    mEl.value = String(now.getMonth() + 1);
  }
  renderMonthOptionLabels();
}

/** Tulis semula teks pilihan bulan sahaja — nilai dan pilihan pengguna kekal. */
function renderMonthOptionLabels() {
  var mEl = $("mr-month");
  if (!mEl) return;
  var labels = monthLabels();
  Array.prototype.forEach.call(mEl.options, function (opt) {
    var mi = parseInt(opt.value, 10);
    if (!mi) return;
    opt.textContent = labels[mi - 1] + " (" + mi + ")";
  });
}

/**
 * Butang toolbar dibina semula oleh JS semasa menjana/muat turun, jadi teksnya
 * tidak boleh ditanda `data-i18n` dalam HTML — ia ditulis di sini.
 */
function renderToolbarLabels() {
  setBtnLabel($("mr-generate"), tr("report.generate"));
  setBtnLabel($("mr-download-pdf"), tr("report.downloadPdf"));
}

/** Tukar teks butang tanpa menyentuh ikonnya; abaikan butang yang sedang sibuk. */
function setBtnLabel(btn, text) {
  if (!btn) return;
  var span = btn.querySelector("[data-mr-label]");
  if (span) span.textContent = text;
}

function renderEmpty() {
  var body = $("mr-report-body");
  if (!body) return;
  body.innerHTML =
    '<div class="rp-doc"><div class="rp-empty">' +
    '<i class="fa-regular fa-file-lines" aria-hidden="true"></i>' +
    '<p>' + tr("report.empty.title") + '</p>' +
    '<p style="font-size:12px">' + tr("report.empty.hint") + '</p>' +
    '</div></div>';
  var pdfBtn = $("mr-download-pdf");
  if (pdfBtn) pdfBtn.disabled = true;
}

function renderReport(d, key) {
  var body = $("mr-report-body");
  if (!body) return;

  var s = d.sales || {};
  var r = d.rawMaterials || {};
  var st = d.staffSalary || {};
  var c = d.company || {};
  var netOp = c.netOperatingEstimateRm || 0;
  var grossSales = s.grossSalesSubtotalRm || 0;
  var payrollTotal = st.activeStaffPayrollEstimateRm || 0;
  var wastageRm = typeof c.wastageRm === "number" ? c.wastageRm : r.wastageTotalRm || 0;

  // Derive top menu items from sales lines if available
  var topMenuHtml = "";
  if (s.topMenuItems && s.topMenuItems.length) {
    topMenuHtml = s.topMenuItems.slice(0,5).map(function(x, i) {
      return '<div class="rp-row"><span class="rp-row-label">' + (i+1) + '. ' + escapeHtml(x.name) + '</span><span class="rp-row-val">' + (x.qty || 0) + ' ' + tr("report.orders") + '</span></div>';
    }).join("");
  } else {
    topMenuHtml = '<p class="mr-note">' + tr("report.topMenu.empty") + '</p>';
  }

  // Stock status
  var summary = r.ingredientStockSummary || r.ingredientSummary || [];
  var habis = summary.filter(function(x) { return x.status === "habis" || x.qtyRemaining === 0; });
  var rendah = summary.filter(function(x) { return x.status === "rendah" || (x.qtyRemaining > 0 && x.qtyRemaining <= 5); });
  var stockHtml = "";
  if (habis.length === 0 && rendah.length === 0) {
    stockHtml = '<div class="rp-row"><span class="rp-row-label">' + tr("report.stock.statusLabel") + '</span><span class="rp-badge rp-badge-ok">' + tr("report.stock.allSufficient") + '</span></div>';
  } else {
    habis.slice(0,6).forEach(function(x) {
      stockHtml += '<div class="rp-row"><span class="rp-row-label">' + escapeHtml(x.name) + '</span><span class="rp-badge rp-badge-red">' + tr("report.stock.out") + '</span></div>';
    });
    rendah.slice(0,4).forEach(function(x) {
      stockHtml += '<div class="rp-row"><span class="rp-row-label">' + escapeHtml(x.name) + '</span><span class="rp-badge" style="background:#fffbeb;color:#854F0B">' + tr("report.stock.low") + ' — ' + (Math.round(x.qtyRemaining * 100) / 100) + ' ' + escapeHtml(x.unit||"") + '</span></div>';
    });
    // Tunjuk beberapa stok ok juga
    var ok = summary.filter(function(x) { return x.status === "ok" && x.qtyRemaining > 0; });
    ok.forEach(function(x) {
      var used = x.qtyUsedThisMonth || 0;
      var wasted = x.qtyWastedThisMonth || 0;
      var usedTxt = tr("report.stock.used") + " " + (Math.round(used * 100) / 100) + " " + (x.unit || "");
      if (wasted > 0) {
        usedTxt += " · " + tr("report.stock.wasted") + " " + (Math.round(wasted * 100) / 100) + " " + (x.unit || "");
      }
      stockHtml += '<div class="rp-row">' +
        '<span class="rp-row-label">' + escapeHtml(x.name) + '</span>' +
        '<span style="font-size:12px;color:var(--text-muted)">' + escapeHtml(usedTxt) + '</span>' +
        '<span class="rp-badge rp-badge-ok">' + (Math.round(x.qtyRemaining * 100) / 100) + ' ' + escapeHtml(x.unit||"") + ' ' + tr("report.stock.remaining") + '</span>' +
        '</div>';
    });
  }

  // Payment methods
  var by = s.byPaymentMethodRm || {};
  var payLabels = paymentLabels();
  var payTotal = Object.keys(by).reduce(function(s,k){ return s + (by[k]||0); }, 0);
  var payHtml = Object.keys(by).map(function(k) {
    var pct2 = payTotal > 0 ? Math.round((by[k]/payTotal)*100) : 0;
    var colors = { cash:"#f5a623", qr:"#3b82f6", tunai:"#f5a623", duitnow:"#3b82f6", ewallet:"#3b82f6", card:"#3b82f6" };
    var col = colors[k] || "#888";
    return '<div class="rp-pay-row">' +
      '<span class="rp-pay-label">' + escapeHtml(payLabels[k]||k) + '</span>' +
      '<div class="rp-pay-bar-wrap"><div class="rp-pay-fill" style="width:' + pct2 + '%;background:' + col + '"></div></div>' +
      '<span class="rp-pay-amount">' + escapeHtml(rm(by[k])) + ' (' + pct2 + '%)</span>' +
      '</div>';
  }).join("");

  var staffLines = Array.isArray(st.lines) ? st.lines : [];
  var staffHtml = "";
  if (!staffLines.length) {
    staffHtml = '<p class="mr-note">' + tr("report.staff.empty") + '</p>';
  } else {
    staffHtml = staffLines
      .map(function (row) {
        var salary = row.isOwner ? tr("report.staff.noSalary") : rm(row.estimatedMonthlySalaryRm || 0);
        var clockTxt =
          (row.totalHoursWorked != null ? row.totalHoursWorked : 0) +
          " " +
          tr("report.staff.hours") +
          " · " +
          (row.totalSessions || 0) +
          " " +
          tr("report.staff.sessions");
        var badge = row.isOwner
          ? '<span class="rp-badge" style="background:#fef3c7;color:#92400e">' + tr("report.staff.owner") + "</span>"
          : '<span class="rp-badge rp-badge-ok">' + escapeHtml(row.role || "staff") + "</span>";
        return (
          '<div class="rp-staff-row">' +
          '<div class="rp-staff-row__head">' +
          '<strong>' +
          escapeHtml(String(row.name || "—").replace(/\s*\(Owner\)\s*$/i, "")) +
          "</strong> " +
          badge +
          "</div>" +
          '<div class="rp-row"><span class="rp-row-label">' + tr("report.staff.estSalary") + '</span><span class="rp-row-val">' +
          escapeHtml(salary) +
          "</span></div>" +
          '<div class="rp-row"><span class="rp-row-label">' + tr("report.staff.attendance") + '</span><span class="rp-row-val">' +
          escapeHtml(clockTxt) +
          "</span></div>" +
          "</div>"
        );
      })
      .join("");
  }

  // Cadangan tindakan
  var actions = [];
  if (netOp < 0) {
    var breakeven = Math.ceil((payrollTotal + wastageRm) / 0.6);
    actions.push(tr("report.action.increaseSalesPre") + " <strong>" + rm(breakeven) + "</strong> " + tr("report.action.increaseSalesPost"));
  }
  if (habis.length > 0) {
    actions.push(tr("report.action.restock") + " <strong>" + habis.slice(0,4).map(function(x){return x.name;}).join(", ") + "</strong>");
  }
  if (payrollTotal > grossSales * 0.4) {
    actions.push(tr("report.action.payrollHigh"));
  }
  if (actions.length === 0) {
    actions.push(tr("report.action.good"));
  }

  var monthLabel = monthLabels()[(d.calendarMonth||1)-1] + " " + (d.calendarYear||"");

  body.innerHTML =
    '<div class="rp-doc">' +

    '<div class="rp-doc-header">' +
    '<p class="rp-doc-title">' + tr("report.doc.title") + '</p>' +
    '<p class="rp-doc-meta">Klik Burger &nbsp;·&nbsp; ' + escapeHtml(monthLabel) + ' &nbsp;·&nbsp; ' + tr("report.doc.generated") + " " + new Date().toLocaleDateString(getIntlLocale()) + '</p>' +
    '</div>' +

    // Section 1 — Kewangan
    '<div class="rp-section">' +
    '<div class="rp-section-head"><div class="rp-section-num">1</div><p class="rp-section-title">Ringkasan kewangan</p></div>' +
    '<div class="rp-highlight-row">' +
    '<div class="rp-highlight"><p class="rp-hl-label">Jumlah jualan</p><p class="rp-hl-val">' + escapeHtml(rm(grossSales)) + '</p></div>' +
    '<div class="rp-highlight"><p class="rp-hl-label">Untung / Rugi bersih</p><p class="rp-hl-val ' + (netOp >= 0 ? "rp-green" : "rp-red") + '">' + (netOp >= 0 ? "" : "- ") + escapeHtml(rm(Math.abs(netOp))) + '</p></div>' +
    '</div>' +
    '<div class="rp-row"><span class="rp-row-label">Jumlah transaksi berjaya</span><span class="rp-row-val">' + (s.nonVoidReceiptCount||0) + ' pesanan</span></div>' +
    '<div class="rp-row"><span class="rp-row-label">Nilai purata setiap pelanggan</span><span class="rp-row-val">' + escapeHtml(rm(s.avgNonVoidSubtotalRm)) + '</span></div>' +
    '<div class="rp-row"><span class="rp-row-label">Keuntungan kasar</span><span class="rp-row-val rp-green">' + escapeHtml(rm(s.grossProfitRm)) + ' (' + pct(s.grossProfitRm, grossSales) + ')</span></div>' +
    '<div class="rp-row"><span class="rp-row-label">' + tr("report.row.cogs") + '</span><span class="rp-row-val">' + escapeHtml(rm(s.totalCogsFifoRm)) + '</span></div>' +
    '<div class="rp-row"><span class="rp-row-label">' + tr("report.row.wastage") + '</span><span class="rp-row-val">' + escapeHtml(rm(wastageRm)) + '</span></div>' +
    '<div class="rp-row"><span class="rp-row-label">' + tr("report.row.payroll") + '</span><span class="rp-row-val">' + escapeHtml(rm(payrollTotal)) + '</span></div>' +
    '<div class="rp-row-total"><span>untung/rugi</span><span class="' + (netOp >= 0 ? "rp-green" : "rp-red") + '">' + (netOp >= 0 ? "" : "- ") + escapeHtml(rm(Math.abs(netOp))) + '</span></div>' +
    '</div>' +

    // Section 2 — Menu
    '<div class="rp-section">' +
    '<div class="rp-section-head"><div class="rp-section-num">2</div><p class="rp-section-title">Menu paling laris</p></div>' +
    topMenuHtml +
    '</div>' +

    // Section 3 — Stok
    '<div class="rp-section">' +
    '<div class="rp-section-head"><div class="rp-section-num">3</div><p class="rp-section-title">Status stok bahan</p></div>' +
    stockHtml +
    '</div>' +

    // Section 4 — Perbelanjaan
    '<div class="rp-section">' +
    '<div class="rp-section-head"><div class="rp-section-num">4</div><p class="rp-section-title">Perbelanjaan bulan ini</p></div>' +
    '<div class="rp-row"><span class="rp-row-label">' + tr("report.exp.salary") + '</span><span class="rp-row-val">' + escapeHtml(rm(payrollTotal)) + '</span></div>' +
    '<div class="rp-row"><span class="rp-row-label">' + tr("report.exp.wastage") + '</span><span class="rp-row-val">' + escapeHtml(rm(wastageRm)) + '</span></div>' +
    ((r.wastageByIngredient || []).slice(0, 5).map(function (w) {
      return '<div class="rp-row"><span class="rp-row-label"> · ' + escapeHtml(w.name) + '</span><span class="rp-row-val">' + escapeHtml(rm(w.totalCostRm)) + ' (' + (Math.round((w.totalQty || 0) * 100) / 100) + ' ' + escapeHtml(w.unit || "") + ')</span></div>';
    }).join("")) +
    '<div class="rp-row"><span class="rp-row-label">' + tr("report.exp.purchasesThisMonth") + '</span><span class="rp-row-val">' + escapeHtml(rm(r.purchaseHistoryTotalRm)) + '</span></div>' +
    (r.purchaseHistoryTaxTotalRm > 0
      ? '<div class="rp-row"><span class="rp-row-label">' + tr("report.exp.tax") + '</span><span class="rp-row-val">' + escapeHtml(rm(r.purchaseHistoryTaxTotalRm)) + '</span></div>'
      : '') +
    '<p style="font-size:11px;color:var(--text-muted);margin:4px 0 0;padding:0 0 6px">' + tr("report.exp.note") + '</p>' +
    '</div>' +

    // Section 5 — Pembayaran
    '<div class="rp-section">' +
    '<div class="rp-section-head"><div class="rp-section-num">5</div><p class="rp-section-title">Cara pembayaran pelanggan</p></div>' +
    payHtml +
    '</div>' +

    // Section 6 — Kakitangan
    '<div class="rp-section">' +
    '<div class="rp-section-head"><div class="rp-section-num">6</div><p class="rp-section-title">Senarai kakitangan</p></div>' +
    staffHtml +
    '</div>' +

    // Section 7 — Tindakan
    '<div class="rp-section">' +
    '<div class="rp-section-head"><div class="rp-section-num">7</div><p class="rp-section-title">Cadangan tindakan bulan depan</p></div>' +
    '<ul class="rp-action-list">' +
    actions.map(function(a) {
      return '<li class="rp-action-item"><div class="rp-action-dot"></div><div>' + a + '</div></li>';
    }).join("") +
    '</ul>' +
    '</div>' +

    '<div class="rp-footer">' + tr("report.footer.pre") + " " + escapeHtml(monthLabel) + ". " + tr("report.footer.post") + "</div>" +
    '</div>';

  var pdfBtn = $("mr-download-pdf");
  if (pdfBtn) pdfBtn.disabled = false;
}

async function loadReport() {
  var sel = selectedYearMonth();
  currentKey = monthDocId(sel.year, sel.month);
  currentReport = null;
  renderEmpty();
    setStatus(tr("common.loading"));
  try {
    var snap = await getDocFromServer(doc(db, COL_MONTHLY_REPORTS, currentKey));
    if (!snap.exists()) {
      currentReport = null;
      var now = new Date();
      var isCurrent = sel.year === now.getFullYear() && sel.month === (now.getMonth() + 1);
      var isFuture = sel.year > now.getFullYear() || (sel.year === now.getFullYear() && sel.month > now.getMonth() + 1);
      if (isCurrent) {
        setStatus(tr("report.status.monthPrefix") + " " + currentKey + " " + tr("report.status.monthOngoing"), null);
      } else if (isFuture) {
        setStatus(tr("report.status.monthPrefix") + " " + currentKey + " " + tr("report.status.monthNotStarted"), null);
      } else {
        setStatus(tr("report.status.noReportPre") + " " + currentKey + " " + tr("report.status.noReportPost"), null);
      }
      renderEmpty();
      return;
    }
    currentReport = snap.data();
    setStatus(tr("report.status.loadedPre") + " " + currentKey + " " + tr("report.status.loadedPost"), "ok");
    renderReport(currentReport, currentKey);
  } catch (e) {
    setStatus(e.message || tr("report.status.loadFail"), "err");
    renderEmpty();
  }
}

async function onGenerate() {
  if (!isElevatedRole()) { window.alert(tr("report.alert.ownerOnly")); return; }
  var sel = selectedYearMonth();
  var now = new Date();
  var currentYear = now.getFullYear();
  var currentMonth = now.getMonth() + 1;

  // Bulan hadapan — tidak boleh jana
  if (sel.year > currentYear || (sel.year === currentYear && sel.month > currentMonth)) {
    window.alert(tr("report.alert.futureMonth"));
    return;
  }
  var btn = $("mr-generate");
  if (btn) { btn.disabled = true; setBtnLabel(btn, tr("report.generating")); }
  setStatus(tr("report.status.generatingPre") + " " + sel.year + "-" + String(sel.month).padStart(2,"0") + "…");
  try {
    await generateAndWriteMonthlyReport(sel.year, sel.month, {
      source: "user_regenerate",
      onProgress: function (msg) {
        setStatus(msg);
      }
    });
    setStatus(tr("report.status.generateOk"), "ok");
    await loadReport();
  } catch (e) {
    setStatus(e.message || tr("report.status.generateFail"), "err");
  } finally {
    if (btn) { btn.disabled = false; renderToolbarLabels(); }
  }
}

async function downloadPdf() {
  if (!currentReport) { setStatus(tr("report.status.nothingToDownload"), "err"); return; }
  var btn = $("mr-download-pdf");
  if (btn) { btn.disabled = true; setBtnLabel(btn, tr("report.status.generatingPdf")); }
  try {
    if (!window.jspdf) {
      await new Promise(function(resolve, reject) {
        var s = document.createElement("script");
        s.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
        s.onload = resolve; s.onerror = reject;
        document.head.appendChild(s);
      });
    }
    var jsPDF = window.jspdf.jsPDF;
    var pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    var W = pdf.internal.pageSize.getWidth();
    var H = pdf.internal.pageSize.getHeight();
    var ml = 15; var mr = 15; var cw = W - ml - mr;
    var y = 0;

    var d = currentReport;
    var s = d.sales || {};
    var r = d.rawMaterials || {};
    var st = d.staffSalary || {};
    var c = d.company || {};
    var netOp = c.netOperatingEstimateRm || 0;
    var grossSales = s.grossSalesSubtotalRm || 0;
    var payrollTotal = st.activeStaffPayrollEstimateRm || 0;
    var wastageRm = typeof c.wastageRm === "number" ? c.wastageRm : r.wastageTotalRm || 0;
    var monthLabel = monthLabels()[(d.calendarMonth||1)-1] + " " + (d.calendarYear||"");

    function addPage() {
      pdf.addPage(); y = 20;
      pdf.setFontSize(8); pdf.setTextColor(120,120,120);
      pdf.text("Klik Burger — Laporan Sulit Dalaman", ml, H-8);
      pdf.text(currentKey, W-mr, H-8, { align: "right" });
    }
    function checkY(n) { if (y + n > H - 20) addPage(); }
    function row(label, value, color) {
      checkY(9);
      pdf.setFontSize(9); pdf.setFont("helvetica","normal"); pdf.setTextColor(80,80,80);
      pdf.text(String(label), ml+3, y+5.5);
      pdf.setFont("helvetica","bold");
      if (color) pdf.setTextColor(...color); else pdf.setTextColor(30,30,30);
      pdf.text(String(value), W-mr-3, y+5.5, { align: "right" });
      pdf.setDrawColor(220,220,220); pdf.setLineWidth(0.3);
      pdf.line(ml, y+8, W-mr, y+8);
      y += 9;
    }
    function sectionHead(num, title) {
      checkY(16);
      pdf.setFontSize(10); pdf.setFont("helvetica","bold"); pdf.setTextColor(30,30,30);
      pdf.setFillColor(245,166,35); pdf.rect(ml, y, 5, 5, "F");
      pdf.text(num + ". " + title, ml+8, y+4);
      pdf.setDrawColor(200,200,200); pdf.line(ml, y+7, W-mr, y+7);
      y += 12;
    }

    // Cover
    pdf.setFillColor(26,26,26); pdf.rect(0,0,W,40,"F");
    pdf.setTextColor(255,255,255); pdf.setFontSize(20); pdf.setFont("helvetica","bold");
    pdf.text("Laporan Prestasi Perniagaan", W/2, 18, { align: "center" });
    pdf.setFontSize(11); pdf.setFont("helvetica","normal");
    pdf.text("Klik Burger  ·  " + monthLabel, W/2, 28, { align: "center" });
    pdf.setFontSize(9); pdf.setTextColor(180,180,180);
    pdf.text(tr("report.doc.generated") + " " + new Date().toLocaleDateString(getIntlLocale()), W/2, 35, { align: "center" });
    pdf.setFontSize(8); pdf.text("Klik Burger — Laporan Sulit Dalaman", ml, H-8);
    pdf.text(currentKey, W-mr, H-8, { align: "right" });
    y = 55;

    // Section 1
    sectionHead("1", "Ringkasan Kewangan");
    row("Jumlah jualan", rm(grossSales));
    row("Jumlah transaksi", (s.nonVoidReceiptCount||0) + " pesanan");
    row("Nilai purata setiap pelanggan", rm(s.avgNonVoidSubtotalRm));
    row("Keuntungan kasar", rm(s.grossProfitRm) + " (" + pct(s.grossProfitRm, grossSales) + ")", [16,120,60]);
    row(tr("report.row.cogs"), rm(s.totalCogsFifoRm));
    row(tr("report.row.wastage"), rm(wastageRm));
    row(tr("report.row.payroll"), rm(payrollTotal));
    checkY(12);
    pdf.setFillColor(netOp >= 0 ? 240 : 254, netOp >= 0 ? 253 : 242, netOp >= 0 ? 244 : 242);
    pdf.rect(ml, y, cw, 10, "F");
    pdf.setFontSize(10); pdf.setFont("helvetica","bold");
    pdf.setTextColor(netOp >= 0 ? 16 : 192, netOp >= 0 ? 120 : 57, netOp >= 0 ? 60 : 43);
    pdf.text("untung/rugi", ml+3, y+7);
    pdf.text((netOp >= 0 ? "" : "- ") + rm(Math.abs(netOp)), W-mr-3, y+7, { align: "right" });
    y += 16;

    // Section — Menu paling laris
    var topMenu = (d.sales && d.sales.topMenuItems) || [];
    if (topMenu.length > 0) {
      sectionHead("2", "Menu Paling Laris");
      topMenu.slice(0, 5).forEach(function(x, i) {
        row((i+1) + ". " + (x.name || "—"), (x.qty || 0) + " pesanan");
      });
    }
    sectionHead(topMenu.length > 0 ? "3" : "2", "Status Stok Bahan");
    var summary = r.ingredientStockSummary || r.ingredientSummary || [];
    var habis = summary.filter(function(x){ return x.status === "habis" || x.qtyRemaining === 0; });
    var rendah = summary.filter(function(x){ return x.status === "rendah" || (x.qtyRemaining > 0 && x.qtyRemaining <= 5); });
    if (habis.length === 0 && rendah.length === 0) {
      row("Semua stok mencukupi", "✓", [16,120,60]);
    } else {
      habis.slice(0,8).forEach(function(x){ row(x.name, "Habis", [192,57,43]); });
      rendah.slice(0,4).forEach(function(x){ row(x.name, "Rendah — " + (Math.round(x.qtyRemaining*100)/100) + " " + (x.unit||""), [183,119,13]); });
    }
    // Tunjuk beberapa stok ok
    var okStock = summary.filter(function(x){ return x.status === "ok" && x.qtyRemaining > 0; }).slice(0,5);
    if (okStock.length > 0) {
      y += 3;
      okStock.forEach(function(x){
        row(x.name, (Math.round(x.qtyRemaining*100)/100) + " " + (x.unit||"") + " berbaki", [16,120,60]);
      });
    }

    // Section 3 — Perbelanjaan
    sectionHead(topMenu.length > 0 ? "4" : "3", tr("report.section.expenses"));
    row(tr("report.exp.salary"), rm(payrollTotal));
    row(tr("report.exp.wastage"), rm(wastageRm));
    (r.wastageByIngredient || []).slice(0, 5).forEach(function (w) {
      row("  " + (w.name || ""), rm(w.totalCostRm) + " (" + (Math.round((w.totalQty || 0) * 100) / 100) + " " + (w.unit || "") + ")");
    });
    row(tr("report.exp.purchasesThisMonth"), rm(r.purchaseHistoryTotalRm));
    if (r.purchaseHistoryTaxTotalRm > 0) {
      row(tr("report.exp.tax"), rm(r.purchaseHistoryTaxTotalRm));
    }

    // Section 4 — Pembayaran
    sectionHead(topMenu.length > 0 ? "5" : "4", "Cara Pembayaran Pelanggan");
    var by = s.byPaymentMethodRm || {};
    var payLabels = { cash:"Tunai", tunai:"Tunai", qr:"QR / DuitNow", duitnow:"QR / DuitNow", ewallet:"QR / DuitNow", card:"QR / DuitNow" };
    var payTotal = Object.keys(by).reduce(function(s,k){ return s+(by[k]||0); },0);
    Object.keys(by).forEach(function(k){
      var p = payTotal > 0 ? ((by[k]/payTotal)*100).toFixed(1) : "0";
      row(payLabels[k]||k, rm(by[k]) + " (" + p + "%)");
    });

    // Section 5 — Tindakan
    sectionHead(topMenu.length > 0 ? "6" : "5", "Cadangan Tindakan Bulan Depan");
    var actions = [];
    if (netOp < 0) {
      var be = Math.ceil((payrollTotal + (r.purchaseHistoryTotalRm||0)) / 0.6);
      actions.push("Tingkatkan jualan — perlu capai sekurang-kurangnya " + rm(be) + " sebulan");
    }
    if (habis.length > 0) {
      actions.push("Restock segera: " + habis.slice(0,4).map(function(x){return x.name;}).join(", "));
    }
    if (payrollTotal > grossSales * 0.4) {
      actions.push("Kos gaji tinggi — semak jadual bertugas pada hari jualan rendah");
    }
    if (actions.length === 0) {
      actions.push("Prestasi baik — teruskan strategi semasa");
    }
    actions.forEach(function(a, i) {
      checkY(10);
      pdf.setFillColor(245,166,35); pdf.rect(ml, y+2, 4, 4, "F");
      pdf.setFontSize(9); pdf.setFont("helvetica","normal"); pdf.setTextColor(30,30,30);
      var lines = pdf.splitTextToSize(a, cw-12);
      lines.forEach(function(line, li) {
        if (li > 0) checkY(6);
        pdf.text(line, ml+8, y+5.5);
        y += 6;
      });
      y += 3;
    });

    // Footer
    checkY(15);
    y += 5;
    pdf.setFontSize(8); pdf.setFont("helvetica","italic"); pdf.setTextColor(120,120,120);
    var footerLines = pdf.splitTextToSize(tr("report.footer.pre") + " " + monthLabel + ". " + tr("report.footer.post"), cw);
    footerLines.forEach(function(line) { pdf.text(line, ml, y); y += 5; });

    pdf.save("laporan-" + currentKey + ".pdf");
    setStatus(tr("report.status.pdfOk"), "ok");
  } catch (err) {
    setStatus(tr("report.status.pdfFail") + " " + (err.message||err), "err");
  } finally {
    if (btn) { btn.disabled = false; renderToolbarLabels(); }
  }
}

function updateGenerateButtonState() {
  var btn = $("mr-generate");
  if (!btn) return;
  var sel = selectedYearMonth();
  var now = new Date();
  var currentYear = now.getFullYear();
  var currentMonth = now.getMonth() + 1;
  var isCurrentOrFuture = sel.year > currentYear ||
    (sel.year === currentYear && sel.month >= currentMonth);
  btn.disabled = isCurrentOrFuture;
  btn.title = isCurrentOrFuture
    ? tr("report.tip.cannotGenerate")
    : tr("report.tip.canGenerate");
}

// Event listeners
var genBtn = $("mr-generate");
if (genBtn) genBtn.addEventListener("click", onGenerate);

var pdfBtn = $("mr-download-pdf");
if (pdfBtn) pdfBtn.addEventListener("click", downloadPdf);

function onFilterChange() {
  updateGenerateButtonState();
  loadReport();
}

var yearSel = $("mr-year");
var monthSel = $("mr-month");
if (yearSel) yearSel.addEventListener("change", onFilterChange);
if (monthSel) monthSel.addEventListener("change", onFilterChange);

async function init() {
  try { await waitForAuthUser(); } catch(e) {}
  currentReport = null;
  currentKey = "";
  populateFilters();
  renderToolbarLabels();
  updateGenerateButtonState();
  await loadReport();
}

onLocaleChange(function () {
  renderMonthOptionLabels();
  renderToolbarLabels();
  updateGenerateButtonState();
  if (currentReport) renderReport(currentReport, currentKey);
  else renderEmpty();
});

init();
