/**
 * Dashboard Kakitangan — pemantauan kehadiran & drawer tunai (BO).
 */
import { auth } from "../firebase/init.js";
import { waitForAuthUser } from "../pos-firebase-auth-bridge.js";
import {
  docToStaff,
  docToStaffActivity,
  docToPosShift,
  dedupeStaffByNameKey,
  staffDisplayNameWithOwnerSuffix
} from "./staff-mappers.js";
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
    " rekod</div></article>" +
    '<article class="sd-metric"><div class="sd-metric__label">Rekod clock (bulan)</div><div class="sd-metric__value">' +
    clockN +
    '</div><div class="sd-metric__hint">Clock in / clock out</div></article>' +
    '<article class="sd-metric"><div class="sd-metric__label">Tutup shift (bulan)</div><div class="sd-metric__value">' +
    drawerN +
    '</div><div class="sd-metric__hint">Penutupan drawer</div></article>' +
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

function fmtClockTime(ms) {
  if (!ms) return null;
  var d = new Date(ms);
  var h = d.getHours();
  var m = d.getMinutes();
  var ampm = h >= 12 ? "PTG" : "PG";
  if (h === 0) {
    h = 12;
  } else if (h > 12) {
    h -= 12;
  } else if (h === 12) {
    ampm = "TGH";
  }
  return pad2(h) + ":" + pad2(m) + " " + ampm;
}

function fmtClockDate(ms) {
  if (!ms) return { day: "", date: "" };
  var d = new Date(ms);
  var days = ["Ahad", "Isnin", "Selasa", "Rabu", "Khamis", "Jumaat", "Sabtu"];
  var months = ["Jan", "Feb", "Mac", "Apr", "Mei", "Jun", "Jul", "Ogs", "Sep", "Okt", "Nov", "Dis"];
  return {
    day: days[d.getDay()],
    date: d.getDate() + " " + months[d.getMonth()] + " " + d.getFullYear()
  };
}

function pairClockSessions(activityRows) {
  var sorted = activityRows.slice().sort(function (a, b) {
    return tsToMillis(a.createdAt) - tsToMillis(b.createdAt);
  });

  var sessions = [];
  var usedOut = Object.create(null);
  var usedIn = Object.create(null);

  var ins = sorted.filter(function (r) {
    return r.kind === "clock_in";
  });

  var outs = sorted.filter(function (r) {
    return r.kind === "clock_out";
  });

  ins.forEach(function (ci) {
    var ciMs = tsToMillis(ci.createdAt);
    var ciKey = ci.id != null ? String(ci.id) : String(ciMs);

    if (usedIn[ciKey]) return;
    usedIn[ciKey] = true;

    var matchOut = null;
    for (var i = 0; i < outs.length; i++) {
      var co = outs[i];
      var coKey = co.id != null ? String(co.id) : String(i);
      if (usedOut[coKey]) continue;
      if (String(co.staffId) !== String(ci.staffId)) continue;
      if (tsToMillis(co.createdAt) <= ciMs) continue;
      matchOut = co;
      usedOut[coKey] = true;
      break;
    }

    var outMs = matchOut ? tsToMillis(matchOut.createdAt) : null;

    var duration = null;
    if (outMs && ciMs) {
      var diffMs = outMs - ciMs;
      var totalMin = Math.floor(diffMs / 60000);
      var hours = Math.floor(totalMin / 60);
      var mins = totalMin % 60;
      duration = {
        text: hours + "j " + pad2(mins) + "m",
        short: hours < 4
      };
    }

    var staffMatch = staffList.find(function (s) {
      return String(s.id) === String(ci.staffId) || String(s.staffId) === String(ci.staffId);
    });
    var staffName = staffMatch
      ? staffDisplayNameWithOwnerSuffix(staffMatch)
      : ci.staffName || ci.staffId || "—";
    var isOwner = staffMatch ? staffMatch.isOwner : ci.staffId === "owner_01";
    var initials = staffName
      .split(" ")
      .map(function (w) {
        return w[0] || "";
      })
      .join("")
      .slice(0, 2)
      .toUpperCase();

    var dateInfo = fmtClockDate(ciMs);

    sessions.push({
      staffId: ci.staffId,
      staffName: staffName,
      isOwner: isOwner,
      initials: initials,
      date: dateInfo.date,
      dayName: dateInfo.day,
      clockInMs: ciMs,
      clockOutMs: outMs,
      clockInStr: fmtClockTime(ciMs),
      clockOutStr: outMs ? fmtClockTime(outMs) : null,
      duration: duration,
      active: !matchOut,
      source: "POS Terminal"
    });
  });

  sessions.sort(function (a, b) {
    return b.clockInMs - a.clockInMs;
  });

  return sessions;
}

