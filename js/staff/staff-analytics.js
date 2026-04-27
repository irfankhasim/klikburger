/**
 * Agregat jualan + prestasi kakitangan (sisi klien, sesuai SME).
 */

function pad2(n) {
  return (n < 10 ? "0" : "") + n;
}

function saleCreatedAtDate(data) {
  var c = data && data.createdAt;
  if (c && typeof c.toDate === "function") return c.toDate();
  if (typeof data.createdAtMs === "number") return new Date(data.createdAtMs);
  return null;
}

export function parseSaleDoc(d) {
  var data = d.data();
  var dt = saleCreatedAtDate(data);
  var lines = Array.isArray(data.lines) ? data.lines : [];
  return {
    id: d.id,
    staffId: String(data.staffId || ""),
    staffName: String(data.staffName || ""),
    subtotal: typeof data.subtotal === "number" ? data.subtotal : parseFloat(data.subtotal) || 0,
    lineCount: lines.reduce(function (s, L) {
      var q = typeof L.qty === "number" ? L.qty : parseFloat(L.qty) || 0;
      return s + (q > 0 ? 1 : 0);
    }, 0),
    orderQty: lines.reduce(function (s, L) {
      return s + (typeof L.qty === "number" ? L.qty : parseFloat(L.qty) || 0);
    }, 0),
    createdAt: dt
  };
}

export function inMonth(d, y, m0) {
  if (!d || !(d instanceof Date) || isNaN(d.getTime())) return false;
  return d.getFullYear() === y && d.getMonth() === m0;
}

/** Stat per staffId untuk bulan terpilih. */
export function aggregateStaffSales(staffList, saleDocs, y, m0) {
  var byId = {};
  staffList.forEach(function (s) {
    byId[String(s.id)] = {
      staffId: String(s.id),
      name: s.name,
      role: s.role,
      defaultShift: s.defaultShift,
      weeklyRoster: s.weeklyRoster || [],
      employmentStatus: s.employmentStatus,
      revenue: 0,
      orders: 0,
      lineItems: 0,
      saleDates: {}
    };
  });
  saleDocs.forEach(function (doc) {
    var row = parseSaleDoc(doc);
    if (!row.staffId || !inMonth(row.createdAt, y, m0)) return;
    var b = byId[row.staffId];
    if (!b) {
      byId[row.staffId] = b = {
        staffId: row.staffId,
        name: row.staffName || "(Tidak dalam senarai)",
        role: "",
        defaultShift: "",
        weeklyRoster: [],
        employmentStatus: "active",
        revenue: 0,
        orders: 0,
        lineItems: 0,
        saleDates: {}
      };
    }
    b.revenue += row.subtotal;
    b.orders += 1;
    b.lineItems += row.lineCount || 1;
    if (row.createdAt) {
      var key =
        row.createdAt.getFullYear() +
        "-" +
        pad2(row.createdAt.getMonth() + 1) +
        "-" +
        pad2(row.createdAt.getDate());
      b.saleDates[key] = true;
    }
  });
  return Object.keys(byId).map(function (k) {
    return byId[k];
  });
}

export function rosterShiftForDay(weeklyRoster, dayIndex) {
  if (!weeklyRoster || !weeklyRoster.length) return "";
  var hit = weeklyRoster.find(function (r) {
    return r.day === dayIndex;
  });
  return hit ? String(hit.shift || "") : "";
}

/** Hari ini (tempatan): siapa berjadual (bukan cuti). */
export function staffOnDutyToday(staffList, now) {
  var d = now || new Date();
  var dow = d.getDay();
  return staffList.filter(function (s) {
    if (s.employmentStatus !== "active") return false;
    var sh = rosterShiftForDay(s.weeklyRoster, dow);
    if (!sh || sh === "cuti") return false;
    return true;
  });
}

export function serviceRatingProxy(orders, lineItems, ratingBase) {
  var base = typeof ratingBase === "number" ? ratingBase : 3.6;
  var bump = Math.min(1.35, Math.log1p(orders) * 0.12 + Math.log1p(lineItems) * 0.04);
  return Math.round(Math.min(5, base + bump) * 10) / 10;
}

export function scheduledDaysInMonth(weeklyRoster, y, m0) {
  if (!weeklyRoster || !weeklyRoster.length) return 0;
  var days = new Date(y, m0 + 1, 0).getDate();
  var n = 0;
  for (var dom = 1; dom <= days; dom++) {
    var dt = new Date(y, m0, dom);
    var dow = dt.getDay();
    var sh = rosterShiftForDay(weeklyRoster, dow);
    if (sh && sh !== "cuti") n++;
  }
  return n;
}

export function attendanceRatePct(stat, y, m0) {
  var worked = Object.keys(stat.saleDates || {}).length;
  var sched = scheduledDaysInMonth(stat.weeklyRoster, y, m0);
  if (sched <= 0) return worked > 0 ? 100 : 0;
  return Math.min(100, Math.round((worked / sched) * 100));
}

export function performanceTier(stat, allStats) {
  var orders = stat.orders || 0;
  var list = (allStats || []).map(function (x) {
    return x.orders || 0;
  });
  if (!list.length) return "baik";
  list.sort(function (a, b) {
    return a - b;
  });
  var p75 = list[Math.floor(list.length * 0.75)] || 0;
  var med = list[Math.floor(list.length * 0.5)] || 0;
  if (orders >= p75 && orders > 0) return "cemerlang";
  if (orders >= med) return "baik";
  return "perlu_baiki";
}

export const TIER_MS = {
  cemerlang: "Cemerlang",
  baik: "Baik",
  perlu_baiki: "Perlu dipertingkat"
};

export function rankStats(stats) {
  var arr = stats.slice().sort(function (a, b) {
    return (b.revenue || 0) - (a.revenue || 0);
  });
  var rankById = {};
  arr.forEach(function (s, i) {
    rankById[s.staffId] = i + 1;
  });
  return rankById;
}

export function teamRevenue(stats) {
  return stats.reduce(function (s, x) {
    return s + (x.revenue || 0);
  }, 0);
}

export function bonusPoolEstimate(teamTotal, targetRm, rate) {
  if (teamTotal <= targetRm || targetRm <= 0) return 0;
  return Math.round((teamTotal - targetRm) * (rate || 0) * 100) / 100;
}
