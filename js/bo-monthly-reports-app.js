import { redirectIfPosPageWithoutAuth } from "./pos-page-auth.js";
await redirectIfPosPageWithoutAuth();

import { db, doc, getDoc } from "./firebase/init.js";
import { COL_MONTHLY_REPORTS } from "./firebase/collections.js";
import { isElevatedRole } from "./pos-rbac-session.js";
import { waitForAuthUser } from "./pos-firebase-auth-bridge.js";
import { monthDocId, generateAndWriteMonthlyReport } from "./monthly-reports/generate-monthly-report.js";

var currentReport = null;
var currentKey = "";
var OPENROUTER_API_KEY = ""; // paste your key from ai-service.js

var MONTH_LABELS = ["Jan","Feb","Mac","Apr","Mei","Jun","Jul","Ogs","Sep","Okt","Nov","Dis"];

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

function renderEmpty() {
  var body = $("mr-report-body");
  if (!body) return;
  body.innerHTML =
    '<div class="rp-doc"><div class="rp-empty">' +
    '<i class="fa-regular fa-file-lines" aria-hidden="true"></i>' +
    '<p>Tiada laporan untuk tempoh ini.</p>' +
    '<p style="font-size:12px">Klik <strong>Jana laporan</strong> untuk menjana laporan baru.</p>' +
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

  // Derive top menu items from sales lines if available
  var topMenuHtml = "";
  if (s.topMenuItems && s.topMenuItems.length) {
    topMenuHtml = s.topMenuItems.slice(0,5).map(function(x, i) {
      return '<div class="rp-row"><span class="rp-row-label">' + (i+1) + '. ' + escapeHtml(x.name) + '</span><span class="rp-row-val">' + (x.qty || 0) + ' pesanan</span></div>';
    }).join("");
  } else {
    topMenuHtml = '<p class="mr-note">Jana laporan semula untuk lihat menu paling laris.</p>';
  }

  // Stock status
  var summary = r.ingredientSummary || [];
  var habis = summary.filter(function(x) { return x.qtyRemaining === 0; });
  var rendah = summary.filter(function(x) { return x.qtyRemaining > 0 && x.qtyRemaining <= 5; });
  var stockHtml = "";
  if (habis.length === 0 && rendah.length === 0) {
    stockHtml = '<div class="rp-row"><span class="rp-row-label">Status stok</span><span class="rp-badge rp-badge-ok">Semua stok mencukupi</span></div>';
  } else {
    habis.slice(0,6).forEach(function(x) {
      stockHtml += '<div class="rp-row"><span class="rp-row-label">' + escapeHtml(x.name) + '</span><span class="rp-badge rp-badge-red">Habis</span></div>';
    });
    rendah.slice(0,4).forEach(function(x) {
      stockHtml += '<div class="rp-row"><span class="rp-row-label">' + escapeHtml(x.name) + '</span><span class="rp-badge" style="background:#fffbeb;color:#854F0B">Rendah — ' + x.qtyRemaining + ' ' + escapeHtml(x.unit||"") + '</span></div>';
    });
  }

  // Payment methods
  var by = s.byPaymentMethodRm || {};
  var payLabels = { cash:"Tunai", card:"Kad", qr:"QR / DuitNow", duitnow:"QR / DuitNow", ewallet:"eWallet" };
  var payTotal = Object.keys(by).reduce(function(s,k){ return s + (by[k]||0); }, 0);
  var payHtml = Object.keys(by).map(function(k) {
    var pct2 = payTotal > 0 ? Math.round((by[k]/payTotal)*100) : 0;
    var colors = { cash:"#f5a623", qr:"#3b82f6", duitnow:"#3b82f6", ewallet:"#10b981", card:"#8b5cf6" };
    var col = colors[k] || "#888";
    return '<div class="rp-pay-row">' +
      '<span class="rp-pay-label">' + escapeHtml(payLabels[k]||k) + '</span>' +
      '<div class="rp-pay-bar-wrap"><div class="rp-pay-fill" style="width:' + pct2 + '%;background:' + col + '"></div></div>' +
      '<span class="rp-pay-amount">' + escapeHtml(rm(by[k])) + ' (' + pct2 + '%)</span>' +
      '</div>';
  }).join("");

  // Cadangan tindakan
  var actions = [];
  if (netOp < 0) {
    var breakeven = Math.ceil((payrollTotal + (r.purchaseHistoryTotalRm||0)) / 0.6);
    actions.push("Tingkatkan jualan — perlu capai sekurang-kurangnya <strong>" + rm(breakeven) + "</strong> sebulan untuk titik pulang modal");
  }
  if (habis.length > 0) {
    actions.push("Restock segera: <strong>" + habis.slice(0,4).map(function(x){return x.name;}).join(", ") + "</strong>");
  }
  if (payrollTotal > grossSales * 0.4) {
    actions.push("Kos gaji tinggi berbanding jualan — semak jadual bertugas dan kurangkan pada hari jualan rendah");
  }
  if (actions.length === 0) {
    actions.push("Prestasi bulan ini baik — teruskan strategi semasa dan cari peluang untuk meningkatkan jualan");
  }

  var monthLabel = MONTH_LABELS[(d.calendarMonth||1)-1] + " " + (d.calendarYear||"");

  body.innerHTML =
    '<div class="rp-doc">' +

    '<div class="rp-doc-header">' +
    '<p class="rp-doc-title">Laporan Prestasi Perniagaan</p>' +
    '<p class="rp-doc-meta">Klik Burger &nbsp;·&nbsp; ' + escapeHtml(monthLabel) + ' &nbsp;·&nbsp; Dijana: ' + new Date().toLocaleDateString("ms-MY") + '</p>' +
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
    '<div class="rp-row"><span class="rp-row-label">Kos bahan digunakan</span><span class="rp-row-val">' + escapeHtml(rm(s.totalCogsFifoRm)) + '</span></div>' +
    '<div class="rp-row"><span class="rp-row-label">Kos gaji pekerja</span><span class="rp-row-val">' + escapeHtml(rm(payrollTotal)) + '</span></div>' +
    '<div class="rp-row-total"><span>' + (netOp >= 0 ? "Anggaran untung bersih" : "Anggaran rugi bersih") + '</span><span class="' + (netOp >= 0 ? "rp-green" : "rp-red") + '">' + (netOp >= 0 ? "" : "- ") + escapeHtml(rm(Math.abs(netOp))) + '</span></div>' +
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
    '<div class="rp-row"><span class="rp-row-label">Gaji pekerja</span><span class="rp-row-val">' + escapeHtml(rm(payrollTotal)) + '</span></div>' +
    '<div class="rp-row"><span class="rp-row-label">Pembelian stok bahan</span><span class="rp-row-val">' + escapeHtml(rm(r.purchaseHistoryTotalRm)) + '</span></div>' +
    '<div class="rp-row"><span class="rp-row-label">Kos bahan (FIFO)</span><span class="rp-row-val">' + escapeHtml(rm(s.totalCogsFifoRm)) + '</span></div>' +
    '</div>' +

    // Section 5 — Pembayaran
    '<div class="rp-section">' +
    '<div class="rp-section-head"><div class="rp-section-num">5</div><p class="rp-section-title">Cara pembayaran pelanggan</p></div>' +
    payHtml +
    '</div>' +

    // Section 6 — Tindakan
    '<div class="rp-section">' +
    '<div class="rp-section-head"><div class="rp-section-num">6</div><p class="rp-section-title">Cadangan tindakan bulan depan</p></div>' +
    '<ul class="rp-action-list">' +
    actions.map(function(a) {
      return '<li class="rp-action-item"><div class="rp-action-dot"></div><div>' + a + '</div></li>';
    }).join("") +
    '</ul>' +
    '</div>' +

    '<div class="rp-footer">Laporan ini dijana secara automatik oleh sistem POS Klik Burger berdasarkan data ' + escapeHtml(monthLabel) + '. Angka adalah anggaran — sila rujuk akauntan untuk penyata kewangan rasmi.</div>' +
    '</div>';

  var pdfBtn = $("mr-download-pdf");
  if (pdfBtn) pdfBtn.disabled = false;
}

