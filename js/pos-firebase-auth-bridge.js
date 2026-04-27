/**
 * Firebase Auth + dokumen Firestore `users/{uid}` (medan `role`, `displayName`) untuk RBAC POS.
 */
import { auth, onAuthStateChanged, db, doc, getDoc } from "./firebase/init.js";
import { COL_POS_USERS } from "./firebase/collections.js";
import { ROLES } from "./pos-rbac-session.js";

/** Tunggu keputusan pertama `onAuthStateChanged` (null jika tidak log masuk). */
export function waitForAuthUser() {
  return new Promise(function (resolve) {
    var unsub = onAuthStateChanged(auth, function (u) {
      unsub();
      resolve(u);
    });
  });
}

export function mapFirestoreRoleToRbac(roleStr) {
  var r = String(roleStr || "")
    .toLowerCase()
    .replace(/\s+/g, "_");
  if (r === "owner") return ROLES.OWNER;
  if (r === "admin") return ROLES.ADMIN;
  if (r === "shift_lead" || r === "shiftlead") return ROLES.SHIFT_LEAD;
  return ROLES.CASHIER;
}

/**
 * @param {import("firebase/auth").User} firebaseUser
 * @returns {Promise<{ userId: string, displayName: string, email: string, role: string }>}
 */
export async function getPosUserRbacPayload(firebaseUser) {
  var snap = await getDoc(doc(db, COL_POS_USERS, firebaseUser.uid));
  var role = ROLES.CASHIER;
  var displayName = (firebaseUser.displayName || "").trim();
  if (snap.exists()) {
    var d = snap.data();
    role = mapFirestoreRoleToRbac(d.role);
    var dn = (d.displayName || "").trim();
    if (dn) displayName = dn;
  }
  if (!displayName) {
    var em = firebaseUser.email || "";
    displayName = em ? em.split("@")[0] : "Pengguna";
  }
  return {
    userId: firebaseUser.uid,
    displayName: displayName,
    email: firebaseUser.email || "",
    role: role
  };
}
