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
import { COL_STAFF, COL_STAFF_ACTIVITY, COL_STAFF_SETTINGS, COL_SALES } from "../firebase/collections.js";

export function subscribeStaff(onNext, onError) {
  return onSnapshot(collection(db, COL_STAFF), onNext, onError);
}

export function subscribeStaffActivity(onNext, onError, maxRows) {
  var lim = typeof maxRows === "number" && maxRows > 0 ? maxRows : 120;
  var q = query(collection(db, COL_STAFF_ACTIVITY), orderBy("createdAt", "desc"), limit(lim));
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

export async function getStaffSettings() {
  var ref = doc(db, COL_STAFF_SETTINGS, SETTINGS_DOC_ID);
  var snap = await getDoc(ref);
  if (!snap.exists()) {
    return {
      teamMonthlyTargetRm: 15000,
      bonusRateAboveTarget: 0.03,
      ratingBase: 3.6
    };
  }
  var d = snap.data();
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