async function loadReport() {
  var sel = selectedYearMonth();
  currentKey = monthDocId(sel.year, sel.month);
  setStatus("Memuatkan…");
  try {
    var snap = await getDoc(doc(db, COL_MONTHLY_REPORTS, currentKey));
    if (!snap.exists()) {
      currentReport = null;
      setStatus("Tiada laporan untuk " + currentKey + " — klik Jana laporan.", null);
      renderEmpty();
      return;
    }
    currentReport = snap.data();
    setStatus("Laporan " + currentKey + " dimuatkan.", "ok");
    renderReport(currentReport, currentKey);
  } catch (e) {
    setStatus(e.message || "Gagal memuatkan laporan.", "err");
    renderEmpty();
  }
}

async function onGenerate() {
  if (!isElevatedRole()) { window.alert("Hanya pemilik boleh jana laporan."); return; }
  var sel = selectedYearMonth();
  var btn = $("mr-generate");
  if (btn) { btn.disabled = true; btn.textContent = "Jana…"; }
  setStatus("Menjana laporan " + sel.year + "-" + String(sel.month).padStart(2,"0") + "…");
  try {
    await generateAndWriteMonthlyReport(sel.year, sel.month, { source: "user_regenerate" });
    setStatus("Laporan berjaya dijana.", "ok");
    await loadReport();
  } catch (e) {
    setStatus(e.message || "Gagal jana laporan.", "err");
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-file-circle-plus" aria-hidden="true"></i> Jana laporan'; }
  }
}

