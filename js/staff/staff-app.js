/**
 * Dashboard Kakitangan — pemantauan kehadiran & drawer tunai (BO).
 */
import { auth } from "../firebase/init.js";
import { waitForAuthUser } from "../pos-firebase-auth-bridge.js";
import { docToStaff, docToStaffActivity, docToPosShift, dedupeStaffByNameKey } from "./staff-mappers.js";
import { isClockActivityKind } from "./staff-analytics.js";
import { subscribeStaff, subscribeStaffActivity, subscribeClosedPosShifts } from "./staff-repository.js";
import { roundMoney, varianceCategoryFromVariance, varianceLabelMs } from "../drawer-variance.js";

var staffList = [];
var activityRows = [];
var posShiftRows = [];
var filterMonthStr = "";

var staffFirestoreUnsubs = [];
var staffActivityUnsub = null;
var staffShiftsUnsub = null;
var staffPagehideBound = false;

function teardownStaffFirestoreListeners() {
  staffFirestoreUnsubs.forEach(function (u) {
    try {
      if (typeof u === "function") u();
    } catch (e) {}
  });
  staffFirestoreUnsubs = [];
}

function bindStaffPagehideOnce() {
  if (staffPagehideBound) return;
  staffPagehideBound = true;
  window.addEventListener("pagehide", teardownStaffFirestoreListeners);
}

function pad2(n) {
  return (n < 10 ? "0" : "") + n;
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
  var v = filterMonthStr || ($("sd-filter-month") && $("sd-filter-month").value);
  var p = String(v || "").split("-");
  var y = parseInt(p[0], 10) || new Date().getFullYear();
  var m = parseInt(p[1], 10) || new Date().getMonth() + 1;
  return { y: y, m0: m - 1 };
}

function tsToMillis(ts) {
  if (!ts) return 0;
  if (typeof ts.toMillis === "function") return ts.toMillis();
  if (typeof ts.toDate === "function") {
    var d = ts.toDate();
    return d && !isNaN(d.getTime()) ? d.getTime() : 0;
  }
  return 0;
}

function inCalendarMonth(ms, y, m0) {
  if (!ms) return false;
  var d = new Date(ms);
  return d.getFullYear() === y && d.getMonth() === m0;
}

function renderSummary() {
  var el = $("sd-summary");
  if (!el) return;
  var ym = ymParts();
  var active = staffList.filter(function (s) {
    return s.employmentStatus === "active";
  }).length;
  var clockN = 0;
  (activityRows || []).forEach(function (r) {
    if (!isClockActivityKind(r.kind)) return;
    if (!inCalendarMonth(tsToMillis(r.createdAt), ym.y, ym.m0)) return;
    clockN++;
  });
  var drawerN = (posShiftRows || []).length;
  el.innerHTML =
    '<article class="sd-metric"><div class="sd-metric__label">Staf aktif</div><div class="sd-metric__value">' +
    active +
    '</div><div class="sd-metric__hint">Daripada ' +
    staffList.length +
    " rekod (nama unik)</div></article>" +
    '<article class="sd-metric"><div class="sd-metric__label">Rekod clock (bulan)</div><div class="sd-metric__value">' +
    clockN +
    '</div><div class="sd-metric__hint">Clock in / clock out</div></article>' +
    '<article class="sd-metric"><div class="sd-metric__label">Tutup shift (bulan)</div><div class="sd-metric__value">' +
    drawerN +
    '</div><div class="sd-metric__hint">Penutupan drawer (<code>pos_shifts</code>)</div></article>' +
    '<article class="sd-metric"><div class="sd-metric__label">Bulan paparan</div><div class="sd-metric__value">' +
    ym.y +
    "-" +
    pad2(ym.m0 + 1) +
    '</div><div class="sd-metric__hint">Tukar penapis di atas</div></article>';
}

function activityKindLabel(kind) {
  var k = String(kind || "");
  if (k === "clock_in") return "Clock in";
  if (k === "clock_out") return "Clock out";
  return k || "—";
}

function renderClockTable() {
  var tb = $("sd-clock-body");
  if (!tb) return;
  var ym = ymParts();
  var rows = (activityRows || [])
    .filter(function (r) {
      if (!isClockActivityKind(r.kind)) return false;
      return inCalendarMonth(tsToMillis(r.createdAt), ym.y, ym.m0);
    })
    .sort(function (a, b) {
      return tsToMillis(b.createdAt) - tsToMillis(a.createdAt);
    });
  if (!rows.length) {
    tb.innerHTML =
      '<tr><td colspan="4" class="sd-footnote">Tiada clock in/out pada bulan ini dalam <code>staff_activity</code>.</td></tr>';
    return;
  }
  tb.innerHTML = rows
    .map(function (r) {
      var ts = r.createdAt;
      var t =
        ts && typeof ts.toDate === "function"
          ? ts.toDate().toLocaleString("ms-MY", { hour12: true })
          : "—";
      return (
        "<tr><td>" +
        escapeHtml(t) +
        "</td><td>" +
        escapeHtml(r.staffName || "") +
        "</td><td>" +
        escapeHtml(activityKindLabel(r.kind)) +
        "</td><td>" +
        escapeHtml(String(r.detail || "").slice(0, 140)) +
        "</td></tr>"
      );
    })
    .join("");
}

function formatMsDateTime(ms) {
  if (!ms) return "—";
  try {
    return new Date(ms).toLocaleString("ms-MY", { dateStyle: "short", timeStyle: "short", hour12: true });
  } catch (e) {
    return "—";
  }
}

