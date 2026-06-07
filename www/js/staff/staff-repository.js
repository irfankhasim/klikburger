/**
 * Firestore: kakitangan, log aktiviti, tetapan KPI.
 */
import {
  db,
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  getDoc,
  getDocs,
  setDoc,
  query,
  orderBy,
  limit,
  where,
  serverTimestamp,
  Timestamp
} from "../firebase/init.js";
import {
  COL_STAFF,
  COL_STAFF_ACTIVITY,
  COL_STAFF_SETTINGS,
  COL_SALES,
  COL_POS_AUDIT,
  COL_POS_SHIFTS
} from "../firebase/collections.js";
import { OWNER_STAFF_DOC_ID } from "./staff-mappers.js";

export { OWNER_STAFF_DOC_ID };

export function subscribeStaff(onNext, onError) {
  return onSnapshot(collection(db, COL_STAFF), onNext, onError);
}

function staffActivityMonthBounds(year, m0) {
  var y = typeof year === "number" ? year : new Date().getFullYear();
  var m = typeof m0 === "number" && m0 >= 0 && m0 <= 11 ? m0 : new Date().getMonth();
  return {
    start: Timestamp.fromDate(new Date(y, m, 1)),
    end: Timestamp.fromDate(new Date(y, m + 1, 1))
  };
}

/**
 * Langgan `staff_activity` — susun & tapis ikut `createdAt` (bukan `at`).
 * @param {number|{ maxRows?: number, year?: number, m0?: number }} opts — had baris, atau julat bulan (m0 = 0–11)
 */
export function subscribeStaffActivity(onNext, onError, opts) {
  var lim = 200;
  var year = null;
  var m0 = null;
  if (typeof opts === "number" && opts > 0) {
    lim = opts;
  } else if (opts && typeof opts === "object") {
    if (typeof opts.maxRows === "number" && opts.maxRows > 0) lim = opts.maxRows;
    if (typeof opts.year === "number") year = opts.year;
    if (typeof opts.m0 === "number") m0 = opts.m0;
  }
  var coll = collection(db, COL_STAFF_ACTIVITY);
  var q;
  if (year != null && m0 != null && m0 >= 0 && m0 <= 11) {
    var bounds = staffActivityMonthBounds(year, m0);
    q = query(
      coll,
      where("createdAt", ">=", bounds.start),
      where("createdAt", "<", bounds.end),
      orderBy("createdAt", "desc"),
      limit(lim)
    );
  } else {
    q = query(coll, orderBy("createdAt", "desc"), limit(lim));
  }
  return onSnapshot(q, onNext, onError);
}

/**
 * Langgan `pos_shifts` ditutup — tapis ikut `openedAt` dalam bulan dipilih.
 * @param {number|{ maxRows?: number, year?: number, m0?: number }} opts — m0 = 0–11
 */
export function subscribeClosedPosShifts(onNext, onError, opts) {
  var lim = 200;
  var year = null;
  var m0 = null;
  if (typeof opts === "number" && opts > 0) {
    lim = opts;
  } else if (opts && typeof opts === "object") {
    if (typeof opts.maxRows === "number" && opts.maxRows > 0) lim = opts.maxRows;
    if (typeof opts.year === "number") year = opts.year;
    if (typeof opts.m0 === "number") m0 = opts.m0;
  }
  var coll = collection(db, COL_POS_SHIFTS);
  var q;
  if (year != null && m0 != null && m0 >= 0 && m0 <= 11) {
    var bounds = staffActivityMonthBounds(year, m0);
    q = query(
      coll,
      where("status", "==", "closed"),
      where("openedAt", ">=", bounds.start),
      where("openedAt", "<", bounds.end),
      orderBy("openedAt", "desc"),
      limit(lim)
    );
  } else {
    q = query(
      coll,
      where("status", "==", "closed"),
      orderBy("openedAt", "desc"),
      limit(lim)
    );
  }
  return onSnapshot(
    q,
    function (snap) {
      onNext({ docs: snap.docs });
    },
    onError
  );
}

/** Log audit POS — pilihan; jadual drawer utama guna `subscribeClosedPosShifts`. */
export function subscribePosAuditLogs(onNext, onError, maxRows) {
  var lim = typeof maxRows === "number" && maxRows > 0 ? maxRows : 400;
  var q = query(collection(db, COL_POS_AUDIT), orderBy("at", "desc"), limit(lim));
  return onSnapshot(q, onNext, onError);
}

