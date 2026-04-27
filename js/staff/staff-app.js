/**
 * Dashboard Kakitangan — pejabat belakang Klik Burger.
 */
import { Timestamp } from "../firebase/init.js";
import { docToStaff, STAFF_ROLES_MS, STAFF_STATUS_MS, SHIFT_LABELS_MS } from "./staff-mappers.js";
import {
  subscribeStaff,
  subscribeStaffActivity,
  subscribeRecentSales,
  addStaff,
  persistStaff,
  removeStaff,
  getStaffSettings,
  saveStaffSettings,
  fetchSalesForStaff
} from "./staff-repository.js";
import {
  aggregateStaffSales,
  staffOnDutyToday,
  serviceRatingProxy,
  attendanceRatePct,
  performanceTier,
  TIER_MS,
  rankStats,
  teamRevenue,
  bonusPoolEstimate,
  parseSaleDoc,
  inMonth
} from "./staff-analytics.js";

function pad2(n) {
  return (n < 10 ? "0" : "") + n;
}

var staffList = [];
var saleDocs = [];
var activityDocs = [];
var settings = { teamMonthlyTargetRm: 15000, bonusRateAboveTarget: 0.03, ratingBase: 3.6 };
var filterMonthStr = "";
var filterStatus = "active";
var filterShift = "all";

var DAY_NAMES_MS = ["Ahad", "Isnin", "Selasa", "Rabu", "Khamis", "Jumaat", "Sabtu"];
var SHIFT_OPTIONS = [
  { v: "pagi", l: SHIFT_LABELS_MS.pagi },
  { v: "petang", l: SHIFT_LABELS_MS.petang },
  { v: "penuh", l: SHIFT_LABELS_MS.penuh },
  { v: "cuti", l: SHIFT_LABELS_MS.cuti }
];

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
  return "RM " + (Math.round(n * 100) / 100).toFixed(2);
}

function setStatus(msg, kind) {
  var el = $("sd-status");
  if (!el) return;
  if (!msg) {
    el.textContent = "";
    el.classList.add("sd-status--hidden");
    el.classList.remove("sd-status--ok", "sd-status--err");
    return;
  }
  el.textContent = msg;
  el.classList.remove("sd-status--hidden", "sd-status--ok", "sd-status--err");
  el.classList.add(kind === "err" ? "sd-status--err" : "sd-status--ok");
}

function ymParts() {
  var v = filterMonthStr || $("sd-filter-month").value;
  var p = String(v || "").split("-");
  var y = parseInt(p[0], 10) || new Date().getFullYear();
  var m = parseInt(p[1], 10) || new Date().getMonth() + 1;
  return { y: y, m0: m - 1 };
}

function filteredStaff() {
  return staffList.filter(function (s) {
    if (filterStatus !== "all" && s.employmentStatus !== filterStatus) return false;
    if (filterShift !== "all") {
      var d = String(s.defaultShift || "");
      if (d !== filterShift) {
        var has = (s.weeklyRoster || []).some(function (r) {
          return r.shift === filterShift;
        });
        if (!has) return false;
      }
    }
    return true;
  });
}

function computeStats() {
  var ym = ymParts();
  var base = filteredStaff();
  var agg = aggregateStaffSales(base, saleDocs, ym.y, ym.m0);
  var rankMap = rankStats(agg);
  agg.forEach(function (row) {
    row.rank = rankMap[row.staffId] || 0;
    row.attendancePct = attendanceRatePct(row, ym.y, ym.m0);
    row.rating = serviceRatingProxy(row.orders, row.lineItems, settings.ratingBase);
    row.tier = performanceTier(row, agg);
  });
  return agg;
}

