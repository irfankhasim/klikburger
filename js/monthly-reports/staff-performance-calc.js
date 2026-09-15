/**
 * Pengiraan prestasi kakitangan — dikongsi client + Admin SDK.
 *
 * Bahagian A (salesPerformance) — jualan & produktiviti, kira jam **Cashier sahaja**.
 * Bahagian B (attendance) — kehadiran & gaji, semua tugas (Cashier + Kitchen).
 * `workRole` diambil dari setiap rekod `clock_in` dalam staff_activity; jika tiada,
 * anggap "cashier" (rekod lama sebelum ciri tugas-per-sesi wujud).
 *
 * @param {Array<{ data?: function }>} activityDocs
 * @param {Array<{ data?: function }>} receiptDocs
 * @param {Array<object>} staffLines
 */
export function buildStaffPerformancePayload(activityDocs, receiptDocs, staffLines) {
  function readData(d) {
    return d && typeof d.data === "function" ? d.data() : d || {};
  }
  function str(v) {
    return String(v != null ? v : "").trim();
  }
  function num(v) {
    return typeof v === "number" ? v : parseFloat(v) || 0;
  }
  function round2(v) {
    return Math.round((v || 0) * 100) / 100;
  }
  function tsToMs(ts) {
    if (!ts) return 0;
    if (typeof ts.toMillis === "function") return ts.toMillis();
    if (typeof ts.toDate === "function") return ts.toDate().getTime();
    if (ts instanceof Date) return ts.getTime();
    if (typeof ts === "number") return ts;
    var d = new Date(ts);
    return isNaN(d.getTime()) ? 0 : d.getTime();
  }
  function parseDetail(x) {
    if (!x) return {};
    if (typeof x === "object") return x;
    try {
      var o = JSON.parse(String(x));
      return o && typeof o === "object" ? o : {};
    } catch (e) {
      return {};
    }
  }
  function normalizeRole(v) {
    var r = str(v).toLowerCase();
    if (r === "kitchen") return "kitchen";
    if (r === "owner") return "owner";
    return "cashier";
  }

  var ownerIds = {};
  (staffLines || []).forEach(function (sl) {
    if (!sl || !sl.isOwner) return;
    ownerIds[str(sl.staffId || sl.id || "")] = true;
  });
  ownerIds["owner_01"] = true;

  var hoursMap = {};
  (activityDocs || []).forEach(function (d) {
    var x = readData(d);
    if (x.kind !== "clock_in" && x.kind !== "clock_out") return;
    var sid = str(x.staffId || "");
    if (!sid) return;
    if (ownerIds[sid]) return;
    var det = parseDetail(x.detail);
    if (x.excludeFromStaffReport || x.testingSession || det.excludeFromStaffReport || det.testingSession) {
      return;
    }
    var role = normalizeRole(x.workRole || det.workRole);
    if (role === "owner") return;
    if (!hoursMap[sid]) {
      hoursMap[sid] = { name: str(x.staffName || ""), ins: [], outs: [] };
    }
    var ms = tsToMs(x.createdAt) || (typeof x.atMs === "number" ? x.atMs : 0);
    if (!ms) return;
    if (x.kind === "clock_in") {
      hoursMap[sid].ins.push({ ms: ms, role: role });
    } else {
      hoursMap[sid].outs.push(ms);
    }
  });

  var hoursSummary = {};
  Object.keys(hoursMap).forEach(function (sid) {
    var data = hoursMap[sid];
    var ins = data.ins.slice().sort(function (a, b) {
      return a.ms - b.ms;
    });
    var outs = data.outs.slice().sort(function (a, b) {
      return a - b;
    });
    var usedOut = {};
    var totalMs = 0;
    var cashierMs = 0;
    var kitchenMs = 0;
    var sessions = 0;
    var cashierSessions = 0;
    var kitchenSessions = 0;
    ins.forEach(function (ci) {
      for (var i = 0; i < outs.length; i++) {
        if (usedOut[i]) continue;
        if (outs[i] > ci.ms) {
          var dur = outs[i] - ci.ms;
          totalMs += dur;
          sessions++;
          if (ci.role === "kitchen") {
            kitchenMs += dur;
            kitchenSessions++;
          } else {
            cashierMs += dur;
            cashierSessions++;
          }
          usedOut[i] = true;
          break;
        }
      }
    });
    hoursSummary[sid] = {
      name: data.name,
      totalHours: round2(totalMs / 3600000),
      cashierHours: round2(cashierMs / 3600000),
      kitchenHours: round2(kitchenMs / 3600000),
      sessions: sessions,
      cashierSessions: cashierSessions,
      kitchenSessions: kitchenSessions
    };
  });

  var salesMap = {};
  (receiptDocs || []).forEach(function (d) {
    var x = readData(d);
    if (x.voided || x.isVoided) return;
    var sid = str(x.staffId || x.operationalStaffId || "");
    var sname = str(x.staffName || x.operationalStaffName || "");
    if (!sid && !sname) return;
    if (sid && ownerIds[sid]) return;
    var key = sid || sname;
    if (!salesMap[key]) {
      salesMap[key] = { staffId: sid, name: sname, totalSales: 0, orderCount: 0 };
    }
    salesMap[key].totalSales += num(x.subtotal);
    salesMap[key].orderCount += 1;
  });

  var generatedAt = new Date().toISOString();
  var salesLines = [];
  var attendanceLines = [];

  (staffLines || []).forEach(function (sl) {
    var sid = str(sl.staffId || sl.id || "");
    var staffName = str(sl.staffName || sl.name || "");
    var isOwner = !!sl.isOwner;
    if (isOwner) return;
    var hours = hoursSummary[sid] || {
      totalHours: 0,
      cashierHours: 0,
      kitchenHours: 0,
      sessions: 0,
      cashierSessions: 0,
      kitchenSessions: 0
    };
    var sales =
      salesMap[sid] ||
      salesMap[staffName.replace(/\s*\(Owner\)\s*$/i, "")] ||
      { totalSales: 0, orderCount: 0 };
    var sph = hours.cashierHours > 0 ? round2(sales.totalSales / hours.cashierHours) : 0;

    // Bahagian A — Prestasi Jualan (Cashier sahaja, keperluan #5 & #7)
    salesLines.push({
      staffId: sid,
      staffName: staffName,
      isOwner: isOwner,
      cashierHoursWorked: hours.cashierHours,
      cashierSessions: hours.cashierSessions,
      totalSalesRm: round2(sales.totalSales),
      totalOrders: sales.orderCount,
      salesPerHourRm: sph
    });

    // Bahagian B — Kehadiran & Gaji (semua tugas, keperluan #6)
    attendanceLines.push({
      staffId: sid,
      staffName: staffName,
      isOwner: isOwner,
      totalHoursWorked: hours.totalHours,
      totalSessions: hours.sessions,
      cashierHoursWorked: hours.cashierHours,
      kitchenHoursWorked: hours.kitchenHours,
      estimatedSalaryRm: isOwner ? 0 : 1000 // gaji rata RM1,000 semua staf — keperluan #6
    });
  });

  return {
    salesPerformance: { lines: salesLines, generatedAt: generatedAt },
    attendance: { lines: attendanceLines, generatedAt: generatedAt }
  };
}