async function downloadPdf() {
  if (!currentReport) { setStatus("Tiada laporan untuk dimuat turun.", "err"); return; }
  var btn = $("mr-download-pdf");
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menjana PDF…'; }
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
    var monthLabel = MONTH_LABELS[(d.calendarMonth||1)-1] + " " + (d.calendarYear||"");

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
    pdf.text("Dijana: " + new Date().toLocaleDateString("ms-MY"), W/2, 35, { align: "center" });
    pdf.setFontSize(8); pdf.text("Klik Burger — Laporan Sulit Dalaman", ml, H-8);
    pdf.text(currentKey, W-mr, H-8, { align: "right" });
    y = 55;

    // Section 1
    sectionHead("1", "Ringkasan Kewangan");
    row("Jumlah jualan", rm(grossSales));
    row("Jumlah transaksi", (s.nonVoidReceiptCount||0) + " pesanan");
    row("Nilai purata setiap pelanggan", rm(s.avgNonVoidSubtotalRm));
    row("Keuntungan kasar", rm(s.grossProfitRm) + " (" + pct(s.grossProfitRm, grossSales) + ")", [16,120,60]);
    row("Kos bahan digunakan", rm(s.totalCogsFifoRm));
    row("Kos gaji pekerja", rm(payrollTotal));
    checkY(12);
    pdf.setFillColor(netOp >= 0 ? 240 : 254, netOp >= 0 ? 253 : 242, netOp >= 0 ? 244 : 242);
    pdf.rect(ml, y, cw, 10, "F");
    pdf.setFontSize(10); pdf.setFont("helvetica","bold");
    pdf.setTextColor(netOp >= 0 ? 16 : 192, netOp >= 0 ? 120 : 57, netOp >= 0 ? 60 : 43);
    pdf.text((netOp >= 0 ? "Anggaran untung bersih" : "Anggaran rugi bersih"), ml+3, y+7);
    pdf.text((netOp >= 0 ? "" : "- ") + rm(Math.abs(netOp)), W-mr-3, y+7, { align: "right" });
    y += 16;

    // Section 2 — Stok
    sectionHead("2", "Status Stok Bahan");
    var summary = r.ingredientSummary || [];
    var habis = summary.filter(function(x){ return x.qtyRemaining === 0; });
    var rendah = summary.filter(function(x){ return x.qtyRemaining > 0 && x.qtyRemaining <= 5; });
    if (habis.length === 0 && rendah.length === 0) {
      row("Status", "Semua stok mencukupi", [16,120,60]);
    } else {
      habis.slice(0,8).forEach(function(x){ row(x.name, "Habis", [192,57,43]); });
      rendah.slice(0,4).forEach(function(x){ row(x.name, "Rendah — " + x.qtyRemaining + " " + (x.unit||""), [183,119,13]); });
    }

    // Section 3 — Perbelanjaan
    sectionHead("3", "Perbelanjaan Bulan Ini");
    row("Gaji pekerja", rm(payrollTotal));
    row("Pembelian stok bahan", rm(r.purchaseHistoryTotalRm));
    row("Kos bahan (FIFO)", rm(s.totalCogsFifoRm));

    // Section 4 — Pembayaran
    sectionHead("4", "Cara Pembayaran Pelanggan");
    var by = s.byPaymentMethodRm || {};
    var payLabels = { cash:"Tunai", card:"Kad", qr:"QR / DuitNow", duitnow:"QR / DuitNow", ewallet:"eWallet" };
    var payTotal = Object.keys(by).reduce(function(s,k){ return s+(by[k]||0); },0);
    Object.keys(by).forEach(function(k){
      var p = payTotal > 0 ? ((by[k]/payTotal)*100).toFixed(1) : "0";
      row(payLabels[k]||k, rm(by[k]) + " (" + p + "%)");
    });

    // Section 5 — Tindakan
    sectionHead("5", "Cadangan Tindakan Bulan Depan");
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
    var footerLines = pdf.splitTextToSize("Laporan ini dijana secara automatik oleh sistem POS Klik Burger berdasarkan data " + monthLabel + ". Angka adalah anggaran — sila rujuk akauntan untuk penyata kewangan rasmi.", cw);
    footerLines.forEach(function(line) { pdf.text(line, ml, y); y += 5; });

    pdf.save("laporan-" + currentKey + ".pdf");
    setStatus("PDF berjaya dimuat turun.", "ok");
  } catch (err) {
    setStatus("Gagal jana PDF: " + (err.message||err), "err");
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-file-pdf" aria-hidden="true"></i> Muat turun PDF'; }
  }
}

// Event listeners
var genBtn = $("mr-generate");
if (genBtn) genBtn.addEventListener("click", onGenerate);

var pdfBtn = $("mr-download-pdf");
if (pdfBtn) pdfBtn.addEventListener("click", downloadPdf);

["mr-year", "mr-month"].forEach(function (id) {
  var el = $(id);
  if (el) el.addEventListener("change", loadReport);
});

// Init
async function init() {
  try { await waitForAuthUser(); } catch(e) {}
  renderEmpty();
  await loadReport();
}
init();