function varianceCellHtmlFromShift(s) {
  var v = typeof s.variance === "number" ? s.variance : null;
  if ((v == null || isNaN(v)) && s.actualDrawer != null && s.expectedDrawer != null) {
    v = roundMoney(s.actualDrawer - s.expectedDrawer);
  }
  var cat = s.varianceCategory || varianceCategoryFromVariance(v);
  var label = varianceLabelMs(cat);
  var rmPart = "";
  if (v != null && !isNaN(v) && cat !== "unknown") {
    rmPart = " (" + (v >= 0 ? "+" : "−") + "RM " + Math.abs(roundMoney(v)).toFixed(2) + ")";
  }
  var cls = "sd-variance sd-variance--" + (cat || "unknown");
  return '<span class="' + escapeHtml(cls) + '">' + escapeHtml(label + rmPart) + "</span>";
}

function renderDrawerTable() {
  var tb = $("sd-drawer-body");
  if (!tb) return;
  var rows = (posShiftRows || []).slice().sort(function (a, b) {
    return tsToMillis(b.openedAt) - tsToMillis(a.openedAt);
  });
  if (!rows.length) {
    tb.innerHTML =
      '<tr><td colspan="5" class="sd-footnote">Tiada shift ditutup pada bulan ini dalam <code>pos_shifts</code>. Varians dikira automatik semasa tutup shift di POS.</td></tr>';
    return;
  }
  tb.innerHTML = rows
    .map(function (s) {
      var when = formatMsDateTime(tsToMillis(s.openedAt));
      var openingStr = "RM " + roundMoney(s.openingCash).toFixed(2);
      var actualStr =
        s.actualDrawer != null && !isNaN(s.actualDrawer) ? "RM " + roundMoney(s.actualDrawer).toFixed(2) : "—";
      var noteParts = [String(s.openedByDisplayName || "—")];
      if (s.note) noteParts.push(String(s.note));
      var note = noteParts.join(" · ");
      var varHtml = varianceCellHtmlFromShift(s);
      return (
        "<tr><td>" +
        escapeHtml(when) +
        "</td><td>" +
        escapeHtml(openingStr) +
        "</td><td>" +
        escapeHtml(actualStr) +
        "</td><td>" +
        varHtml +
        "</td><td>" +
        escapeHtml(note) +
        "</td></tr>"
      );
    })
    .join("");
}

function refreshAll() {
  try {
    renderSummary();
  } catch (e) {
    console.error(e);
  }
  try {
    renderClockTable();
  } catch (e) {
    console.error(e);
  }
  try {
    renderDrawerTable();
  } catch (e) {
    console.error(e);
  }
}

function initMonthInput() {
  var inp = $("sd-filter-month");
  var n = new Date();
  filterMonthStr = n.getFullYear() + "-" + pad2(n.getMonth() + 1);
  if (inp) inp.value = filterMonthStr;
}

function subscribeStaffActivityForFilterMonth() {
  if (staffActivityUnsub) {
    try {
      staffActivityUnsub();
    } catch (e) {}
    var idx = staffFirestoreUnsubs.indexOf(staffActivityUnsub);
    if (idx >= 0) staffFirestoreUnsubs.splice(idx, 1);
    staffActivityUnsub = null;
  }
  var ym = ymParts();
  staffActivityUnsub = subscribeStaffActivity(
    function (snap) {
      activityRows = snap.docs.map(docToStaffActivity);
      refreshAll();
    },
    function (err) {
      console.error(err);
      activityRows = [];
      setStatus(err.message || String(err), "err");
      refreshAll();
    },
    { maxRows: 500, year: ym.y, m0: ym.m0 }
  );
  staffFirestoreUnsubs.push(staffActivityUnsub);
}

function subscribeClosedPosShiftsForFilterMonth() {
  if (staffShiftsUnsub) {
    try {
      staffShiftsUnsub();
    } catch (e) {}
    var idx = staffFirestoreUnsubs.indexOf(staffShiftsUnsub);
    if (idx >= 0) staffFirestoreUnsubs.splice(idx, 1);
    staffShiftsUnsub = null;
  }
  var ym = ymParts();
  staffShiftsUnsub = subscribeClosedPosShifts(
    function (snap) {
      try {
        posShiftRows = snap.docs.map(docToPosShift);
      } catch (e) {
        console.error(e);
        posShiftRows = [];
      }
      refreshAll();
    },
    function (err) {
      console.error(err);
      posShiftRows = [];
      setStatus(err.message || String(err), "err");
      refreshAll();
    },
    { maxRows: 500, year: ym.y, m0: ym.m0 }
  );
  staffFirestoreUnsubs.push(staffShiftsUnsub);
}

function wireEvents() {
  $("sd-filter-month").addEventListener("change", function () {
    filterMonthStr = $("sd-filter-month").value;
    subscribeStaffActivityForFilterMonth();
    subscribeClosedPosShiftsForFilterMonth();
    refreshAll();
  });
}

async function main() {
  initMonthInput();
  wireEvents();
  bindStaffPagehideOnce();

  try {
    await waitForAuthUser();
    if (auth.currentUser) {
      await auth.currentUser.getIdToken(false);
    }
  } catch (e) {
    console.warn("[staff-dashboard] auth", e);
  }

  staffFirestoreUnsubs.push(
    subscribeStaff(
      function (snap) {
        try {
          staffList = dedupeStaffByNameKey(
            snap.docs.map(function (d) {
              return docToStaff(d);
            })
          );
        } catch (e) {
          console.error(e);
          staffList = [];
        }
        refreshAll();
      },
      function (err) {
        console.error(err);
        staffList = [];
        setStatus(err.message || String(err), "err");
        refreshAll();
      }
    )
  );

  subscribeStaffActivityForFilterMonth();
  subscribeClosedPosShiftsForFilterMonth();

  refreshAll();
}

main().catch(function (e) {
  console.error(e);
  try {
    setStatus(e.message || String(e), "err");
  } catch (e2) {}
  refreshAll();
});