export function addStaff(payload) {
  return addDoc(collection(db, COL_STAFF), {
    ...payload,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

export function persistStaff(id, payload) {
  var patch = Object.assign({}, payload);
  if (String(id) === OWNER_STAFF_DOC_ID) {
    patch.staffId = OWNER_STAFF_DOC_ID;
    patch.isOwner = true;
    patch.role = "owner";
  }
  return updateDoc(doc(db, COL_STAFF, id), {
    ...patch,
    updatedAt: serverTimestamp()
  });
}

export async function getOwnerStaffDoc() {
  var snap = await getDoc(doc(db, COL_STAFF, OWNER_STAFF_DOC_ID));
  if (!snap.exists()) return null;
  return { id: snap.id, data: snap.data() };
}

export async function staffPinExists(staffDocId) {
  var sid = String(staffDocId || "").trim();
  if (!sid) return false;
  var snap = await getDoc(doc(db, "staff_pins", sid));
  if (!snap.exists()) return false;
  return !!String(snap.data().pin || "").trim();
}

export function removeStaff(id) {
  return deleteDoc(doc(db, COL_STAFF, id));
}

export function appendStaffActivity(entry) {
  return addDoc(collection(db, COL_STAFF_ACTIVITY), {
    staffId: entry.staffId != null ? String(entry.staffId) : "",
    staffName: entry.staffName != null ? String(entry.staffName) : "",
    kind: String(entry.kind || "note"),
    saleId: entry.saleId != null ? String(entry.saleId) : "",
    detail: entry.detail != null ? String(entry.detail) : "",
    subtotal: typeof entry.subtotal === "number" ? entry.subtotal : null,
    orderCount: typeof entry.orderCount === "number" ? entry.orderCount : null,
    createdAt: serverTimestamp()
  });
}

const SETTINGS_DOC_ID = "default";

function parseStaffSettingsData(d) {
  if (!d || typeof d !== "object") {
    return {
      teamMonthlyTargetRm: 15000,
      bonusRateAboveTarget: 0.03,
      ratingBase: 3.6
    };
  }
  return {
    teamMonthlyTargetRm:
      typeof d.teamMonthlyTargetRm === "number" ? d.teamMonthlyTargetRm : parseFloat(d.teamMonthlyTargetRm) || 15000,
    bonusRateAboveTarget:
      typeof d.bonusRateAboveTarget === "number"
        ? d.bonusRateAboveTarget
        : parseFloat(d.bonusRateAboveTarget) || 0.03,
    ratingBase: typeof d.ratingBase === "number" ? d.ratingBase : parseFloat(d.ratingBase) || 3.6
  };
}

export async function getStaffSettings() {
  var ref = doc(db, COL_STAFF_SETTINGS, SETTINGS_DOC_ID);
  var snap = await getDoc(ref);
  if (!snap.exists()) return parseStaffSettingsData(null);
  return parseStaffSettingsData(snap.data());
}

export function subscribeStaffSettings(onNext, onError) {
  var ref = doc(db, COL_STAFF_SETTINGS, SETTINGS_DOC_ID);
  return onSnapshot(
    ref,
    function (snap) {
      onNext(parseStaffSettingsData(snap.exists() ? snap.data() : null));
    },
    onError
  );
}

export function saveStaffSettings(data) {
  return setDoc(
    doc(db, COL_STAFF_SETTINGS, SETTINGS_DOC_ID),
    {
      teamMonthlyTargetRm: data.teamMonthlyTargetRm,
      bonusRateAboveTarget: data.bonusRateAboveTarget,
      ratingBase: data.ratingBase,
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );
}

/** Jualan terkini untuk agregat (had SME). */
export function subscribeRecentSales(onNext, onError, maxRows) {
  var lim = typeof maxRows === "number" && maxRows > 0 ? maxRows : 400;
  var q = query(collection(db, COL_SALES), orderBy("createdAt", "desc"), limit(lim));
  return onSnapshot(q, onNext, onError);
}

export async function fetchSalesForStaff(staffId, maxRows) {
  var lim = typeof maxRows === "number" && maxRows > 0 ? maxRows : 80;
  var sid = String(staffId || "");
  if (!sid) return [];
  var q = query(collection(db, COL_SALES), where("staffId", "==", sid), orderBy("createdAt", "desc"), limit(lim));
  var snap = await getDocs(q);
  return snap.docs;
}
