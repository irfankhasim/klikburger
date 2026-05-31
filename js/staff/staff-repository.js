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
  serverTimestamp
} from "../firebase/init.js";
import {
  COL_STAFF,
  COL_STAFF_ACTIVITY,
  COL_STAFF_SETTINGS,
  COL_SALES,
  COL_POS_AUDIT,
  COL_POS_SHIFTS
} from "../firebase/collections.js";

export function subscribeStaff(onNext, onError) {
  return onSnapshot(collection(db, COL_STAFF), onNext, onError);
}

export function subscribeStaffActivity(onNext, onError, maxRows) {
  var lim = typeof maxRows === "number" && maxRows > 0 ? maxRows : 200;
  var q = query(collection(db, COL_STAFF_ACTIVITY), orderBy("createdAt", "desc"), limit(lim));
  return onSnapshot(q, onNext, onError);
}

/** Shift POS ditutup — jadual drawer (amaun awal / akhir / varians). */
export function subscribeClosedPosShifts(onNext, onError, maxRows) {
  var lim = typeof maxRows === "number" && maxRows > 0 ? maxRows : 200;
  var fetchLim = Math.min(lim * 3, 600);
  var q = query(collection(db, COL_POS_SHIFTS), orderBy("closedAt", "desc"), limit(fetchLim));
  return onSnapshot(
    q,
    function (snap) {
      var docs = snap.docs.filter(function (d) {
        var x = d.data();
        return String(x.status || "") === "closed" && x.closedAt;
      });
      if (docs.length > lim) docs = docs.slice(0, lim);
      onNext({ docs: docs });
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
  return updateDoc(doc(db, COL_STAFF, id), {
    ...payload,
    updatedAt: serverTimestamp()
  });
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
      ratingBase: 3.6,
      customerTaxPercent: 0
    };
  }
  return {
    teamMonthlyTargetRm:
      typeof d.teamMonthlyTargetRm === "number" ? d.teamMonthlyTargetRm : parseFloat(d.teamMonthlyTargetRm) || 15000,
    bonusRateAboveTarget:
      typeof d.bonusRateAboveTarget === "number"
        ? d.bonusRateAboveTarget
        : parseFloat(d.bonusRateAboveTarget) || 0.03,
    ratingBase: typeof d.ratingBase === "number" ? d.ratingBase : parseFloat(d.ratingBase) || 3.6,
    customerTaxPercent:
      typeof d.customerTaxPercent === "number" ? d.customerTaxPercent : parseFloat(d.customerTaxPercent) || 0
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
      customerTaxPercent:
        typeof data.customerTaxPercent === "number"
          ? data.customerTaxPercent
          : parseFloat(data.customerTaxPercent) || 0,
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
