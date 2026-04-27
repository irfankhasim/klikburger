/**
 * Firestore `staff` → objek UI.
 * weeklyRoster: { day: 0–6 (Ahad=0), shift: string }[] — "cuti" / "" = tidak bertugas.
 */

function tsToDate(ts) {
  if (!ts) return null;
  if (typeof ts.toDate === "function") return ts.toDate();
  if (ts instanceof Date) return ts;
  return null;
}

export function docToStaff(d) {
  var data = d.data();
  var roster = Array.isArray(data.weeklyRoster) ? data.weeklyRoster : [];
  return {
    id: d.id,
    name: String(data.name || "").trim() || "Tanpa nama",
    role: String(data.role || "cashier"),
    phone: String(data.phone || "").trim(),
    startedAt: data.startedAt,
    startedAtDate: tsToDate(data.startedAt),
    employmentStatus: String(data.employmentStatus || "active"),
    payType: String(data.payType || "hourly"),
    payAmount: typeof data.payAmount === "number" ? data.payAmount : parseFloat(data.payAmount) || 0,
    defaultShift: String(data.defaultShift || "pagi"),
    weeklyRoster: roster
      .map(function (r) {
        return {
          day: typeof r.day === "number" ? r.day : parseInt(r.day, 10),
          shift: String(r.shift || "").trim()
        };
      })
      .filter(function (r) {
        return !isNaN(r.day) && r.day >= 0 && r.day <= 6;
      }),
    createdAt: data.createdAt,
    updatedAt: data.updatedAt
  };
}

export const STAFF_ROLES_MS = {
  cashier: "Kaunter",
  kitchen: "Dapur",
  runner: "Runner",
  supervisor: "Penyelia"
};

export const STAFF_STATUS_MS = {
  active: "Aktif",
  leave: "Cuti",
  terminated: "Berhenti"
};

export const SHIFT_LABELS_MS = {
  pagi: "Pagi",
  petang: "Petang",
  penuh: "Sepenuh masa",
  cuti: "Cuti"
};
