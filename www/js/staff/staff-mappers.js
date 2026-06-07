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

export const OWNER_STAFF_DOC_ID = "owner_01";

export function isOwnerStaffRecord(s) {
  if (!s) return false;
  return !!(
    s.isOwner ||
    String(s.id) === OWNER_STAFF_DOC_ID ||
    String(s.staffId) === OWNER_STAFF_DOC_ID ||
    String(s.role || "").toLowerCase() === "owner"
  );
}

export function sortStaffOwnerFirst(staffRows) {
  var owners = [];
  var rest = [];
  (staffRows || []).forEach(function (s) {
    if (isOwnerStaffRecord(s)) owners.push(s);
    else rest.push(s);
  });
  owners.sort(function (a, b) {
    return staffCanonicalDisplayName(a.name).localeCompare(staffCanonicalDisplayName(b.name), "ms");
  });
  rest.sort(function (a, b) {
    return staffCanonicalDisplayName(a.name).localeCompare(staffCanonicalDisplayName(b.name), "ms");
  });
  return owners.concat(rest);
}

export function staffDisplayNameWithOwnerSuffix(s) {
  var name = staffCanonicalDisplayName(s && s.name);
  return isOwnerStaffRecord(s) ? name + " (Owner)" : name;
}

export function docToStaff(d) {
  var data = d.data();
  var roster = Array.isArray(data.weeklyRoster) ? data.weeklyRoster : [];
  var role = String(data.role || "cashier");
  return {
    id: d.id,
    staffId: String(data.staffId || d.id || "").trim(),
    name: String(data.name || data.staffName || "").trim() || "Tanpa nama",
    email: String(data.email || "").trim(),
    role: role,
    isOwner: !!(data.isOwner || role.toLowerCase() === "owner" || d.id === OWNER_STAFF_DOC_ID),
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
    updatedAt: data.updatedAt,
    pin: String(data.pin || "").trim()
  };
}

export const STAFF_ROLES_MS = {
  owner: "Pemilik",
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

/** Nama untuk padanan longgar (huruf kecil, ruang tunggal). */
export function normalizeStaffNameKey(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * Nama paparan kanon (betulkan ejaan biasa); selain itu pulangkan nama asal.
 */
export function staffCanonicalDisplayName(name) {
  var n = normalizeStaffNameKey(name);
  if (n === "aina razak") return "Aina Razak";
  if (n === "danial chong" || n === "daniel chong") return "Daniel Chong";
  var t = String(name || "").trim();
  return t || "Tanpa nama";
}

/** @deprecated — guna `staffCanonicalDisplayName` */
export var retailStaffCanonicalLabel = staffCanonicalDisplayName;

function staffDocRecencyMillis(s) {
  if (!s) return 0;
  if (s.updatedAt && typeof s.updatedAt.toMillis === "function") return s.updatedAt.toMillis();
  if (s.createdAt && typeof s.createdAt.toMillis === "function") return s.createdAt.toMillis();
  return 0;
}

/**
 * Satu rekod setiap nama (kunci dinormalkan); kekalkan dokumen dengan kemas kini terkini.
 * Disusun mengikut nama paparan.
 */
export function dedupeStaffByNameKey(staffRows) {
  var owners = [];
  var by = {};
  (staffRows || []).forEach(function (s) {
    if (isOwnerStaffRecord(s)) {
      owners.push(s);
      return;
    }
    var k = normalizeStaffNameKey(s.name);
    if (!k) return;
    var prev = by[k];
    if (!prev || staffDocRecencyMillis(s) >= staffDocRecencyMillis(prev)) by[k] = s;
  });
  var merged = owners.concat(
    Object.keys(by).map(function (k) {
      return by[k];
    })
  );
  return sortStaffOwnerFirst(merged);
}

/** @deprecated — guna `dedupeStaffByNameKey` */
export function dedupeStaffByCanonical(rows) {
  return dedupeStaffByNameKey(rows);
}

/** Firestore `staff_activity` → baris UI (kind, createdAt). */
export function docToStaffActivity(d) {
  var data = d.data();
  if (!data || typeof data !== "object") {
    return {
      id: d.id,
      staffId: "",
      staffName: "",
      kind: "",
      detail: "",
      createdAt: null
    };
  }
  return {
    id: d.id,
    staffId: String(data.staffId || ""),
    staffName: String(data.staffName || ""),
    kind: String(data.kind || ""),
    detail: data.detail != null ? String(data.detail) : "",
    createdAt: data.createdAt || null
  };
}

/** Firestore `pos_shifts` → baris jadual drawer. */
export function docToPosShift(doc) {
  var x = doc.data();
  var closing = x.closing || {};
  return {
    id: doc.id,
    openedAt: x.openedAt,
    closedAt: x.closedAt,
    status: x.status || "closed",
    openingCash: typeof x.openingCash === "number" ? x.openingCash : 0,
    openedByDisplayName: x.openedByDisplayName || "—",
    actualDrawer: typeof closing.actualDrawer === "number" ? closing.actualDrawer : null,
    expectedDrawer: typeof closing.expectedDrawer === "number" ? closing.expectedDrawer : null,
    variance: typeof closing.variance === "number" ? closing.variance : 0,
    varianceCategory: closing.varianceCategory || "unknown",
    note: closing.note || ""
  };
}
