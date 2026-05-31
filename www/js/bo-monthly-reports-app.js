/**
 * Laporan penuh (bulanan) — baca `monthly_reports/{YYYY-MM}` daripada Firestore;
 * jana semula melalui `generateAndWriteMonthlyReport` (agregat sebenar).
 */
import { redirectIfPosPageWithoutAuth } from "./pos-page-auth.js";
await redirectIfPosPageWithoutAuth();

import { db, doc, getDoc, auth, getDocs, collection, orderBy, limit, query } from "./firebase/init.js";
import { COL_MONTHLY_REPORTS, COL_YEARLY_REPORTS } from "./firebase/collections.js";
import { isElevatedRole } from "./pos-rbac-session.js";
import { waitForAuthUser } from "./pos-firebase-auth-bridge.js";
import {
  monthDocId,
  lastCompletedCalendarMonthParts,
  generateAndWriteMonthlyReport
} from "./monthly-reports/generate-monthly-report.js";
import {
  yearDocId,
  generateAndWriteYearlyReport
} from "./monthly-reports/generate-yearly-report.js";

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
var reportPeriod = "month";

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

function getReportPeriod() {
  var pEl = $("mr-period");
  var p = pEl ? String(pEl.value || "month") : reportPeriod;
  return p === "year" ? "year" : "month";
}

function updatePeriodUi() {
  reportPeriod = getReportPeriod();
  var monthWrap = $("mr-month-wrap");
  if (monthWrap) {
    monthWrap.hidden = reportPeriod === "year";
    monthWrap.style.display = reportPeriod === "year" ? "none" : "";
  }
  var lblMonth = $("mr-lbl-month");
  if (lblMonth) lblMonth.hidden = reportPeriod === "year";
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

fillYearMonthSelectors();

function formatGeneratedAt(data) {
  var g = data && data.generatedAt;
  if (!g) return "—";
  try {
    if (typeof g.toDate === "function") return g.toDate().toLocaleString("ms-MY");
  } catch (e) {}
  return "—";
}

// ── Chart.js loader ──────────────────────────────────────────────────────────
var chartJsReady = false;
var chartJsCallbacks = [];
var activeCharts = [];

function destroyCharts() {
  activeCharts.forEach(function (c) {
    try {
      c.destroy();
    } catch (e) {}
  });
  activeCharts = [];
}

function loadChartJs(cb) {
  if (chartJsReady) {
    cb();
    return;
  }
  chartJsCallbacks.push(cb);
  if (document.getElementById("chartjs-cdn")) return;
  var s = document.createElement("script");
  s.id = "chartjs-cdn";
  s.src = "https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js";
  s.onload = function () {
    chartJsReady = true;
    chartJsCallbacks.forEach(function (fn) {
      try {
        fn();
      } catch (e) {}
    });
    chartJsCallbacks = [];
  };
  document.head.appendChild(s);
}

// ── Charts ───────────────────────────────────────────────────────────────────
function renderSalesChart(d) {
  var ChartLib = window.Chart;
  if (!ChartLib) return;
  var s = d.sales || {};
  var by = s.byPaymentMethodRm || {};
  var labelMap = { cash: "Tunai", card: "Kad", qr: "QR/DuitNow", duitnow: "QR/DuitNow", ewallet: "eWallet" };
  var labels = Object.keys(by).map(function (k) {
    return labelMap[k] || k;
  });
  var values = Object.keys(by).map(function (k) {
    return by[k] || 0;
  });
  var ctx = document.getElementById("mr-chart-sales");
  if (!ctx || !labels.length) return;
  activeCharts.push(
    new ChartLib(ctx, {
      type: "doughnut",
      data: {
        labels: labels,
        datasets: [{ data: values, backgroundColor: ["#f59e0b", "#3b82f6", "#10b981", "#8b5cf6", "#ef4444"] }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: "bottom" }, title: { display: true, text: "Kaedah Bayaran" } }
      }
    })
  );
}

function renderRawChart(d) {
  var ChartLib = window.Chart;
  if (!ChartLib) return;
  var items = ((d.rawMaterials || {}).topIngredientsByLedgerSpendRm || []).slice(0, 8);
  var ctx = document.getElementById("mr-chart-raw");
  if (!ctx || !items.length) return;
  activeCharts.push(
    new ChartLib(ctx, {
      type: "bar",
      data: {
        labels: items.map(function (x) {
          return x.name || x.ingredientId;
        }),
        datasets: [{ label: "RM", data: items.map(function (x) { return x.ledgerSpendRm || 0; }), backgroundColor: "#f59e0b" }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: "y",
        plugins: { legend: { display: false }, title: { display: true, text: "Bahan Tertinggi (RM)" } }
      }
    })
  );
}

function renderStaffChart(d) {
  var ChartLib = window.Chart;
  if (!ChartLib) return;
  var lines = ((d.staffSalary || {}).lines || []).filter(function (x) {
    return x.employmentStatus === "active";
  });
  var ctx = document.getElementById("mr-chart-staff");
  if (!ctx || !lines.length) return;
  activeCharts.push(
    new ChartLib(ctx, {
      type: "bar",
      data: {
        labels: lines.map(function (x) {
          return x.name;
        }),
        datasets: [{ label: "Anggaran Gaji (RM)", data: lines.map(function (x) { return x.estimatedMonthlySalaryRm || 0; }), backgroundColor: "#3b82f6" }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, title: { display: true, text: "Anggaran Gaji Bulanan" } }
      }
    })
  );
}

function renderCompanyChart(d) {
  var ChartLib = window.Chart;
  if (!ChartLib) return;
  var c = d.company || {};
  var ctx = document.getElementById("mr-chart-company");
  if (!ctx) return;
  activeCharts.push(
    new ChartLib(ctx, {
      type: "bar",
      data: {
        labels: ["Pendapatan", "Kos Bahan", "Untung Kasar", "Gaji", "Angg. Bersih"],
        datasets: [{
          label: "RM",
          data: [
            c.revenuePosReceiptsRm || 0,
            c.costOfGoodsFifoRm || 0,
            c.grossProfitRm || 0,
            c.payrollEstimateRm || 0,
            c.netOperatingEstimateRm || 0
          ],
          backgroundColor: ["#10b981", "#ef4444", "#3b82f6", "#f59e0b", "#8b5cf6"]
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, title: { display: true, text: "Ringkasan P&L" } }
      }
    })
  );
}

async function getOpenRouterApiKey() {
  try {
    var mod = await import("./ai-assistant/ai-service.js");
    return mod.OPENROUTER_API_KEY || "";
  } catch (e) {
    return "";
  }
}

async function ensureAuthReady() {
  var u = await waitForAuthUser();
  if (!u) return null;
  try {
    await u.getIdToken(false);
  } catch (e) {}
  return u;
}

// ── AI Insights (on-demand, end of report) ────────────────────────────────────
function buildReportAiSummary(reportData) {
  var s = reportData.sales || {};
  var r = reportData.rawMaterials || {};
  var st = reportData.staffSalary || {};
  var c = reportData.company || {};
  var activeStaff = (st.lines || []).filter(function (x) {
    return x.employmentStatus === "active";
  }).length;
  return (
    "Tempoh: " +
    currentKey +
    "\n" +
    "Jualan: pendapatan=" +
    formatRM(s.grossSalesSubtotalRm) +
    ", transaksi=" +
    (s.nonVoidReceiptCount || 0) +
    ", kos bahan=" +
    formatRM(s.totalCogsFifoRm) +
    ", keuntungan kasar=" +
    formatRM(s.grossProfitRm) +
    ", purata transaksi=" +
    formatRM(s.avgNonVoidSubtotalRm) +
    "\n" +
    "Bahan mentah: belian=" +
    formatRM(r.purchaseHistoryTotalRm) +
    ", bahan tertinggi=" +
    (r.topIngredientsByLedgerSpendRm || [])
      .slice(0, 5)
      .map(function (x) {
        return (x.name || x.ingredientId) + " (" + formatRM(x.ledgerSpendRm) + ")";
      })
      .join(", ") +
    "\n" +
    "Pekerja: anggaran gaji=" +
    formatRM(st.activeStaffPayrollEstimateRm) +
    ", pekerja aktif=" +
    activeStaff +
    "\n" +
    "Kewangan: hasil=" +
    formatRM(c.revenuePosReceiptsRm) +
    ", kos bahan=" +
    formatRM(c.costOfGoodsFifoRm) +
    ", keuntungan kasar=" +
    formatRM(c.grossProfitRm) +
    ", gaji=" +
    formatRM(c.payrollEstimateRm) +
    ", keuntungan bersih (anggaran)=" +
    formatRM(c.netOperatingEstimateRm)
  );
}

function resetAiSection() {
  var el = $("mr-ai-insights");
  var btn = $("mr-ai-generate");
  if (btn) {
    btn.disabled = !currentReport;
    btn.removeAttribute("aria-busy");
    btn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i> Jana Analisis';
  }
  if (!el) return;
  el.innerHTML = currentReport
    ? '<p class="mr-note">Tekan <strong>Jana Analisis</strong> untuk mendapatkan rumusan dan cadangan berdasarkan laporan di atas.</p>'
    : '<p class="mr-note">Muat atau jana laporan terlebih dahulu sebelum analisis AI.</p>';
}

async function generateReportAiAnalysis(reportData) {
  var el = $("mr-ai-insights");
  var btn = $("mr-ai-generate");
  if (!el || !reportData) return;

  var OPENROUTER_API_KEY = await getOpenRouterApiKey();
  if (!OPENROUTER_API_KEY) {
    el.innerHTML =
      '<div class="mr-ai-box"><p class="mr-note">Analisis AI tidak tersedia — kunci OpenRouter belum dikonfigurasi.</p></div>';
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.setAttribute("aria-busy", "true");
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> Menjana analisis...';
  }
  el.innerHTML = '<p class="mr-note"><i class="fa-solid fa-spinner fa-spin"></i> Menjana analisis AI — sila tunggu...</p>';

  var summary = buildReportAiSummary(reportData);
  var prompt =
    "Anda adalah penasihat perniagaan untuk restoran Tab Kaunter. " +
    "Berdasarkan laporan bulanan lengkap di bawah, berikan analisis perniagaan holistik dalam Bahasa Melayu. " +
    "Format: 4 bahagian berlabel (Prestasi Jualan, Perbelanjaan Bahan, Kos Pekerja, Ringkasan Kewangan). " +
    "Setiap bahagian: 2-3 point bernombor dengan pemerhatian + cadangan tindakan konkrit. " +
    "Akhiri dengan 1-2 langkah keutamaan untuk pemilik.\n\nDATA LAPORAN:\n" +
    summary;

  try {
    var res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + OPENROUTER_API_KEY,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://possystem-6907d.web.app",
        "X-Title": "Tab Kaunter POS"
      },
      body: JSON.stringify({
        model: "meta-llama/llama-3.1-8b-instruct",
        max_tokens: 900,
        temperature: 0.3,
        messages: [{ role: "user", content: prompt }]
      })
    });
    var data = await res.json();
    var text = (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || "").trim();
    if (!text) throw new Error("Kosong");
    el.innerHTML =
      '<div class="mr-ai-box"><h3 class="mr-subhead"><i class="fa-solid fa-robot"></i> Rumusan &amp; Cadangan</h3><div class="mr-ai-content">' +
      text.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>").replace(/\n/g, "<br>") +
      '</div><button type="button" class="btn btn--ghost btn--sm mr-ai-refresh"><i class="fa-solid fa-rotate"></i> Jana semula</button></div>';
  } catch (err) {
    el.innerHTML =
      '<div class="mr-ai-box"><p class="mr-note" style="color:var(--color-danger,#c0392b)">Gagal jana analisis. <button type="button" class="btn btn--ghost btn--sm mr-ai-refresh">Cuba semula</button></p></div>';
  } finally {
    if (btn) {
      btn.disabled = !currentReport;
      btn.removeAttribute("aria-busy");
      btn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i> Jana Analisis';
    }
  }
}