function renderClockTable() {
  var tb = $("sd-clock-body");
  if (!tb) return;
  var ym = ymParts();

  var allClockRows = (activityRows || []).filter(function (r) {
    return isClockActivityKind(r.kind);
  });

  // Ambil clock_in dalam bulan ini sahaja.
  var clockInsThisMonth = allClockRows.filter(function (r) {
    return (
      r.kind === "clock_in" &&
      inCalendarMonth(tsToMillis(r.createdAt), ym.y, ym.m0)
    );
  });

  // Ambil SEMUA clock_out (termasuk bulan lain) supaya clock_in di hujung
  // bulan boleh dipadan dengan clock_out di awal bulan berikutnya.
  var allClockOuts = allClockRows.filter(function (r) {
    return r.kind === "clock_out";
  });

  var rowsForPairing = clockInsThisMonth.concat(allClockOuts);
  var sessions = pairClockSessions(rowsForPairing);

  if (!sessions.length) {
    tb.innerHTML =
      '<tr><td colspan="5" class="sd-footnote" style="text-align:center;padding:20px">Tiada rekod kehadiran pada bulan ini.</td></tr>';
    return;
  }

  tb.innerHTML = sessions
    .map(function (s) {
      var rbBg = s.isOwner ? "#E6F1FB" : "#EAF3DE";
      var rbColor = s.isOwner ? "#185FA5" : "#3B6D11";
      var roleLabel = s.isOwner ? "Owner" : "Staff";
      var roleBadge =
        '<span style="font-size:10px;font-weight:500;padding:2px 6px;border-radius:999px;background:' +
        rbBg +
        ";color:" +
        rbColor +
        ';margin-left:6px">' +
        roleLabel +
        "</span>";

      var staffCell =
        '<div style="display:flex;align-items:center">' +
        '<span style="font-weight:500;font-size:13px">' +
        escapeHtml(s.staffName.replace(/ \(Owner\)$/, "")) +
        roleBadge +
        "</span></div>";

      var clockInCell = '<span style="font-weight:500;font-size:13px">' + escapeHtml(s.clockInStr) + "</span>";

      var clockOutCell;
      if (s.active) {
        clockOutCell = '<span style="font-size:13px;color:var(--color-text-secondary)">—</span>';
      } else {
        clockOutCell = '<span style="font-weight:500;font-size:13px">' + escapeHtml(s.clockOutStr) + "</span>";
      }

      var durCell;
      if (s.active) {
        durCell =
          '<span style="font-size:13px;color:var(--color-text-primary)">Sedang bertugas</span>';
      } else if (s.duration) {
        durCell =
          '<span style="font-size:13px;color:var(--color-text-primary)">' +
          escapeHtml(s.duration.text) +
          "</span>";
      } else {
        durCell =
          '<span style="font-size:13px;color:var(--color-text-secondary)">—</span>';
      }

      var dateCell =
        '<div style="font-weight:500;font-size:13px">' +
        escapeHtml(s.dayName) +
        '</div><div style="font-size:11px;color:var(--color-text-secondary)">' +
        escapeHtml(s.date) +
        "</div>";

      return (
        "<tr>" +
        "<td>" +
        dateCell +
        "</td>" +
        "<td>" +
        staffCell +
        "</td>" +
        "<td>" +
        clockInCell +
        "</td>" +
        "<td>" +
        clockOutCell +
        "</td>" +
        "<td>" +
        durCell +
        "</td>" +
        "</tr>"
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
