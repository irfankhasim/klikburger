/**
 * Dashboard Kakitangan — pemantauan kehadiran & drawer tunai (BO).
 */
import { auth } from "../firebase/init.js";
import { waitForAuthUser } from "../pos-firebase-auth-bridge.js";
import { docToStaff, dedupeStaffByNameKey } from "./staff-mappers.js";
import { subscribeStaff, subscribeStaffActivity, subscribeClosedPosShifts } from "./staff-repository.js";
import { roundMoney, varianceCategoryFromVariance, varianceLabelMs } from "../drawer-variance.js";

var staffList = [];
var activityRows = [];
var posShiftRows = [];
var filterMonthStr = "";

var staffFirestoreUnsubs = [];
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

function shiftClosedMillis(shiftData) {
  if (!shiftData || typeof shiftData !== "object") return 0;
  var m = tsToMillis(shiftData.closedAt);
  if (m) return m;
  var c = shiftData.closing && shiftData.closing.closedAt;
  if (!c) return 0;
  if (typeof c === "string") {
    var d = new Date(c);
    return isNaN(d.getTime()) ? 0 : d.getTime();
  }
  return tsToMillis(c);
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
    var k = String(r.kind || "");
    if (k !== "clock_in" && k !== "clock_out") return;
    if (!inCalendarMonth(tsToMillis(r.createdAt), ym.y, ym.m0)) return;
    clockN++;
  });
  var drawerN = 0;
  (posShiftRows || []).forEach(function (r) {
    if (!inCalendarMonth(shiftClosedMillis(r.raw), ym.y, ym.m0)) return;
    drawerN++;
  });
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
      var k = String(r.kind || "");
      if (k !== "clock_in" && k !== "clock_out") return false;
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

function buildNoteFromClosing(closing) {
  if (!closing || typeof closing !== "object") return "";
  var parts = [];
  if (closing.refundNotes) parts.push(String(closing.refundNotes).trim());
  if (closing.notes && String(closing.notes).trim() && String(closing.notes) !== String(closing.refundNotes || "")) {
    parts.push(String(closing.notes).trim());
  }
  if (closing.source === "MCP_AGENT") parts.push("Tutupan MCP");
  return parts.join(" · ").slice(0, 220);
}

function varianceCellHtml(closing) {
  if (!closing || typeof closing !== "object") closing = {};
  var expected = typeof closing.expectedDrawer === "number" ? closing.expectedDrawer : parseFloat(closing.expectedDrawer);
  var actual = typeof closing.actualDrawer === "number" ? closing.actualDrawer : parseFloat(closing.actualDrawer);
  if ((actual == null || isNaN(actual)) && closing.closingCash != null) {
    actual = parseFloat(closing.closingCash);
  }
  var v = typeof closing.variance === "number" ? closing.variance : null;
  if ((v == null || isNaN(v)) && !isNaN(expected) && !isNaN(actual)) {
    v = roundMoney(actual - expected);
  }
  var cat = closing.varianceCategory || varianceCategoryFromVariance(v);
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
  var ym = ymParts();
  var rows = (posShiftRows || [])
    .filter(function (r) {
      return inCalendarMonth(shiftClosedMillis(r.raw), ym.y, ym.m0);
    })
    .sort(function (a, b) {
      return shiftClosedMillis(b.raw) - shiftClosedMillis(a.raw);
    });
  if (!rows.length) {
    tb.innerHTML =
      '<tr><td colspan="5" class="sd-footnote">Tiada shift ditutup pada bulan ini dalam <code>pos_shifts</code>. Varians dikira automatik semasa tutup shift di POS.</td></tr>';
    return;
  }
  tb.innerHTML = rows
    .map(function (r) {
      var raw = r.raw;
      var clos = raw.closing && typeof raw.closing === "object" ? raw.closing : {};
      var ms = shiftClosedMillis(raw);
      var when = formatMsDateTime(ms);
      var opening = typeof raw.openingCash === "number" ? raw.openingCash : parseFloat(raw.openingCash) || 0;
      var openingStr = "RM " + roundMoney(opening).toFixed(2);
      var actualN = typeof clos.actualDrawer === "number" ? clos.actualDrawer : parseFloat(clos.actualDrawer);
      if ((actualN == null || isNaN(actualN)) && clos.closingCash != null) {
        actualN = parseFloat(clos.closingCash);
      }
      var actualStr = actualN != null && !isNaN(actualN) ? "RM " + roundMoney(actualN).toFixed(2) : "—";
      var note = buildNoteFromClosing(clos);
      var varHtml = varianceCellHtml(clos);
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

function wireEvents() {
  $("sd-filter-month").addEventListener("change", function () {
    filterMonthStr = $("sd-filter-month").value;
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

  staffFirestoreUnsubs.push(
    subscribeStaffActivity(
      function (snap) {
        activityRows = snap.docs.map(function (d) {
          var x = d.data();
          return {
            id: d.id,
            staffId: x.staffId,
            staffName: x.staffName,
            kind: x.kind,
            detail: x.detail,
            createdAt: x.createdAt
          };
        });
        refreshAll();
      },
      function (err) {
        console.error(err);
        setStatus(err.message || String(err), "err");
      },
      220
    )
  );

  staffFirestoreUnsubs.push(
    subscribeClosedPosShifts(
      function (snap) {
        try {
          posShiftRows = snap.docs.map(function (d) {
            return { id: d.id, raw: d.data() };
          });
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
      220
    )
  );

  refreshAll();
}

main().catch(function (e) {
  console.error(e);
  try {
    setStatus(e.message || String(e), "err");
  } catch (e2) {}
  refreshAll();
});