async function onGenerateAiAnalysis() {
  if (!currentReport) {
    setStatus("Tiada laporan dimuatkan — muat laporan terlebih dahulu.", null);
    return;
  }
  await generateReportAiAnalysis(currentReport);
}

// ── PDF Download ──────────────────────────────────────────────────────────────
async function downloadPdf() {
  if (!currentReport) { setStatus("Tiada laporan untuk dimuat turun.", "err"); return; }
  var btn = $("mr-download-pdf");
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menjana PDF...'; }

  try {
    if (!window.jspdf) {
      await new Promise(function (resolve, reject) {
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

    var AMBER = [245, 158, 11];
    var DARK  = [30, 30, 30];
    var GRAY  = [100, 100, 100];
    var LIGHT = [248, 248, 248];
    var WHITE = [255, 255, 255];
    var GREEN = [16, 185, 129];
    var RED   = [239, 68, 68];
    var BLUE  = [59, 130, 246];

    function addPage() {
      pdf.addPage();
      y = 20;
      // Footer
      pdf.setFontSize(8); pdf.setTextColor(...GRAY);
      pdf.text("Tab Kaunter — Laporan Sulit Dalaman", ml, H - 8);
      pdf.text(currentKey, W - mr, H - 8, { align: "right" });
    }

    function checkY(needed) {
      if (y + needed > H - 20) addPage();
    }

    function drawSectionHeader(title, color) {
      checkY(18);
      pdf.setFillColor(...(color || AMBER));
      pdf.rect(ml, y, cw, 11, "F");
      pdf.setTextColor(...WHITE);
      pdf.setFontSize(11);
      pdf.setFont("helvetica", "bold");
      pdf.text(title, ml + 5, y + 7.5);
      y += 16;
    }

    function drawMetricRow(label, value, color) {
      checkY(9);
      pdf.setFillColor(...LIGHT);
      pdf.rect(ml, y, cw, 8, "F");
      pdf.setDrawColor(225, 225, 225);
      pdf.rect(ml, y, cw, 8, "S");
      // Label — truncate if too long
      pdf.setTextColor(...DARK);
      pdf.setFontSize(8.5);
      pdf.setFont("helvetica", "normal");
      var labelTxt = String(label);
      if (pdf.getTextWidth(labelTxt) > cw - 45) {
        while (pdf.getTextWidth(labelTxt + "...") > cw - 45 && labelTxt.length > 5) {
          labelTxt = labelTxt.slice(0, -1);
        }
        labelTxt += "...";
      }
      pdf.text(labelTxt, ml + 3, y + 5.5);
      // Value — right aligned
      pdf.setTextColor(...(color || DARK));
      pdf.setFont("helvetica", "bold");
      pdf.text(String(value), W - mr - 3, y + 5.5, { align: "right" });
      y += 9;
    }

    function drawTableHeader(cols) {
      checkY(10);
      pdf.setFillColor(...DARK);
      var x = ml;
      cols.forEach(function (c) {
        pdf.rect(x, y, c.w, 9, "F");
        pdf.setTextColor(...WHITE); pdf.setFontSize(8); pdf.setFont("helvetica", "bold");
        pdf.text(c.label, x + 2, y + 6);
        x += c.w;
      });
      y += 9;
    }

    function drawTableRow(cols, data, shade) {
      checkY(8);
      var x = ml;
      cols.forEach(function (c, i) {
        pdf.setFillColor(...(shade ? [245, 245, 245] : WHITE));
        pdf.rect(x, y, c.w, 8, "F");
        pdf.setDrawColor(220, 220, 220);
        pdf.rect(x, y, c.w, 8, "S");
        pdf.setTextColor(...DARK);
        pdf.setFontSize(8);
        pdf.setFont("helvetica", "normal");
        var txt = String(data[i] != null ? data[i] : "—");
        var maxW = c.w - 4;
        if (pdf.getTextWidth(txt) > maxW) {
          while (pdf.getTextWidth(txt + "...") > maxW && txt.length > 3) {
            txt = txt.slice(0, -1);
          }
          txt += "...";
        }
        pdf.text(txt, x + 2, y + 5.5);
        x += c.w;
      });
      y += 8;
    }

    function drawInsightBox(title, text) {
      if (!text) return;
      var innerWidth = cw - 16;
      var titleLines = pdf.splitTextToSize(title, innerWidth);
      var bodyLines = pdf.splitTextToSize(text, innerWidth);
      var totalLines = titleLines.length + bodyLines.length;
      var bh = (totalLines * 5.5) + 18;
      checkY(bh + 8);
      // Box background and border
      pdf.setFillColor(255, 251, 235);
      pdf.setDrawColor(245, 158, 11);
      pdf.setLineWidth(0.8);
      pdf.roundedRect(ml, y, cw, bh, 2, 2, "FD");
      // Left accent bar
      pdf.setFillColor(245, 158, 11);
      pdf.rect(ml, y, 3, bh, "F");
      // Title
      var ty = y + 7;
      pdf.setFontSize(9);
      pdf.setFont("helvetica", "bold");
      pdf.setTextColor(30, 30, 30);
      titleLines.forEach(function (line) {
        pdf.text(line, ml + 8, ty);
        ty += 5.5;
      });
      // Divider line
      pdf.setDrawColor(245, 158, 11);
      pdf.setLineWidth(0.3);
      pdf.line(ml + 8, ty, ml + cw - 8, ty);
      ty += 4;
      // Body text
      pdf.setFontSize(8.5);
      pdf.setFont("helvetica", "normal");
      pdf.setTextColor(50, 50, 50);
      bodyLines.forEach(function (line) {
        pdf.text(line, ml + 8, ty);
        ty += 5.5;
      });
      y += bh + 8;
    }

    function rm(n) {
      var x = typeof n === "number" ? n : parseFloat(n) || 0;
      return "RM " + x.toFixed(2);
    }

    function pct(a, b) {
      if (!b || b === 0) return "Tiada data";
      var result = (a / b) * 100;
      if (Math.abs(result) > 999) return ">999% (jualan rendah)";
      return result.toFixed(1) + "%";
    }

    // ── COVER PAGE ────────────────────────────────────────────────────────────
    pdf.setFillColor(...AMBER);
    pdf.rect(0, 0, W, 50, "F");
    pdf.setTextColor(...WHITE);
    pdf.setFontSize(26); pdf.setFont("helvetica", "bold");
    pdf.text("Tab Kaunter", W / 2, 22, { align: "center" });
    pdf.setFontSize(14); pdf.setFont("helvetica", "normal");
    pdf.text("Laporan Prestasi Perniagaan Bulanan", W / 2, 32, { align: "center" });
    pdf.setFontSize(11);
    pdf.text("Tempoh Laporan: " + currentKey, W / 2, 42, { align: "center" });

    pdf.setTextColor(...DARK);
    pdf.setFontSize(9);
    pdf.text("Dijana pada: " + new Date().toLocaleString("ms-MY"), W / 2, 60, { align: "center" });
    pdf.text("Dokumen Sulit — Kegunaan Dalaman Pemilik Sahaja", W / 2, 67, { align: "center" });

    // Summary box on cover
    var d = currentReport;
    var s = d.sales || {};
    var r = d.rawMaterials || {};
    var st = d.staffSalary || {};
    var c = d.company || {};

    pdf.setFillColor(...LIGHT);
    pdf.rect(ml, 78, cw, 75, "F");
    pdf.setDrawColor(...AMBER); pdf.setLineWidth(0.8);
    pdf.rect(ml, 78, cw, 75, "S");
    pdf.setFontSize(11); pdf.setFont("helvetica", "bold"); pdf.setTextColor(...DARK);
    pdf.text("Ringkasan Prestasi Bulan Ini", ml + 5, 86);

    var summaryItems = [
      ["Jumlah Pendapatan Jualan", rm(s.grossSalesSubtotalRm), DARK],
      ["Kos Bahan & Pengeluaran", rm(s.totalCogsFifoRm || c.costOfGoodsFifoRm), DARK],
      ["Keuntungan Kasar", rm(s.grossProfitRm || c.grossProfitRm), GREEN],
      ["Anggaran Kos Pekerja", rm(st.activeStaffPayrollEstimateRm || c.payrollEstimateRm), DARK],
      ["Anggaran Keuntungan Bersih", rm(c.netOperatingEstimateRm), c.netOperatingEstimateRm >= 0 ? GREEN : RED]
    ];
    summaryItems.forEach(function (item, i) {
      var ry = 93 + i * 10;
      pdf.setDrawColor(220, 220, 220);
      pdf.line(ml + 5, ry + 2, W - mr - 5, ry + 2);
      pdf.setFontSize(8.5); pdf.setFont("helvetica", "normal"); pdf.setTextColor(...GRAY);
      pdf.text(item[0], ml + 5, ry - 1);
      pdf.setFont("helvetica", "bold"); pdf.setTextColor(...item[2]);
      pdf.text(item[1], W - mr - 5, ry - 1, { align: "right" });
    });

    // Margin kasar
    var margin = s.grossSalesSubtotalRm > 0 ? ((s.grossProfitRm / s.grossSalesSubtotalRm) * 100).toFixed(1) : "0";
    pdf.setFontSize(9); pdf.setFont("helvetica", "normal"); pdf.setTextColor(...GRAY);
    pdf.text("Peratusan Keuntungan Kasar", ml + 5, 152);
    pdf.setFont("helvetica", "bold"); pdf.setTextColor(...GREEN);
    pdf.text(margin + "%", W - mr - 5, 152, { align: "right" });

    var grossSales = typeof s.grossSalesSubtotalRm === "number" ? s.grossSalesSubtotalRm : parseFloat(s.grossSalesSubtotalRm) || 0;
    if (grossSales < 500) {
      pdf.setFontSize(8); pdf.setFont("helvetica", "italic"); pdf.setTextColor(239, 68, 68);
      pdf.text("* Jualan bulan ini rendah — pastikan semua transaksi telah direkodkan.", W / 2, 158, { align: "center" });
      y = 168;
    } else {
      y = 165;
    }
    pdf.setFontSize(8); pdf.setFont("helvetica", "normal"); pdf.setTextColor(...GRAY);
    pdf.text("Laporan ini dijana secara automatik oleh sistem POS Tab Kaunter.", W / 2, y, { align: "center" });
    pdf.text("Data bersumber daripada Firestore (resit POS, belian, lejar bahan, staf).", W / 2, y + 5, { align: "center" });

    // Footer cover
    pdf.setFontSize(8); pdf.setTextColor(...GRAY);
    pdf.text("Tab Kaunter — Laporan Sulit Dalaman", ml, H - 8);
    pdf.text(currentKey, W - mr, H - 8, { align: "right" });

    // ── SECTION 1: JUALAN ─────────────────────────────────────────────────────
    addPage();
    drawSectionHeader("BAHAGIAN 1 — PRESTASI JUALAN", AMBER);

    // Key metrics
    checkY(6); pdf.setFontSize(10); pdf.setFont("helvetica", "bold"); pdf.setTextColor(...DARK);
    pdf.text("Prestasi Jualan Utama", ml, y); y += 6;

    var grossProfit = typeof s.grossProfitRm === "number" ? s.grossProfitRm : 0;
    grossSales = typeof s.grossSalesSubtotalRm === "number" ? s.grossSalesSubtotalRm : parseFloat(s.grossSalesSubtotalRm) || 0;
    var profitMargin = grossSales > 0 ? ((grossProfit / grossSales) * 100).toFixed(1) + "%" : "—";

    drawMetricRow("Jumlah Pendapatan Jualan", rm(s.grossSalesSubtotalRm));
    drawMetricRow("Jumlah Transaksi Berjaya", String(s.nonVoidReceiptCount || 0));
    drawMetricRow("Transaksi Dibatalkan", String(s.voidedReceiptCount || 0));
    drawMetricRow("Nilai Purata Setiap Pelanggan", rm(s.avgNonVoidSubtotalRm));
    drawMetricRow("Anggaran Kos Bahan Digunakan", rm(s.totalCogsFifoRm));
    drawMetricRow("Keuntungan Kasar", rm(s.grossProfitRm), GREEN);
    drawMetricRow("Peratusan Keuntungan Kasar", profitMargin, GREEN);

    // Payment breakdown
    y += 6;
    checkY(10); pdf.setFontSize(10); pdf.setFont("helvetica", "bold"); pdf.setTextColor(...DARK);
    pdf.text("Cara Pembayaran Pelanggan", ml, y); y += 5;
    var by = s.byPaymentMethodRm || {};
    var payLabels = { cash: "Tunai", card: "Kad", qr: "QR / DuitNow", duitnow: "QR / DuitNow", ewallet: "eWallet" };
    var payCols = [{ label: "Cara Bayar", w: 90 }, { label: "Amaun (RM)", w: cw - 90 }];
    drawTableHeader(payCols);
    var payKeys = Object.keys(by);
    payKeys.forEach(function (k, i) {
      drawTableRow(payCols, [payLabels[k] || k, rm(by[k])], i % 2 === 0);
    });
    if (!payKeys.length) drawTableRow(payCols, ["Tiada rekod dijumpai", "—"], false);

    // Cash drawer
    y += 6;
    checkY(10); pdf.setFontSize(10); pdf.setFont("helvetica", "bold"); pdf.setTextColor(...DARK);
    pdf.text("Rekod Laci Wang Tunai", ml, y); y += 5;
    var cd = d.cashDrawer || {};
    drawMetricRow("Bilangan Sesi Ditutup", String(cd.closedShiftsInRange || 0));
    drawMetricRow("Jumlah Perbezaan Wang (RM)", rm(cd.totalVarianceRm));
    var vb = cd.varianceByCategory || {};
    drawMetricRow("Tepat (Tiada Perbezaan)", String(vb.balanced || 0));
    drawMetricRow("Kurang Wang", String(vb.short || 0));
    drawMetricRow("Lebih Wang", String(vb.over || 0));

    // Insight jualan
    y += 6;
    var salesInsight = "Jumlah pendapatan jualan bagi bulan ini ialah " + rm(grossSales) + " dengan keuntungan kasar sebanyak " + rm(grossProfit) + " (" + profitMargin + "). " +
      (grossProfit < 0
        ? "PERHATIAN: Perniagaan mengalami kerugian kasar bulan ini. Sila semak semula penetapan harga jualan dan kurangkan kos bahan dengan segera."
        : parseFloat(profitMargin) < 20
        ? "Peratusan keuntungan masih rendah. Pertimbangkan untuk menaikkan harga jualan produk tertentu atau mencari bahan dengan kos lebih rendah."
        : parseFloat(profitMargin) < 35
        ? "Keuntungan berada pada tahap sederhana. Fokus kepada peningkatan jualan pada waktu puncak dan kurangkan pembaziran bahan."
        : "Prestasi jualan sangat baik bulan ini. Teruskan strategi semasa dan cari peluang untuk memperluaskan jualan produk popular.");
    drawInsightBox("Rumusan & Cadangan — Jualan", salesInsight);

    // ── SECTION 2: BAHAN MENTAH ───────────────────────────────────────────────
    addPage();
    drawSectionHeader("BAHAGIAN 2 — PERBELANJAAN BAHAN & STOK", [59, 130, 246]);

    checkY(6); pdf.setFontSize(10); pdf.setFont("helvetica", "bold"); pdf.setTextColor(...DARK);
    pdf.text("Ringkasan Perbelanjaan Bahan Mentah", ml, y); y += 6;

    drawMetricRow("Jumlah Perbelanjaan Pembelian", rm(r.purchaseHistoryTotalRm));
    drawMetricRow("Bilangan Rekod Pembelian", String(r.purchaseHistoryDocumentCount || 0));
    drawMetricRow("Jumlah Rekod Lejar (RM)", rm(r.ledgerSpendInitialPurchaseAdjustRm));
    drawMetricRow("Bilangan Rekod Penggunaan", String(r.ingredientLedgerEntriesInRange || 0));

    // Nisbah COGS
    y += 2;
    var cogsRatio = grossSales > 0 ? (((s.totalCogsFifoRm || 0) / grossSales) * 100).toFixed(1) : "0";
    drawMetricRow("Peratusan Kos Bahan daripada Jualan", cogsRatio + "%", parseFloat(cogsRatio) > 40 ? RED : GREEN);

    // Top ingredients table
    y += 6;
    checkY(10); pdf.setFontSize(10); pdf.setFont("helvetica", "bold"); pdf.setTextColor(...DARK);
    pdf.text("Bahan Paling Banyak Dibelanjakan", ml, y); y += 5;
    var ingCols = [{ label: "Nama Bahan", w: 80 }, { label: "Bil. Rekod", w: 30 }, { label: "Jumlah Dibelanjakan (RM)", w: cw - 110 }];
    drawTableHeader(ingCols);
    var topIng = r.topIngredientsByLedgerSpendRm || [];
    topIng.slice(0, 10).forEach(function (x, i) {
      drawTableRow(ingCols, [x.name || x.ingredientId, String(x.entryCount || 0), rm(x.ledgerSpendRm)], i % 2 === 0);
    });
    if (!topIng.length) drawTableRow(ingCols, ["Tiada rekod dijumpai", "—", "—"], false);

    // Top purchases table
    y += 6;
    checkY(10); pdf.setFontSize(10); pdf.setFont("helvetica", "bold"); pdf.setTextColor(...DARK);
    pdf.text("Pembelian Terbesar Bulan Ini", ml, y); y += 5;
    var purCols = [{ label: "Nombor Rekod", w: 60 }, { label: "Nama Pembekal", w: 60 }, { label: "Jumlah (RM)", w: cw - 120 }];
    drawTableHeader(purCols);
    var topPur = r.purchaseTop || [];
    topPur.slice(0, 8).forEach(function (x, i) {
      drawTableRow(purCols, [x.id || "—", x.supplier || "—", rm(x.totalAmountRm)], i % 2 === 0);
    });
    if (!topPur.length) drawTableRow(purCols, ["Tiada rekod dijumpai", "—", "—"], false);

    var rawInsight = "Jumlah perbelanjaan pembelian bahan mentah bulan ini ialah " + rm(r.purchaseHistoryTotalRm) + ". " +
      (grossSales < 100
        ? "PERHATIAN: Jualan bulan ini sangat rendah (" + rm(grossSales) + "). Nisbah perbelanjaan tidak bermakna. Pastikan semua transaksi jualan telah direkodkan."
        : parseFloat(cogsRatio) > 50
        ? "Kos bahan sangat tinggi. Semak semula penggunaan bahan dan pertimbangkan berunding harga dengan pembekal."
        : parseFloat(cogsRatio) > 35
        ? "Kos bahan agak tinggi. Pantau penggunaan bahan harian."
        : "Kos bahan terkawal dengan baik.");
    y += 4;
    drawInsightBox("Rumusan & Cadangan — Bahan Mentah", rawInsight);

    // ── SECTION 3: GAJI KAKITANGAN ────────────────────────────────────────────
    addPage();
    drawSectionHeader("BAHAGIAN 3 — KOS & PRESTASI PEKERJA", [139, 92, 246]);

    checkY(6); pdf.setFontSize(10); pdf.setFont("helvetica", "bold"); pdf.setTextColor(...DARK);
    pdf.text("Ringkasan Kos Pekerja", ml, y); y += 6;

    var activeStaff = (st.lines || []).filter(function (x) { return x.employmentStatus === "active"; });
    var totalPayroll = st.activeStaffPayrollEstimateRm || 0;
    var payrollRatio = grossSales > 0 ? ((totalPayroll / grossSales) * 100).toFixed(1) : "0";

    drawMetricRow("Anggaran Jumlah Gaji Pekerja Aktif", rm(totalPayroll));
    drawMetricRow("Jumlah Pekerja Sedang Bertugas", String(activeStaff.length));
    drawMetricRow("Peratusan Kos Pekerja daripada Jualan", payrollRatio + "%", parseFloat(payrollRatio) > 35 ? RED : GREEN);
    drawMetricRow("Purata Gaji Setiap Pekerja", activeStaff.length > 0 ? rm(totalPayroll / activeStaff.length) : "—");

    y += 6;
    checkY(10); pdf.setFontSize(10); pdf.setFont("helvetica", "bold"); pdf.setTextColor(...DARK);
    pdf.text("Senarai Pekerja & Gaji", ml, y); y += 5;
    var staffCols = [
      { label: "Nama", w: 42 },
      { label: "Jawatan", w: 28 },
      { label: "Status", w: 22 },
      { label: "Bayaran", w: 24 },
      { label: "Bln Ini", w: 26 },
      { label: "Ter kumpul", w: cw - 142 }
    ];
    drawTableHeader(staffCols);
    (st.lines || []).forEach(function (x, i) {
      var roleMap = { cashier: "Kaunter", kitchen: "Dapur", runner: "Runner", supervisor: "Penyelia" };
      var statusMap = { active: "Aktif", leave: "Cuti", terminated: "Berhenti" };
      drawTableRow(staffCols, [
        x.name || "—",
        roleMap[x.role] || x.role || "—",
        statusMap[x.employmentStatus] || x.employmentStatus || "—",
        x.payType === "hourly" ? "Mengikut Jam" : "Gaji Tetap",
        rm(x.estimatedMonthlySalaryRm),
        rm(x.accumulatedSalaryRm)
      ], i % 2 === 0);
    });
    if (!(st.lines || []).length) drawTableRow(staffCols, ["Tiada rekod dijumpai", "—", "—", "—", "—", "—"], false);

    var staffInsight = "Anggaran kos pekerja bagi " + activeStaff.length + " orang pekerja aktif ialah " + rm(totalPayroll) + ". " +
      (grossSales < totalPayroll
        ? "PERHATIAN: Jualan bulan ini (" + rm(grossSales) + ") jauh lebih rendah daripada kos gaji (" + rm(totalPayroll) + "). Ini mungkin kerana jualan belum direkodkan sepenuhnya. Pastikan semua transaksi direkodkan dalam sistem."
        : parseFloat(payrollRatio) > 40
        ? "Kos pekerja agak tinggi berbanding jualan. Pastikan jadual bertugas disusun mengikut waktu puncak jualan."
        : "Kos pekerja terkawal dengan baik.");
    y += 4;
    drawInsightBox("Rumusan & Cadangan — Pekerja", staffInsight);

    // ── SECTION 4: KESELURUHAN P&L ────────────────────────────────────────────
    addPage();
    drawSectionHeader("BAHAGIAN 4 — RINGKASAN KEWANGAN KESELURUHAN", [16, 185, 129]);

    checkY(6); pdf.setFontSize(10); pdf.setFont("helvetica", "bold"); pdf.setTextColor(...DARK);
    pdf.text("Penyata Keuntungan & Kerugian", ml, y); y += 6;

    var netOp = c.netOperatingEstimateRm || 0;
    drawMetricRow("(+) Pendapatan Jualan", rm(c.revenuePosReceiptsRm));
    drawMetricRow("(-) Kos Bahan Digunakan", rm(c.costOfGoodsFifoRm));
    drawMetricRow("= Keuntungan Kasar", rm(c.grossProfitRm), c.grossProfitRm >= 0 ? GREEN : RED);
    y += 2;
    y += 3;
    checkY(6); pdf.setFontSize(7.5); pdf.setFont("helvetica", "italic"); pdf.setTextColor(...GRAY);
    pdf.text("Maklumat Tambahan (tidak termasuk dalam pengiraan operasi bersih):", ml + 3, y); y += 5;
    drawMetricRow("  Jumlah Pembelian Stok Bulan Ini", rm(c.inventoryPurchasesRecordedRm));
    drawMetricRow("(-) Kos Gaji Pekerja", rm(c.payrollEstimateRm));
    drawMetricRow("(-) Perbelanjaan Lain-lain", rm(c.otherExpensesRm));
    y += 2;
    pdf.setFillColor(...(netOp >= 0 ? [209, 250, 229] : [254, 226, 226]));
    pdf.rect(ml, y, cw, 10, "F");
    pdf.setDrawColor(...(netOp >= 0 ? GREEN : RED)); pdf.setLineWidth(0.8);
    pdf.rect(ml, y, cw, 10, "S");
    pdf.setFontSize(11); pdf.setFont("helvetica", "bold");
    pdf.setTextColor(...(netOp >= 0 ? GREEN : RED));
    pdf.text("= Anggaran Keuntungan Bersih", ml + 3, y + 7);
    pdf.text(rm(netOp), W - mr - 3, y + 7, { align: "right" });
    y += 14;

    // Margin summary
    y += 6;
    checkY(30);
    pdf.setFontSize(10); pdf.setFont("helvetica", "bold"); pdf.setTextColor(...DARK);
    pdf.text("Analisis Peratusan Keuntungan", ml, y); y += 5;
    drawMetricRow("Peratusan Keuntungan Kasar", pct(c.grossProfitRm, c.revenuePosReceiptsRm), GREEN);
    drawMetricRow("Peratusan Keuntungan Bersih (Anggaran)", pct(netOp, c.revenuePosReceiptsRm), netOp >= 0 ? GREEN : RED);
    drawMetricRow("Peratusan Kos Bahan", pct(c.costOfGoodsFifoRm, c.revenuePosReceiptsRm));
    drawMetricRow("Peratusan Kos Pekerja", pct(c.payrollEstimateRm, c.revenuePosReceiptsRm));

    var plInsight = (grossSales < 100 ? "PERHATIAN: Jualan bulan ini sangat rendah (" + rm(grossSales) + "). Laporan ini mungkin tidak menggambarkan prestasi sebenar. Pastikan semua transaksi telah direkodkan. " : "") +
      (netOp >= 0
        ? "Syarikat mencatatkan anggaran keuntungan bersih sebanyak " + rm(netOp) + " bagi bulan ini. "
        : "Syarikat mengalami anggaran kerugian bersih sebanyak " + rm(Math.abs(netOp)) + " bagi bulan ini. ") +
      "Formula: Jualan (" + rm(c.revenuePosReceiptsRm) + ") - Kos Bahan (" + rm(c.costOfGoodsFifoRm) + ") - Gaji (" + rm(c.payrollEstimateRm) + "). " +
      (grossSales < totalPayroll
        ? "Jualan perlu ditingkatkan sekurang-kurangnya kepada " + rm(totalPayroll * 2) + " sebulan untuk mencapai titik pulang modal."
        : netOp < 0
        ? "Tingkatkan jualan, semak harga produk, dan optimumkan jadual pekerja."
        : "Prestasi kewangan bulan ini memuaskan.");
    y += 4;
    drawInsightBox("Rumusan & Cadangan — Kewangan", plInsight);

    // ── PENUTUP ───────────────────────────────────────────────────────────────
    checkY(40);
    y += 8;
    pdf.setFillColor(...LIGHT);
    pdf.rect(ml, y, cw, 30, "F");
    pdf.setFontSize(9); pdf.setFont("helvetica", "bold"); pdf.setTextColor(...DARK);
    pdf.text("Nota Penting", ml + 5, y + 8);
    pdf.setFont("helvetica", "normal"); pdf.setTextColor(...GRAY);
    var notes = [
      "• Laporan ini dijana secara automatik berdasarkan data sistem POS untuk tempoh " + currentKey + ".",
      "• Formula: Keuntungan Kasar = Jualan - Kos Bahan (FIFO). Keuntungan Bersih = Keuntungan Kasar - Gaji Pekerja.",
      "• Pembelian stok dipaparkan sebagai maklumat tambahan dan tidak ditolak dari keuntungan bersih.",
      "• Anggaran gaji dikira berdasarkan kadar setiap jam x 160 jam atau gaji tetap bulanan.",
      "• Angka ini adalah anggaran. Sila rujuk akauntan untuk penyata kewangan rasmi."
    ];
    notes.forEach(function (n, i) {
      pdf.text(n, ml + 5, y + 14 + i * 5);
    });
    y += 34;

    pdf.save("laporan-" + currentKey + ".pdf");
    setStatus("PDF berjaya dimuat turun: laporan-" + currentKey + ".pdf", "ok");

  } catch (err) {
    console.error(err);
    setStatus("Gagal jana PDF: " + (err.message || String(err)), "err");
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-file-pdf"></i> Muat turun PDF'; }
  }
}

// ── Report History ────────────────────────────────────────────────────────────
async function loadReportHistory() {
  var listEl = $("mr-history-list");
  if (!listEl) return;
  try {
    await ensureAuthReady();
    var q = query(collection(db, COL_MONTHLY_REPORTS), orderBy("generatedAt", "desc"), limit(24));
    var snap = await getDocs(q);
    if (snap.empty) {
      listEl.innerHTML = '<p class="mr-note">Tiada sejarah.</p>';
      return;
    }
    listEl.innerHTML = snap.docs
      .map(function (d) {
        var key = d.id;
        var isActive = key === currentKey ? " is-active" : "";
        return (
          '<button type="button" class="mr-history-item' +
          isActive +
          '" data-key="' +
          escapeHtml(key) +
          '">' +
          escapeHtml(key) +
          "</button>"
        );
      })
      .join("");
  } catch (e) {
    console.warn("[mr-history]", e);
    listEl.innerHTML =
      '<p class="mr-note">Sejarah tidak dimuatkan' +
      (e && e.code === "permission-denied" ? " — log masuk sebagai pemilik/pentadbir." : ".") +
      "</p>";
  }
}

function renderChartsForActiveTab(d) {
  d = d || currentReport;
  if (!d) return;
  loadChartJs(function () {
    destroyCharts();
    if (activeTabId === "sales") renderSalesChart(d);
    else if (activeTabId === "raw") renderRawChart(d);
    else if (activeTabId === "staff") renderStaffChart(d);
    else if (activeTabId === "company") renderCompanyChart(d);
  });
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

function renderCashDrawerSection(cd) {
  cd = cd || {};
  var vb = cd.varianceByCategory || {};
  var rows = [
    { label: "Bilangan Sesi Ditutup", html: escapeHtml(String(cd.closedShiftsInRange != null ? cd.closedShiftsInRange : "—")) },
    { label: "Jumlah Perbezaan Wang (RM)", html: escapeHtml(formatRM(cd.totalVarianceRm)) },
    { label: "Tepat (Tiada Perbezaan)", html: escapeHtml(String(vb.balanced != null ? vb.balanced : "—")) },
    { label: "Kurang Wang", html: escapeHtml(String(vb.short != null ? vb.short : "—")) },
    { label: "Lebih Wang", html: escapeHtml(String(vb.over != null ? vb.over : "—")) },
    { label: "Tidak Dapat Disahkan", html: escapeHtml(String(vb.unknown != null ? vb.unknown : "—")) }
  ];
  var sample = (cd.shiftsSample || [])
    .map(function (x) {
      return (
        "<tr><td>" +
        escapeHtml(x.shiftId || "—") +
        "</td><td>" +
        escapeHtml(x.varianceCategory || "—") +
        "</td><td>" +
        escapeHtml(x.varianceRm != null && !isNaN(x.varianceRm) ? formatRM(x.varianceRm) : "—") +
        "</td></tr>"
      );
    })
    .join("");
  return (
    "<h3 class=\"mr-subhead\">Laci tunai (POS shift)</h3>" +
    renderMetrics(rows) +
    '<p class="mr-note">' +
    escapeHtml(
      cd.note ||
        "Rekod berdasarkan sesi yang telah ditutup dalam bulan ini. Perbezaan wang dikira daripada amaun dijangkakan berbanding amaun sebenar semasa penutupan sesi."
    ) +
    "</p>" +
    '<div class="mr-table-wrap"><table class="mr-table"><thead><tr><th>Nombor Sesi</th><th>Status</th><th>Perbezaan Wang</th></tr></thead><tbody>' +
    (sample || "<tr><td colspan=\"3\">Tiada rekod shift ditutup dalam julat ini</td></tr>") +
    "</tbody></table></div>"
  );
}

function renderYearlyBreakdownTable(d) {
  var rows = Array.isArray(d.monthlyBreakdown) ? d.monthlyBreakdown : [];
  if (!rows.length) return "";
  var body = rows
    .map(function (r) {
      return (
        "<tr><td>" +
        escapeHtml(r.monthKey || "—") +
        "</td><td>" +
        escapeHtml(String(r.nonVoidReceiptCount != null ? r.nonVoidReceiptCount : 0)) +
        "</td><td>" +
        escapeHtml(formatRM(r.grossSalesSubtotalRm)) +
        "</td><td>" +
        escapeHtml(formatRM(r.totalCogsFifoRm)) +
        "</td><td>" +
        escapeHtml(formatRM(r.grossProfitRm)) +
        "</td></tr>"
      );
    })
    .join("");
  return (
    '<h3 class="mr-subhead">Pecahan bulanan</h3>' +
    '<div class="mr-table-wrap"><table class="mr-table"><thead><tr><th>Bulan</th><th>Resit</th><th>Jualan</th><th>COGS</th><th>Untung kasar</th></tr></thead><tbody>' +
    body +
    "</tbody></table></div>"
  );
}

function renderSalesPanel(d) {
  var s = d.sales || {};
  var rows = [
    {
      label: "Jumlah Rekod Transaksi",
      html: escapeHtml(String(s.posReceiptDocumentsInRange != null ? s.posReceiptDocumentsInRange : "—"))
    },
    { label: "Transaksi Berjaya", html: escapeHtml(String(s.nonVoidReceiptCount != null ? s.nonVoidReceiptCount : "—")) },
    { label: "Transaksi Dibatalkan", html: escapeHtml(String(s.voidedReceiptCount != null ? s.voidedReceiptCount : "—")) },
    { label: "Jumlah Pendapatan Jualan", html: escapeHtml(formatRM(s.grossSalesSubtotalRm)) },
    {
      label: "Nilai Purata Setiap Pelanggan",
      html: (function () {
        var avg = s.avgNonVoidSubtotalRm;
        var n = s.nonVoidReceiptCount != null ? s.nonVoidReceiptCount : 0;
        if ((avg == null || isNaN(avg)) && n > 0) {
          var g = typeof s.grossSalesSubtotalRm === "number" ? s.grossSalesSubtotalRm : parseFloat(s.grossSalesSubtotalRm) || 0;
          avg = g / n;
        }
        return escapeHtml(avg != null && !isNaN(avg) && n > 0 ? formatRM(avg) : "—");
      })()
    },
    { label: "Anggaran Kos Bahan Digunakan", html: escapeHtml(formatRM(s.totalCogsFifoRm)) },
    { label: "Keuntungan Kasar", html: escapeHtml(formatRM(s.grossProfitRm)) }
  ];
  var payLabels = { cash: "Tunai", card: "Kad", qr: "QR / DuitNow", duitnow: "QR / DuitNow", ewallet: "eWallet" };
  var by = s.byPaymentMethodRm || {};
  var payRows = Object.keys(by)
    .sort()
    .map(function (k) {
      return (
        "<tr><td>" +
        escapeHtml(payLabels[k] || k) +
        "</td><td>" +
        escapeHtml(formatRM(by[k])) +
        "</td></tr>"
      );
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
    '<div class="mr-chart-wrap"><canvas id="mr-chart-sales" height="260"></canvas></div>' +
    renderMetrics(rows) +
    (d.monthlyBreakdown ? renderYearlyBreakdownTable(d) : "") +
    renderCashDrawerSection(d.cashDrawer) +
    '<div class="mr-table-wrap"><table class="mr-table"><thead><tr><th>Cara Pembayaran</th><th>Amaun (RM)</th></tr></thead><tbody>' +
    (payRows || "<tr><td colspan=\"2\">Tiada data</td></tr>") +
    "</tbody></table></div>" +
    legacy
  );
}

function renderRawPanel(d) {
  var r = d.rawMaterials || {};
  var rows1 = [
    { label: "Jumlah Pembelian Bahan & Stok", html: escapeHtml(formatRM(r.purchaseHistoryTotalRm)) },
    { label: "Bilangan Rekod Pembelian", html: escapeHtml(String(r.purchaseHistoryDocumentCount != null ? r.purchaseHistoryDocumentCount : "—")) },
    {
      label: "Jumlah Rekod Penggunaan Bahan (RM)",
      html: escapeHtml(formatRM(r.ledgerSpendInitialPurchaseAdjustRm))
    },
    { label: "Bilangan Rekod Bahan", html: escapeHtml(String(r.ingredientLedgerEntriesInRange != null ? r.ingredientLedgerEntriesInRange : "—")) }
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
    '<div class="mr-chart-wrap"><canvas id="mr-chart-raw" height="260"></canvas></div>' +
    renderMetrics(rows1) +
    "<h3>Pembelian Terbesar Bulan Ini</h3>" +
    '<div class="mr-table-wrap"><table class="mr-table"><thead><tr><th>Nombor Rekod</th><th>Amaun (RM)</th><th>Nama Pembekal</th></tr></thead><tbody>' +
    (pt || "<tr><td colspan=\"3\">Tiada</td></tr>") +
    "</tbody></table></div>" +
    "<h3>Bahan Paling Banyak Dibelanjakan</h3>" +
    '<div class="mr-table-wrap"><table class="mr-table"><thead><tr><th>Nama Bahan</th><th>Kekerapan Rekod</th><th>Jumlah Dibelanjakan (RM)</th></tr></thead><tbody>' +
    (ing || "<tr><td colspan=\"3\">Tiada</td></tr>") +
    "</tbody></table></div>" +
    '<p class="mr-note">' +
    escapeHtml(
      r.boundsNote ||
        "Data pembelian bahan diambil daripada rekod pembelian dan penggunaan bahan dalam sistem. Ini adalah anggaran berdasarkan rekod yang dimasukkan oleh Owner."
    ) +
    "</p>"
  );
}

function renderStaffPanel(d) {
  var s = d.staffSalary || {};
  var lines = s.lines || [];
  var roleMap = { cashier: "Kaunter", kitchen: "Dapur", runner: "Penghantar", supervisor: "Penyelia" };
  var statusMap = { active: "Aktif", leave: "Cuti", terminated: "Berhenti" };
  var payMap = { hourly: "Mengikut Jam", monthly: "Gaji Tetap", salary: "Gaji Tetap" };
  var body = lines
    .map(function (x) {
      var role = x.role || "—";
      var status = x.employmentStatus || "—";
      var pay = x.payType || "—";
      return (
        "<tr><td>" +
        escapeHtml(x.name) +
        "</td><td>" +
        escapeHtml(roleMap[role] || role) +
        "</td><td>" +
        escapeHtml(statusMap[status] || status) +
        "</td><td>" +
        escapeHtml(payMap[pay] || pay) +
        "</td><td>" +
        escapeHtml(formatRM(x.payAmount)) +
        "</td><td>" +
        escapeHtml(formatRM(x.estimatedMonthlySalaryRm)) +
        "</td><td>" +
        escapeHtml(formatRM(x.accumulatedSalaryRm)) +
        "</td></tr>"
      );
    })
    .join("");
  return (
    '<div class="mr-chart-wrap"><canvas id="mr-chart-staff" height="260"></canvas></div>' +
    renderMetrics([
      {
        label: "Anggaran Jumlah Gaji Pekerja Aktif",
        html: escapeHtml(formatRM(s.activeStaffPayrollEstimateRm))
      },
      { label: "Jumlah Pekerja Berdaftar", html: escapeHtml(String(lines.length)) }
    ]) +
    '<p class="mr-note">' +
    escapeHtml(
      s.note ||
        "Anggaran gaji bulan ini prorata mengikut tarikh mula kerja. Jumlah terkumpul = jumlah gaji dari tarikh mula hingga akhir bulan laporan."
    ) +
    "</p>" +
    '<div class="mr-table-wrap"><table class="mr-table"><thead><tr><th>Nama Pekerja</th><th>Jawatan</th><th>Status Kerja</th><th>Jenis Pembayaran</th><th>Kadar Gaji</th><th>Gaji Bulan Ini</th><th>Jumlah Terkumpul</th></tr></thead><tbody>' +
    (body || "<tr><td colspan=\"7\">Tiada kakitangan</td></tr>") +
    "</tbody></table></div>"
  );
}

function renderCompanyPanel(d) {
  var c = d.company || {};
  var rows = [
    { label: "Pendapatan Jualan", html: escapeHtml(formatRM(c.revenuePosReceiptsRm)) },
    { label: "Kos Bahan Digunakan (FIFO)", html: escapeHtml(formatRM(c.costOfGoodsFifoRm)) },
    { label: "Keuntungan Kasar", html: escapeHtml(formatRM(c.grossProfitRm)) },
    { label: "Pembelian Bahan & Stok", html: escapeHtml(formatRM(c.inventoryPurchasesRecordedRm)) },
    { label: "Kos Gaji Pekerja", html: escapeHtml(formatRM(c.payrollEstimateRm)) },
    { label: "Perbelanjaan Lain-lain", html: escapeHtml(formatRM(c.otherExpensesRm)) },
    { label: "Anggaran Keuntungan Bersih", html: escapeHtml(formatRM(c.netOperatingEstimateRm)) }
  ];
  return (
    '<div class="mr-chart-wrap"><canvas id="mr-chart-company" height="260"></canvas></div>' +
    renderMetrics(rows) +
    '<p class="mr-note">' +
    escapeHtml(
      "Keuntungan bersih dikira daripada: Pendapatan Jualan - Kos Bahan - Gaji Pekerja. Pembelian stok ditunjukkan sebagai maklumat tambahan sahaja. Angka ini adalah anggaran untuk rujukan dalaman."
    ) +
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
  if (!currentReport) {
    renderEmpty();
  }
  updateTabPanelsVisibility();
  renderChartsForActiveTab(currentReport);
  var panel = $("mr-panel-" + activeTabId);
  if (panel && typeof panel.scrollIntoView === "function") {
    panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

function renderEmpty() {
  var genHint = isElevatedRole()
    ? " Tekan <strong>Jana laporan</strong> untuk mengira dan menyimpan agregat daripada Firestore untuk bulan ini."
    : " Minta pemilik / pentadbir menjana laporan untuk bulan ini.";
  var msg =
    '<p class="mr-panel__empty">Tiada data tersedia untuk tempoh ini (<strong>' +
    escapeHtml(currentKey) +
    "</strong>). Tiada dokumen <code class=\"mr-code\">monthly_reports/" +
    escapeHtml(currentKey) +
    "</code>." +
    genHint +
    "</p>";
  TAB_ORDER.forEach(function (id) {
    var p = $("mr-panel-" + id);
    if (p) p.innerHTML = msg;
  });
  destroyCharts();
  var pdfBtn = $("mr-download-pdf");
  if (pdfBtn) pdfBtn.disabled = true;
  resetAiSection();
  updateTabPanelsVisibility();
  loadReportHistory();
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

  renderChartsForActiveTab(d);
  resetAiSection();

  var pdfBtn = $("mr-download-pdf");
  if (pdfBtn) pdfBtn.disabled = false;

  loadReportHistory();
}

/**
 * Ambil laporan daripada Firestore; kemas kini skrin.
 * @param {{ silentStatus?: boolean }} [opts]
 */
async function loadReport(opts) {
  if (!$("mr-year")) return;
  var silent = opts && opts.silentStatus;
  reportPeriod = getReportPeriod();
  var sel = selectedYearMonth();
  if (reportPeriod === "year") {
    currentKey = yearDocId(sel.year);
  } else {
    if (!$("mr-month")) return;
    currentKey = monthDocId(sel.year, sel.month);
  }
  if (!silent) setStatus("Memuatkan…", null);

  try {
    var u = await ensureAuthReady();
    if (!u) {
      if (!silent) setStatus("Sesi log masuk tidak dijumpai. Sila log masuk semula.", "err");
      renderEmpty();
      return;
    }

    var col = reportPeriod === "year" ? COL_YEARLY_REPORTS : COL_MONTHLY_REPORTS;
    var snap = await getDoc(doc(db, col, currentKey));
    if (!snap.exists()) {
      currentReport = null;
      if (!silent) {
        setStatus(
          "Tiada data tersedia untuk tempoh ini — belum ada laporan disimpan untuk " + currentKey + ".",
          null
        );
      }
      renderEmpty();
      return;
    }
    currentReport = snap.data();
    if (!silent) setStatus("Laporan dimuatkan daripada Firestore.", "ok");
    renderAllPanels();
  } catch (e) {
    console.warn(e);
    currentReport = null;
    if (!silent) {
      var msg = e.message || "Gagal memuatkan laporan daripada Firestore.";
      if (e && e.code === "permission-denied") {
        msg = "Akses ditolak — hanya pemilik/pentadbir boleh membaca laporan.";
      }
      setStatus(msg, "err");
    }
    renderEmpty();
  }
}

/** Muat turun fail JSON laporan semasa (perlu currentReport). */
function downloadCurrentReportJson() {
  if (!currentReport || !currentKey) return false;
  try {
    var text = JSON.stringify(currentReport, null, 2);
    var blob = new Blob([text], { type: "application/json;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = (reportPeriod === "year" ? "laporan-tahunan-" : "laporan-bulanan-") + currentKey + ".json";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return true;
  } catch (e) {
    console.error(e);
    setStatus(e.message || "Gagal menyedi fail muat turun.", "err");
    return false;
  }
}

/** Muat data + muat turun fail JSON (butang utama). */
async function onDownloadClick() {
  var btn = $("mr-load");
  if (btn) {
    btn.disabled = true;
    btn.setAttribute("aria-busy", "true");
  }
  try {
    await loadReport({});
    if (currentReport) {
      if (downloadCurrentReportJson()) {
        setStatus(
          "Fail JSON dimuat turun: " +
            (reportPeriod === "year" ? "laporan-tahunan-" : "laporan-bulanan-") +
            currentKey +
            ".json",
          "ok"
        );
      }
    } else {
      setStatus("Tiada laporan untuk dimuat turun — tiada dokumen untuk " + currentKey + ".", null);
    }
  } catch (e) {
    console.error(e);
    setStatus(e.message || String(e), "err");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.removeAttribute("aria-busy");
    }
  }
}

async function onGenerate() {
  if (!isElevatedRole()) {
    window.alert("Hanya pemilik / pentadbir boleh menjana laporan.");
    return;
  }
  var u = await ensureAuthReady();
  if (!u) {
    window.alert("Sesi log masuk tidak dijumpai. Sila log masuk semula.");
    return;
  }
  reportPeriod = getReportPeriod();
  var sel = selectedYearMonth();
  var now = new Date();
  if (reportPeriod === "year") {
    if (sel.year > now.getFullYear()) {
      window.alert("Tahun hadapan tidak boleh dijana.");
      return;
    }
  } else if (sel.year > now.getFullYear() || (sel.year === now.getFullYear() && sel.month > now.getMonth() + 1)) {
    window.alert("Bulan hadapan tidak boleh dijana.");
    return;
  }

  var btn = $("mr-generate");
  var btnLoad = $("mr-load");
  setStatus("Menjana laporan (boleh ambil masa jika data banyak)…", null);
  if (btn) {
    btn.disabled = true;
    btn.setAttribute("aria-busy", "true");
  }
  if (btnLoad) btnLoad.disabled = true;
  try {
    if (reportPeriod === "year") {
      await generateAndWriteYearlyReport(sel.year, {
        source: "user_regenerate",
        actorUid: auth.currentUser ? auth.currentUser.uid : ""
      });
      setStatus("Laporan tahunan " + yearDocId(sel.year) + " disimpan ke Firestore.", "ok");
    } else {
      await generateAndWriteMonthlyReport(sel.year, sel.month, {
        source: "user_regenerate",
        actorUid: auth.currentUser ? auth.currentUser.uid : ""
      });
      setStatus("Laporan " + monthDocId(sel.year, sel.month) + " disimpan ke Firestore.", "ok");
    }
    await loadReport({ silentStatus: true });
  } catch (e) {
    console.error(e);
    var errMsg = e.message || String(e);
    if (e && e.code === "permission-denied") {
      errMsg = "Gagal jana laporan — hanya akaun pemilik boleh menulis ke Firestore.";
    }
    setStatus(errMsg, "err");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.removeAttribute("aria-busy");
    }
    if (btnLoad) btnLoad.disabled = false;
  }
}

async function maybeAutoGenerateLastMonth() {
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
    setStatus("Laporan automatik untuk " + key + " telah dijana dan disimpan.", "ok");
    var sel = selectedYearMonth();
    if (monthDocId(sel.year, sel.month) === key) await loadReport({ silentStatus: true });
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

wireTabs();

var yEl = $("mr-year");
var mEl = $("mr-month");
function onPeriodChange() {
  updatePeriodUi();
  setStatus("", null);
  loadReport({ silentStatus: true });
}

var pEl = $("mr-period");
if (pEl) {
  pEl.addEventListener("change", onPeriodChange);
}
updatePeriodUi();

if (yEl) {
  yEl.addEventListener("change", onPeriodChange);
}
if (mEl) {
  mEl.addEventListener("change", onPeriodChange);
}

var btnLoad = $("mr-load");
var btnGen = $("mr-generate");
if (btnLoad) {
  btnLoad.addEventListener("click", async function () {
    btnLoad.disabled = true;
    try {
      await loadReport({});
    } finally {
      btnLoad.disabled = false;
    }
  });
}
if (btnGen) {
  btnGen.addEventListener("click", function () {
    onGenerate();
  });
}

var pdfBtn = $("mr-download-pdf");
if (pdfBtn) pdfBtn.addEventListener("click", downloadPdf);

var btnAiGenerate = $("mr-ai-generate");
if (btnAiGenerate) {
  btnAiGenerate.addEventListener("click", function () {
    onGenerateAiAnalysis();
  });
}

document.addEventListener("click", function (e) {
  var btn = e.target.closest(".mr-ai-refresh");
  if (!btn || !currentReport) return;
  generateReportAiAnalysis(currentReport);
});

document.addEventListener("click", function (e) {
  var btn = e.target.closest(".mr-history-item");
  if (!btn) return;
  var key = btn.getAttribute("data-key");
  if (!key) return;
  var parts = key.split("-");
  if (parts.length === 2) {
    var yEl = $("mr-year");
    var mEl = $("mr-month");
    if (yEl) yEl.value = parts[0];
    if (mEl) mEl.value = String(parseInt(parts[1], 10));
    var pEl = $("mr-period");
    if (pEl) pEl.value = "month";
    updatePeriodUi();
  } else if (parts.length === 1 && parts[0].length === 4) {
    var yEl2 = $("mr-year");
    if (yEl2) yEl2.value = parts[0];
    var pEl2 = $("mr-period");
    if (pEl2) pEl2.value = "year";
    updatePeriodUi();
  }
  loadReport({});
});

if (btnGen && !isElevatedRole()) {
  btnGen.disabled = true;
  btnGen.title = "Jana laporan: pemilik / pentadbir sahaja.";
}

updateTabPanelsVisibility();

(async function () {
  try {
    var u = await ensureAuthReady();
    if (!u) {
      setStatus("Sesi Firebase belum sedia — sila log masuk semula, kemudian muat semula halaman.", "err");
      loadReportHistory();
      return;
    }
    loadReportHistory();
    await maybeAutoGenerateLastMonth();
    await loadReport({ silentStatus: true });
    if (currentReport) {
      setStatus("Laporan sedia. Muat turun PDF atau jana analisis AI di bahagian bawah.", "ok");
    } else {
      setStatus(
        "Tiada laporan untuk tempoh ini. Pilih bulan lain, klik Sejarah, atau tekan Jana laporan (pemilik).",
        null
      );
    }
  } catch (e) {
    console.error(e);
    setStatus(e.message || String(e), "err");
  }
})();