function renderMetrics(stats) {
  var el = $("sd-metrics");
  if (!el) return;
  var ym = ymParts();
  var active = staffList.filter(function (s) {
    return s.employmentStatus === "active";
  }).length;
  var team = teamRevenue(stats);
  var orders = stats.reduce(function (s, x) {
    return s + (x.orders || 0);
  }, 0);
  var onDuty = staffOnDutyToday(
    staffList.filter(function (s) {
      return s.employmentStatus === "active";
    })
  );
  var best = stats.slice().sort(function (a, b) {
    return (b.revenue || 0) - (a.revenue || 0);
  })[0];
  var pool = bonusPoolEstimate(team, settings.teamMonthlyTargetRm, settings.bonusRateAboveTarget);

  el.innerHTML =
    '<article class="sd-metric"><div class="sd-metric__label">Staf aktif</div><div class="sd-metric__value">' +
    active +
    '</div><div class="sd-metric__hint">Dalam sistem</div></article>' +
    '<article class="sd-metric"><div class="sd-metric__label">Jualan bulan</div><div class="sd-metric__value">' +
    formatRM(team) +
    '</div><div class="sd-metric__hint">' +
    ym.y +
    "-" +
    pad2(ym.m0 + 1) +
    "</div></article>" +
    '<article class="sd-metric"><div class="sd-metric__label">Order direkod</div><div class="sd-metric__value">' +
    orders +
    '</div><div class="sd-metric__hint">POS dengan staf</div></article>' +
    '<article class="sd-metric"><div class="sd-metric__label">Anggaran bonus</div><div class="sd-metric__value">' +
    formatRM(pool) +
    '</div><div class="sd-metric__hint">Jika sasaran dicapai</div></article>' +
    (best && best.orders > 0
      ? '<article class="sd-metric"><div class="sd-metric__label">Terbaik (jualan)</div><div class="sd-metric__value">' +
        escapeHtml(best.name) +
        '</div><div class="sd-metric__hint">' +
        formatRM(best.revenue) +
        "</div></article>"
      : "");
}

function renderDuty() {
  var el = $("sd-duty-today");
  if (!el) return;
  var list = staffOnDutyToday(
    staffList.filter(function (s) {
      return s.employmentStatus === "active";
    })
  );
  if (!list.length) {
    el.innerHTML =
      '<span class="sd-chip sd-chip--muted">Tiada syif dijadual hari ini — kemas kini jadual dalam profil staf.</span>';
    return;
  }
  el.innerHTML = list
    .map(function (s) {
      var dow = new Date().getDay();
      var sh = (s.weeklyRoster || []).find(function (r) {
        return r.day === dow;
      });
      var lab = sh && sh.shift ? SHIFT_LABELS_MS[sh.shift] || sh.shift : SHIFT_LABELS_MS[s.defaultShift] || s.defaultShift;
      return (
        '<span class="sd-chip">' +
        escapeHtml(s.name) +
        " · " +
        escapeHtml(lab) +
        "</span>"
      );
    })
    .join("");
}

function renderChart(stats) {
  var el = $("sd-chart-bars");
  if (!el) return;
  var max = stats.reduce(function (m, x) {
    return Math.max(m, x.revenue || 0);
  }, 0);
  if (max <= 0) max = 1;
  var rows = stats
    .filter(function (x) {
      return x.revenue > 0 || x.orders > 0;
    })
    .sort(function (a, b) {
      return (b.revenue || 0) - (a.revenue || 0);
    });
  if (!rows.length) {
    el.innerHTML = '<p class="sd-footnote" style="margin:0">Tiada jualan dengan staf dipilih untuk bulan ini.</p>';
    return;
  }
  el.innerHTML = rows
    .map(function (r) {
      var pct = Math.round(((r.revenue || 0) / max) * 100);
      return (
        '<div class="sd-bar-row" data-staff-id="' +
        escapeHtml(r.staffId) +
        '">' +
        '<span class="sd-bar-name">' +
        escapeHtml(r.name) +
        '</span><div class="sd-bar-track"><div class="sd-bar-fill" style="width:' +
        pct +
        '%"></div></div><span class="sd-bar-val">' +
        formatRM(r.revenue) +
        "</span></div>"
      );
    })
    .join("");
  el.querySelectorAll(".sd-bar-row").forEach(function (row) {
    row.addEventListener("click", function () {
      openDetailModal(row.getAttribute("data-staff-id"));
    });
  });
}

