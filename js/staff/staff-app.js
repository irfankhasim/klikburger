/**
 * Dashboard Kakitangan — pemantauan kehadiran & drawer tunai (BO).
 */
import { auth, db, collection, query, where, getDocs, onSnapshot, Timestamp } from "../firebase/init.js";
import { isElevatedRole } from "../pos-rbac-session.js";
import { forceStaffClockOut, manageStaffAttendance } from "./totp-callables.js";
import { waitForAuthUser } from "../pos-firebase-auth-bridge.js";
import { COL_POS_RECEIPTS } from "../firebase/collections.js";
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
import { buildStaffPerformancePayload } from "../monthly-reports/staff-performance-calc.js";
import { t as tr, getLocale, onLocaleChange } from "../i18n/locale.js";

var staffList = [];
var activityRows = [];
var posShiftRows = [];
var receiptRows = [];
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

function parseDetailObj(detail) {
  if (!detail) return {};
  try {
    var o = JSON.parse(String(detail));
    return o && typeof o === "object" ? o : {};
  } catch (e) {
    return {};
  }
}

function parseLocalDateTime(s) {
  var t = Date.parse(String(s || "").trim().replace(" ", "T"));
  return isFinite(t) ? t : 0;
}

function isoPromptValue(ms) {
  if (!ms) return "";
  var d = new Date(ms);
  if (isNaN(d.getTime())) return "";
  function p(n) {
    return (n < 10 ? "0" : "") + n;
  }
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Terjemahan dengan pemegang tempat `{nama}`. */
function trFmt(key, vars) {
  return String(tr(key)).replace(/\{(\w+)\}/g, function (whole, name) {
    return vars && vars[name] != null ? String(vars[name]) : whole;
  });
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
    '<article class="sd-metric"><div class="sd-metric__label">' +
    escapeHtml(tr("staff.summary.activeStaff")) +
    '</div><div class="sd-metric__value">' +
    active +
    '</div><div class="sd-metric__hint">' +
    escapeHtml(trFmt("staff.summary.ofRecords", { n: staffList.length })) +
    "</div></article>" +
    '<article class="sd-metric"><div class="sd-metric__label">' +
    escapeHtml(tr("staff.summary.clockRecords")) +
    '</div><div class="sd-metric__value">' +
    clockN +
    '</div><div class="sd-metric__hint">' +
    escapeHtml(tr("staff.summary.clockRecordsHint")) +
    "</div></article>" +
    '<article class="sd-metric"><div class="sd-metric__label">' +
    escapeHtml(tr("staff.summary.shiftsClosed")) +
    '</div><div class="sd-metric__value">' +
    drawerN +
    '</div><div class="sd-metric__hint">' +
    escapeHtml(tr("staff.summary.shiftsClosedHint")) +
    "</div></article>" +
    '<article class="sd-metric"><div class="sd-metric__label">' +
    escapeHtml(tr("staff.summary.month")) +
    '</div><div class="sd-metric__value">' +
    ym.y +
    "-" +
    pad2(ym.m0 + 1) +
    '</div><div class="sd-metric__hint">' +
    escapeHtml(tr("staff.summary.monthHint")) +
    "</div></article>";
}

function activityKindLabel(kind) {
  var k = String(kind || "");
  if (k === "clock_in") return "Clock in";
  if (k === "clock_out") return "Clock out";
  return k || "—";
}

// Kunci nama hari/bulan disenaraikan secara literal (bukan "staff.day." + i) supaya
// scripts/check-i18n-keys.mjs nampak setiap kunci sebagai digunakan.
var DAY_NAME_KEYS = [
  "staff.day.0",
  "staff.day.1",
  "staff.day.2",
  "staff.day.3",
  "staff.day.4",
  "staff.day.5",
  "staff.day.6"
];

var MONTH_NAME_KEYS = [
  "staff.month.0",
  "staff.month.1",
  "staff.month.2",
  "staff.month.3",
  "staff.month.4",
  "staff.month.5",
  "staff.month.6",
  "staff.month.7",
  "staff.month.8",
  "staff.month.9",
  "staff.month.10",
  "staff.month.11"
];

function fmtClockTime(ms) {
  if (!ms) return null;
  var d = new Date(ms);
  var h = d.getHours();
  var m = d.getMinutes();
  var ampm = h >= 12 ? tr("staff.meridiem.pm") : tr("staff.meridiem.am");
  if (h === 0) {
    h = 12;
  } else if (h > 12) {
    h -= 12;
  } else if (h === 12) {
    ampm = tr("staff.meridiem.noon");
  }
  return pad2(h) + ":" + pad2(m) + " " + ampm;
}

function fmtClockDate(ms) {
  if (!ms) return { day: "", date: "" };
  var d = new Date(ms);
  return {
    day: tr(DAY_NAME_KEYS[d.getDay()]),
    date: d.getDate() + " " + tr(MONTH_NAME_KEYS[d.getMonth()]) + " " + d.getFullYear()
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
        text: hours + tr("staff.unit.hourShort") + " " + pad2(mins) + tr("staff.unit.minShort"),
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

    var workRoleRaw = String(ci.workRole || "").trim().toLowerCase();
    var detIn = parseDetailObj(ci.detail);
    var detOut = matchOut ? parseDetailObj(matchOut.detail) : {};
    var workRole =
      workRoleRaw === "kitchen" ? "kitchen" : workRoleRaw === "owner" ? "owner" : "cashier";
    var testingSession = !!(
      ci.testingSession ||
      (matchOut && matchOut.testingSession) ||
      detIn.testingSession ||
      detOut.testingSession
    );

    sessions.push({
      staffId: ci.staffId,
      staffName: staffName,
      isOwner: isOwner,
      workRole: workRole,
      testingSession: testingSession,
      clockInDocId: ci.id || "",
      clockOutDocId: matchOut && matchOut.id ? matchOut.id : "",
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

function ownerEditAttendanceSession(btn) {
  var staffId = btn.getAttribute("data-staff-id") || "";
  var reason = window.prompt(tr("staff.manageReason"), "");
  if (reason == null) return;
  reason = String(reason).trim();
  if (!reason) {
    window.alert(tr("staff.manageFail"));
    return;
  }
  var inMs = parseInt(btn.getAttribute("data-in-ms") || "0", 10) || 0;
  var outMs = parseInt(btn.getAttribute("data-out-ms") || "0", 10) || 0;
  var active = btn.getAttribute("data-active") === "1";
  var inStr = window.prompt(tr("staff.manageInTime"), isoPromptValue(inMs));
  if (inStr == null) return;
  var newIn = parseLocalDateTime(inStr);
  var payload = {
    action: "edit_session",
    staffId: staffId,
    reason: reason,
    clockInDocId: btn.getAttribute("data-in-id") || "",
    clockInAtMs: newIn || inMs
  };
  if (!active) {
    var outStr = window.prompt(tr("staff.manageOutTime"), isoPromptValue(outMs));
    if (outStr == null) return;
    var newOut = parseLocalDateTime(outStr);
    payload.clockOutDocId = btn.getAttribute("data-out-id") || "";
    payload.clockOutAtMs = newOut || outMs;
  }
  btn.disabled = true;
  manageStaffAttendance(payload).then(function (res) {
    btn.disabled = false;
    if (!res || !res.ok) {
      window.alert((res && res.error) || tr("staff.manageFail"));
      return;
    }
    setStatus(tr("staff.manageOk"), "ok");
  });
}

function ownerManualClockIn() {
  var names = (staffList || [])
    .filter(function (s) {
      return !s.isOwner && s.employmentStatus === "active";
    })
    .map(function (s) {
      return s.id + " = " + s.name;
    })
    .join("\n");
  var staffId = window.prompt(tr("staff.manageManualIn") + "\n" + names, "");
  if (staffId == null) return;
  staffId = String(staffId).trim();
  if (!staffId) return;
  var role = window.prompt("Role (cashier / kitchen):", "cashier");
  if (role == null) return;
  var reason = window.prompt(tr("staff.manageReason"), "");
  if (reason == null) return;
  manageStaffAttendance({
    action: "manual_clock_in",
    staffId: staffId,
    workRole: String(role || "cashier").trim(),
    reason: String(reason).trim() || "Owner manual clock in"
  }).then(function (res) {
    if (!res || !res.ok) {
      window.alert((res && res.error) || tr("staff.manageFail"));
      return;
    }
    setStatus(tr("staff.manageOk"), "ok");
  });
}

function runOwnerForceClockOut(staffId, staffName, workRole, btn) {
  var reason = window.prompt(tr("staff.manageReason"), "");
  if (reason == null) return;
  if (btn) btn.disabled = true;
  function go(extra) {
    forceStaffClockOut(
      staffId,
      Object.assign({ reason: String(reason).trim() || "Owner override" }, extra || {})
    ).then(function (result) {
      if (result && result.needsDrawerClose && result.drawer) {
        var d = result.drawer;
        var actualStr = window.prompt(
          tr("clock.roster.drawerLead") +
            "\nOpening: RM " +
            Number(d.openingCash || 0).toFixed(2) +
            "\nExpected: RM " +
            Number(d.expectedCash || 0).toFixed(2) +
            "\nActual (RM):",
          ""
        );
        if (actualStr == null) {
          if (btn) btn.disabled = false;
          return;
        }
        var actual = parseFloat(actualStr);
        if (!isFinite(actual)) {
          window.alert(tr("shift.alert.needActual"));
          if (btn) btn.disabled = false;
          return;
        }
        return go({ closeDrawer: true, actualCash: actual });
      }
      if (!result.ok && !result.verified) {
        window.alert(result.error || tr("staff.activeRosterFail"));
        if (btn) btn.disabled = false;
      }
    });
  }
  go({});
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
      '<tr><td colspan="7" class="sd-empty-cell">' +
      escapeHtml(tr("staff.empty.clock")) +
      "</td></tr>";
    return;
  }

  tb.innerHTML = sessions
    .map(function (s) {
      var ownerBadge = s.isOwner
        ? '<span class="sd-badge sd-badge--owner">' + escapeHtml(tr("staff.badge.owner")) + "</span>"
        : "";
      var staffCell =
        '<div class="sd-staff-cell">' +
        '<span class="sd-staff-cell__name">' +
        escapeHtml(s.staffName.replace(/ \(Owner\)$/, "")) +
        "</span>" +
        ownerBadge +
        "</div>";

      var taskBadge =
        s.workRole === "kitchen"
          ? '<span class="sd-badge sd-badge--kitchen">' + escapeHtml(tr("staff.badge.kitchen")) + "</span>"
          : s.workRole === "owner"
            ? '<span class="sd-badge sd-badge--owner">' + escapeHtml(tr("staff.badge.ownerRole")) + "</span>"
            : '<span class="sd-badge sd-badge--cashier">' + escapeHtml(tr("staff.badge.cashier")) + "</span>";
      if (s.testingSession) {
        taskBadge +=
          ' <span class="sd-badge sd-badge--testing">' + escapeHtml(tr("staff.badge.testing")) + "</span>";
      }

      var clockInCell = '<span class="sd-cell-strong">' + escapeHtml(s.clockInStr) + "</span>";

      var clockOutCell;
      if (s.active) {
        clockOutCell = '<span class="sd-cell-muted">—</span>';
      } else {
        clockOutCell = '<span class="sd-cell-strong">' + escapeHtml(s.clockOutStr) + "</span>";
      }

      var durCell;
      if (s.active) {
        durCell =
          '<span class="sd-badge sd-badge--active">' + escapeHtml(tr("staff.badge.onDuty")) + "</span>";
      } else if (s.duration) {
        durCell = '<span class="sd-cell-strong">' + escapeHtml(s.duration.text) + "</span>";
      } else {
        durCell = '<span class="sd-cell-muted">—</span>';
      }

      var dateCell =
        '<div class="sd-cell-strong">' +
        escapeHtml(s.dayName) +
        '</div><div class="sd-cell-muted sd-cell-muted--sm">' +
        escapeHtml(s.date) +
        "</div>";

      var manageCell = isElevatedRole()
        ? '<button type="button" class="btn btn--ghost btn--sm js-sd-manage-session" data-staff-id="' +
          escapeHtml(s.staffId || "") +
          '" data-in-id="' +
          escapeHtml(s.clockInDocId || "") +
          '" data-out-id="' +
          escapeHtml(s.clockOutDocId || "") +
          '" data-in-ms="' +
          escapeHtml(String(s.clockInMs || "")) +
          '" data-out-ms="' +
          escapeHtml(String(s.clockOutMs || "")) +
          '" data-active="' +
          (s.active ? "1" : "0") +
          '" data-role="' +
          escapeHtml(s.workRole || "") +
          '">' +
          escapeHtml(tr("staff.manage")) +
          "</button>"
        : "";

      return (
        "<tr>" +
        "<td>" +
        dateCell +
        "</td>" +
        "<td>" +
        staffCell +
        "</td>" +
        "<td>" +
        taskBadge +
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
        "<td>" +
        manageCell +
        "</td>" +
        "</tr>"
      );
    })
    .join("");

  tb.querySelectorAll(".js-sd-manage-session").forEach(function (btn) {
    btn.onclick = function () {
      ownerEditAttendanceSession(btn);
    };
  });
}

function formatMsDateTime(ms) {
  if (!ms) return "—";
  try {
    return new Date(ms).toLocaleString(getLocale() === "en" ? "en-MY" : "ms-MY", {
      dateStyle: "short",
      timeStyle: "short",
      hour12: true
    });
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
      '<tr><td colspan="5" class="sd-empty-cell">' + tr("staff.empty.drawer") + "</td></tr>";
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

function renderPerformanceTables() {
  var salesBody = $("sd-perf-sales-body");
  if (!salesBody) return;

  var staffLines = staffList.filter(function (s) {
    return s.employmentStatus === "active";
  });
  var payload = buildStaffPerformancePayload(activityRows, receiptRows, staffLines);
  var salesLines = payload.salesPerformance.lines;

  if (!salesLines.length) {
    salesBody.innerHTML =
      '<tr><td colspan="5" class="sd-empty-cell">' +
      escapeHtml(tr("staff.empty.sales")) +
      "</td></tr>";
  } else {
    salesBody.innerHTML = salesLines
      .slice()
      .sort(function (a, b) {
        return b.totalSalesRm - a.totalSalesRm;
      })
      .map(function (l) {
        var ownerBadge = l.isOwner
          ? '<span class="sd-badge sd-badge--owner">' + escapeHtml(tr("staff.badge.owner")) + "</span>"
          : "";
        var hourUnit = escapeHtml(tr("staff.unit.hourShort"));
        return (
          "<tr><td><div class=\"sd-staff-cell\"><span class=\"sd-staff-cell__name\">" +
          escapeHtml(l.staffName.replace(/ \(Owner\)$/, "")) +
          "</span>" +
          ownerBadge +
          "</div></td><td class=\"sd-cell-strong\">" +
          escapeHtml(l.cashierHoursWorked.toFixed(1)) +
          " " +
          hourUnit +
          "</td><td class=\"sd-cell-strong\">" +
          l.totalOrders +
          "</td><td class=\"sd-cell-strong\">RM " +
          escapeHtml(l.totalSalesRm.toFixed(2)) +
          "</td><td class=\"sd-cell-strong\">RM " +
          escapeHtml(l.salesPerHourRm.toFixed(2)) +
          "/" +
          hourUnit +
          "</td></tr>"
        );
      })
      .join("");
  }
}

var activeRosterRows = [];
var activeRosterUnsub = null;

function renderActiveRoster() {
  var panel = $("sd-active-roster-panel");
  var el = $("sd-active-roster");
  if (!el) return;
  if (panel) panel.hidden = !isElevatedRole();
  var manBtn = $("sd-manual-clock-in");
  if (manBtn) {
    manBtn.hidden = !isElevatedRole();
    manBtn.onclick = ownerManualClockIn;
  }
  if (!isElevatedRole()) {
    el.innerHTML = "";
    return;
  }
  if (!activeRosterRows.length) {
    el.innerHTML = '<p class="sd-empty">' + escapeHtml(tr("staff.activeRosterEmpty")) + "</p>";
    return;
  }
  el.innerHTML =
    '<div class="sd-table-wrap"><table class="sd-table"><thead><tr>' +
    "<th>" +
    escapeHtml(tr("staff.th.staff")) +
    "</th><th>" +
    escapeHtml(tr("staff.th.task")) +
    "</th><th></th></tr></thead><tbody>" +
    activeRosterRows
      .map(function (x) {
        return (
          "<tr><td>" +
          escapeHtml(x.staffName || x.staffId || "") +
          '</td><td><span class="ops-role ops-role--' +
          (String(x.workRole || "").toLowerCase() === "kitchen"
            ? "kitchen"
            : String(x.workRole || "").toLowerCase() === "owner"
              ? "owner"
              : "cashier") +
          '">' +
          escapeHtml(x.workRole || "") +
          '</span></td><td><button type="button" class="btn btn--ghost btn--sm js-sd-force-out" data-staff-id="' +
          escapeHtml(x.staffId || x.id || "") +
          '" data-staff-name="' +
          escapeHtml(x.staffName || "") +
          '" data-work-role="' +
          escapeHtml(x.workRole || "") +
          '">' +
          escapeHtml(tr("staff.activeRosterForceOut")) +
          "</button></td></tr>"
        );
      })
      .join("") +
    "</tbody></table></div>";
  el.querySelectorAll(".js-sd-force-out").forEach(function (btn) {
    btn.onclick = function () {
      var sid = btn.getAttribute("data-staff-id");
      var name = btn.getAttribute("data-staff-name") || sid;
      var role = btn.getAttribute("data-work-role") || "";
      if (!window.confirm(trFmt("staff.activeRosterForceConfirm", { name: name, role: role }))) {
        return;
      }
      runOwnerForceClockOut(sid, name, role, btn);
    };
  });
}

function subscribeActiveRoster() {
  if (activeRosterUnsub) return;
  activeRosterUnsub = onSnapshot(
    collection(db, "pos_active_shift"),
    function (snap) {
      activeRosterRows = snap.docs.map(function (d) {
        return Object.assign({ id: d.id }, d.data());
      });
      renderActiveRoster();
    },
    function (err) {
      console.warn("[staff-dashboard] active roster", err);
    }
  );
  staffFirestoreUnsubs.push(activeRosterUnsub);
}

function refreshAll() {
  try {
    renderActiveRoster();
  } catch (e0) {
    console.error(e0);
  }
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
  try {
    renderPerformanceTables();
  } catch (e) {
    console.error(e);
  }
}

// Jadual & kad ringkasan dibina oleh JS, jadi ia perlu dibina semula bila bahasa bertukar.
onLocaleChange(function () {
  refreshAll();
});

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

/** Ambil sekali (bukan realtime) resit dalam bulan filter — cukup untuk jadual prestasi. */
async function fetchReceiptsForFilterMonth() {
  var ym = ymParts();
  var start = Timestamp.fromDate(new Date(ym.y, ym.m0, 1));
  var end = Timestamp.fromDate(new Date(ym.y, ym.m0 + 1, 1));
  try {
    var snap = await getDocs(
      query(collection(db, COL_POS_RECEIPTS), where("createdAt", ">=", start), where("createdAt", "<", end))
    );
    receiptRows = snap.docs;
  } catch (e) {
    console.error("[staff-dashboard] fetch receipts", e);
    receiptRows = [];
  }
  refreshAll();
}

function wireEvents() {
  $("sd-filter-month").addEventListener("change", function () {
    filterMonthStr = $("sd-filter-month").value;
    subscribeStaffActivityForFilterMonth();
    subscribeClosedPosShiftsForFilterMonth();
    fetchReceiptsForFilterMonth();
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

  subscribeActiveRoster();
  subscribeStaffActivityForFilterMonth();
  subscribeClosedPosShiftsForFilterMonth();
  fetchReceiptsForFilterMonth();

  refreshAll();
}

main().catch(function (e) {
  console.error(e);
  try {
    setStatus(e.message || String(e), "err");
  } catch (e2) {}
  refreshAll();
});
