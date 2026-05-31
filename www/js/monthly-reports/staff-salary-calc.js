/**
 * Pengiraan gaji pekerja — kadar bulanan / jam, prorata bulan mula kerja, jumlah terkumpul.
 */

function round2(n) {
  return Math.round(n * 100) / 100;
}

export function tsToDate(ts) {
  if (!ts) return null;
  if (typeof ts.toDate === "function") return ts.toDate();
  if (ts instanceof Date) return ts;
  if (typeof ts.seconds === "number") return new Date(ts.seconds * 1000);
  return null;
}

export function staffMonthlyRate(data) {
  var pt = String((data && data.payType) || "hourly").toLowerCase();
  var amt = typeof data.payAmount === "number" ? data.payAmount : parseFloat(data.payAmount) || 0;
  if (pt === "monthly" || pt === "salary" || pt === "bulanan") return round2(amt);
  return round2(amt * 160);
}

/** @deprecated alias */
export function staffMonthlySalaryEstimate(data) {
  return staffMonthlyRate(data);
}

function daysInMonth(year, month1to12) {
  return new Date(year, month1to12, 0).getDate();
}

/**
 * Gaji untuk satu bulan kalendar — prorata jika mula kerja pertengahan bulan.
 * @returns {number} RM; 0 jika belum mula kerja atau sebelum tarikh mula.
 */
export function staffSalaryForCalendarMonth(data, year, month1to12) {
  var rate = staffMonthlyRate(data);
  if (!rate) return 0;

  var monthStart = new Date(year, month1to12 - 1, 1, 0, 0, 0, 0);
  var monthEnd = new Date(year, month1to12, 0, 23, 59, 59, 999);
  var started = tsToDate(data && data.startedAt);

  if (started && started > monthEnd) return 0;

  var dim = daysInMonth(year, month1to12);
  if (started && started > monthStart) {
    if (started.getFullYear() !== year || started.getMonth() !== month1to12 - 1) {
      return rate;
    }
    var fromDay = started.getDate();
    var daysEmployed = Math.max(0, dim - fromDay + 1);
    return round2((daysEmployed / dim) * rate);
  }

  return rate;
}

/**
 * Jumlah gaji terkumpul dari tarikh mula kerja hingga akhir bulan laporan.
 */
export function staffAccumulatedSalaryToDate(data, throughYear, throughMonth) {
  var started = tsToDate(data && data.startedAt);
  if (!started) return staffMonthlyRate(data);

  var total = 0;
  var cy = started.getFullYear();
  var cm = started.getMonth() + 1;

  while (cy < throughYear || (cy === throughYear && cm <= throughMonth)) {
    total += staffSalaryForCalendarMonth(data, cy, cm);
    cm += 1;
    if (cm > 12) {
      cm = 1;
      cy += 1;
    }
  }

  return round2(total);
}

export function staffStartedAtIso(data) {
  var d = tsToDate(data && data.startedAt);
  return d ? d.toISOString().slice(0, 10) : null;
}