function tierClass(t) {
  if (t === "cemerlang") return "sd-tier sd-tier--cemerlang";
  if (t === "perlu_baiki") return "sd-tier sd-tier--perlu";
  return "sd-tier sd-tier--baik";
}

function renderTable(stats) {
  var tb = $("sd-table-body");
  if (!tb) return;
  var ym = ymParts();
  tb.innerHTML = stats
    .map(function (r) {
      var tier = TIER_MS[r.tier] || r.tier;
      return (
        "<tr data-staff-id=\"" +
        escapeHtml(r.staffId) +
        "\">" +
        "<td>" +
        escapeHtml(r.name) +
        "</td><td>" +
        escapeHtml(STAFF_ROLES_MS[r.role] || r.role) +
        "</td><td>" +
        escapeHtml(SHIFT_LABELS_MS[r.defaultShift] || r.defaultShift || "—") +
        "</td><td>" +
        (r.attendancePct != null ? r.attendancePct + "%" : "—") +
        "</td><td>" +
        formatRM(r.revenue) +
        "</td><td>" +
        (r.orders || 0) +
        "</td><td>" +
        (r.lineItems || 0) +
        "</td><td>" +
        (r.rating != null ? r.rating.toFixed(1) : "—") +
        '</td><td><span class="' +
        tierClass(r.tier) +
        '">' +
        escapeHtml(tier) +
        "</span></td></tr>"
      );
    })
    .join("");
  tb.querySelectorAll("tr").forEach(function (tr) {
    tr.addEventListener("click", function () {
      openDetailModal(tr.getAttribute("data-staff-id"));
    });
  });
}

function renderKpi(stats) {
  var el = $("sd-kpi-body");
  if (!el) return;
  var team = teamRevenue(stats);
  var pool = bonusPoolEstimate(team, settings.teamMonthlyTargetRm, settings.bonusRateAboveTarget);
  var achievers = stats.filter(function (s) {
    return (s.orders || 0) > 0;
  }).length;
  var share = achievers > 0 && pool > 0 ? pool / achievers : 0;
  el.innerHTML =
    '<div class="sd-kpi-card">Sasaran pasukan<strong>' +
    formatRM(settings.teamMonthlyTargetRm) +
    "</strong></div>" +
    '<div class="sd-kpi-card">Jualan vs sasaran<strong>' +
    (team >= settings.teamMonthlyTargetRm ? "Capai" : "Belum capai") +
    "</strong>" +
    formatRM(team) +
    "</div>" +
    '<div class="sd-kpi-card">Anggaran kolam bonus<strong>' +
    formatRM(pool) +
    '</strong><span class="sd-muted">Anggaran bahagi staf berjualan: ' +
    formatRM(Math.round(share * 100) / 100) +
    "</span></div>";
}

function renderActivity() {
  var tb = $("sd-activity-body");
  if (!tb) return;
  tb.innerHTML = activityDocs
    .map(function (d) {
      var x = d.data();
      var t = x.createdAt && x.createdAt.toDate ? x.createdAt.toDate() : null;
      var ts = t ? t.toLocaleString("ms-MY", { hour12: true }) : "—";
      var kind = String(x.kind || "");
      var kindMs =
        kind === "sale_completed"
          ? "Jualan"
          : kind === "order_edit"
            ? "Ubah order"
            : kind === "refund"
              ? "Refund"
              : kind === "cancel"
                ? "Batal"
                : kind;
      return (
        "<tr><td>" +
        escapeHtml(ts) +
        "</td><td>" +
        escapeHtml(x.staffName || x.staffId || "—") +
        "</td><td>" +
        escapeHtml(kindMs) +
        "</td><td>" +
        escapeHtml(x.detail || "") +
        "</td></tr>"
      );
    })
    .join("");
}

function renderRosterInputs(roster) {
  var wrap = $("sd-form-roster");
  if (!wrap) return;
  var map = {};
  (roster || []).forEach(function (r) {
    map[r.day] = r.shift;
  });
  wrap.innerHTML = DAY_NAMES_MS.map(function (label, day) {
    var cur = map[day] != null && map[day] !== "" ? map[day] : "pagi";
    return (
      '<label class="sd-roster-cell">' +
      label +
      '<select data-roster-day="' +
      day +
      '">' +
      SHIFT_OPTIONS.map(function (o) {
        return (
          '<option value="' +
          o.v +
          '"' +
          (o.v === cur ? " selected" : "") +
          ">" +
          escapeHtml(o.l) +
          "</option>"
        );
      }).join("") +
      "</select></label>"
    );
  }).join("");
}

function readRosterFromForm() {
  var wrap = $("sd-form-roster");
  if (!wrap) return [];
  var out = [];
  wrap.querySelectorAll("select[data-roster-day]").forEach(function (sel) {
    var day = parseInt(sel.getAttribute("data-roster-day"), 10);
    out.push({ day: day, shift: sel.value || "pagi" });
  });
  return out.sort(function (a, b) {
    return a.day - b.day;
  });
}

function openStaffModal(id) {
  var bd = $("sd-modal-staff-backdrop");
  var isEdit = Boolean(id);
  $("sd-modal-staff-title").textContent = isEdit ? "Sunting kakitangan" : "Tambah kakitangan";
  $("sd-form-id").value = id || "";
  $("sd-form-delete").hidden = !isEdit;
  if (!isEdit) {
    $("sd-form-name").value = "";
    $("sd-form-role").value = "cashier";
    $("sd-form-status").value = "active";
    $("sd-form-phone").value = "";
    $("sd-form-started").value = "";
    $("sd-form-paytype").value = "hourly";
    $("sd-form-pay").value = "8";
    $("sd-form-default-shift").value = "pagi";
    renderRosterInputs(
      DAY_NAMES_MS.map(function (_, day) {
        return { day: day, shift: "pagi" };
      })
    );
  } else {
    var s = staffList.find(function (x) {
      return String(x.id) === String(id);
    });
    if (!s) return;
    $("sd-form-name").value = s.name;
    $("sd-form-role").value = s.role || "cashier";
    $("sd-form-status").value = s.employmentStatus || "active";
    $("sd-form-phone").value = s.phone || "";
    if (s.startedAtDate) {
      var d = s.startedAtDate;
      $("sd-form-started").value =
        d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
    } else {
      $("sd-form-started").value = "";
    }
    $("sd-form-paytype").value = s.payType || "hourly";
    $("sd-form-pay").value = String(s.payAmount != null ? s.payAmount : "");
    $("sd-form-default-shift").value = s.defaultShift || "pagi";
    renderRosterInputs(s.weeklyRoster && s.weeklyRoster.length ? s.weeklyRoster : null);
  }
  bd.hidden = false;
  bd.setAttribute("aria-hidden", "false");
}

function closeStaffModal() {
  var bd = $("sd-modal-staff-backdrop");
  if (bd) {
    bd.hidden = true;
    bd.setAttribute("aria-hidden", "true");
  }
}

function startedTimestampFromInput() {
  var v = $("sd-form-started").value;
  if (!v) return null;
  var d = new Date(v + "T12:00:00");
  if (isNaN(d.getTime())) return null;
  return Timestamp.fromDate(d);
}

async function saveStaffForm() {
  var id = $("sd-form-id").value.trim();
  var name = $("sd-form-name").value.trim();
  if (!name) {
    setStatus("Isi nama.", "err");
    return;
  }
  var payload = {
    name: name,
    role: $("sd-form-role").value,
    employmentStatus: $("sd-form-status").value,
    phone: $("sd-form-phone").value.trim(),
    payType: $("sd-form-paytype").value,
    payAmount: parseFloat($("sd-form-pay").value) || 0,
    defaultShift: $("sd-form-default-shift").value,
    weeklyRoster: readRosterFromForm()
  };
  var st = startedTimestampFromInput();
  if (st) payload.startedAt = st;

  try {
    if (id) {
      await persistStaff(id, payload);
      setStatus("Kakitangan dikemas kini.", "ok");
    } else {
      await addStaff(payload);
      setStatus("Kakitangan ditambah.", "ok");
    }
    closeStaffModal();
  } catch (e) {
    console.error(e);
    setStatus(e.message || String(e), "err");
  }
}

async function deleteStaffForm() {
  var id = $("sd-form-id").value.trim();
  if (!id) return;
  if (!confirm("Padam kakitangan ini dari pangkalan data?")) return;
  try {
    await removeStaff(id);
    setStatus("Dipadam.", "ok");
    closeStaffModal();
  } catch (e) {
    console.error(e);
    setStatus(e.message || String(e), "err");
  }
}

async function openDetailModal(staffId) {
  var s = staffList.find(function (x) {
    return String(x.id) === String(staffId);
  });
  var bd = $("sd-modal-detail-backdrop");
  var body = $("sd-modal-detail-body");
  var title = $("sd-modal-detail-title");
  if (!bd || !body || !title) return;
  title.textContent = s ? s.name : "Prestasi";
  body.innerHTML = "<p>Memuatkan…</p>";
  bd.hidden = false;
  bd.setAttribute("aria-hidden", "false");

  var stats = computeStats().find(function (x) {
    return String(x.staffId) === String(staffId);
  });
  var ym = ymParts();
  var rows = [];
  try {
    rows = await fetchSalesForStaff(staffId, 40);
  } catch (e) {
    console.error(e);
  }
  var recent = rows
    .map(function (d) {
      var p = parseSaleDoc(d);
      if (!inMonth(p.createdAt, ym.y, ym.m0)) return null;
      var t = p.createdAt ? p.createdAt.toLocaleString("ms-MY", { hour12: true }) : "—";
      return { t: t, sub: p.subtotal, id: p.id };
    })
    .filter(Boolean);

  var html =
    "<div class=\"sd-detail-grid\">" +
    "<p><strong>Jawatan</strong><br>" +
    escapeHtml(s ? STAFF_ROLES_MS[s.role] || s.role : "—") +
    "</p>" +
    "<p><strong>Status</strong><br>" +
    escapeHtml(s ? STAFF_STATUS_MS[s.employmentStatus] || s.employmentStatus : "—") +
    "</p>" +
    "<p><strong>Jualan (bulan)</strong><br>" +
    formatRM(stats ? stats.revenue : 0) +
    "</p>" +
    "<p><strong>Order</strong><br>" +
    (stats ? stats.orders : 0) +
    "</p>" +
    "<p><strong>Kehadiran anggaran</strong><br>" +
    (stats ? stats.attendancePct + "%" : "—") +
    "</p>" +
    "<p><strong>Rating anggaran</strong><br>" +
    (stats && stats.rating != null ? stats.rating.toFixed(1) : "—") +
    "</p></div>" +
    "<h3 class=\"sd-roster-label\">Jualan terkini (bulan dipilih)</h3>" +
    (recent.length
      ? "<ul class=\"sd-detail-list\">" +
        recent
          .map(function (r) {
            return (
              "<li>" +
              escapeHtml(r.t) +
              " — " +
              formatRM(r.sub) +
              ' <span class="sd-muted">#' +
              escapeHtml(r.id.slice(0, 8)) +
              "…</span></li>"
            );
          })
          .join("") +
        "</ul>"
      : "<p class=\"sd-footnote\">Tiada rekod POS untuk staf ini pada bulan ini.</p>");
  body.innerHTML = html;
}

function closeDetailModal() {
  var bd = $("sd-modal-detail-backdrop");
  if (bd) {
    bd.hidden = true;
    bd.setAttribute("aria-hidden", "true");
  }
}

function refreshAll() {
  var stats = computeStats();
  renderMetrics(stats);
  renderDuty();
  renderChart(stats);
  renderTable(stats);
  renderKpi(stats);
  renderActivity();
}

function initMonthInput() {
  var inp = $("sd-filter-month");
  var n = new Date();
  filterMonthStr = n.getFullYear() + "-" + pad2(n.getMonth() + 1);
  inp.value = filterMonthStr;
}

function wireEvents() {
  $("sd-filter-month").addEventListener("change", function () {
    filterMonthStr = $("sd-filter-month").value;
    refreshAll();
  });
  $("sd-filter-status").addEventListener("change", function () {
    filterStatus = $("sd-filter-status").value;
    refreshAll();
  });
  $("sd-filter-shift").addEventListener("change", function () {
    filterShift = $("sd-filter-shift").value;
    refreshAll();
  });
  $("sd-btn-add-staff").addEventListener("click", function () {
    openStaffModal(null);
  });
  $("sd-modal-staff-close").addEventListener("click", closeStaffModal);
  $("sd-form-cancel").addEventListener("click", closeStaffModal);
  $("sd-form-save").addEventListener("click", function () {
    saveStaffForm();
  });
  $("sd-form-delete").addEventListener("click", function () {
    deleteStaffForm();
  });
  $("sd-modal-staff-backdrop").addEventListener("click", function (e) {
    if (e.target.id === "sd-modal-staff-backdrop") closeStaffModal();
  });
  $("sd-modal-detail-close").addEventListener("click", closeDetailModal);
  $("sd-modal-detail-done").addEventListener("click", closeDetailModal);
  $("sd-modal-detail-backdrop").addEventListener("click", function (e) {
    if (e.target.id === "sd-modal-detail-backdrop") closeDetailModal();
  });
  $("sd-kpi-form").addEventListener("submit", async function (e) {
    e.preventDefault();
    try {
      await saveStaffSettings({
        teamMonthlyTargetRm: parseFloat($("sd-kpi-target").value) || 0,
        bonusRateAboveTarget: parseFloat($("sd-kpi-rate").value) || 0,
        ratingBase: parseFloat($("sd-kpi-rating-base").value) || 3.6
      });
      settings = await getStaffSettings();
      setStatus("Tetapan KPI disimpan.", "ok");
      refreshAll();
    } catch (err) {
      console.error(err);
      setStatus(err.message || String(err), "err");
    }
  });
}

function main() {
  initMonthInput();
  wireEvents();

  subscribeStaff(
    function (snap) {
      staffList = snap.docs.map(docToStaff);
      refreshAll();
    },
    function (err) {
      console.error(err);
      setStatus(err.message || String(err), "err");
    }
  );

  subscribeRecentSales(
    function (snap) {
      saleDocs = snap.docs.slice();
      refreshAll();
    },
    function (err) {
      console.error(err);
    },
    450
  );

  subscribeStaffActivity(
    function (snap) {
      activityDocs = snap.docs.slice();
      renderActivity();
    },
    function (err) {
      console.error(err);
    },
    100
  );

  getStaffSettings()
    .then(function (s) {
      settings = s;
      $("sd-kpi-target").value = String(s.teamMonthlyTargetRm);
      $("sd-kpi-rate").value = String(s.bonusRateAboveTarget);
      $("sd-kpi-rating-base").value = String(s.ratingBase);
      refreshAll();
    })
    .catch(function (e) {
      console.error(e);
    });
}

main();
