/**
 * Firebase Auth + dokumen Firestore `users/{uid}` (medan `role`, `displayName`) untuk RBAC POS.
 */
import { auth, onAuthStateChanged, db, doc, getDoc } from "./firebase/init.js";
import { COL_POS_USERS } from "./firebase/collections.js";
import { ROLES } from "./pos-rbac-session.js";

var AUTH_WAIT_MS = 12000;
var USER_DOC_MS = 6000;

/**
 * Tunggu Auth siap baca persistence (`authStateReady`), kemudian `currentUser`.
 * Elak `onAuthStateChanged` pertama `null` sebelum sesi dipulihkan; ada tamat masa.
 */
export function waitForAuthUser() {
  return new Promise(function (resolve) {
    var settled = false;
    var unsub = null;
    function finish(u) {
      if (settled) return;
      settled = true;
      try {
        window.clearTimeout(tid);
      } catch (e) {}
      try {
        if (typeof unsub === "function") unsub();
      } catch (e2) {}
      resolve(u || null);
    }
    var tid = window.setTimeout(function () {
      try {
        finish(auth.currentUser || null);
      } catch (e) {
        finish(null);
      }
    }, AUTH_WAIT_MS);
    try {
      if (auth && typeof auth.authStateReady === "function") {
        auth
          .authStateReady()
          .then(function () {
            finish(auth.currentUser || null);
          })
          .catch(function () {
            try {
              finish(auth.currentUser || null);
            } catch (e) {
              finish(null);
            }
          });
      } else {
        unsub = onAuthStateChanged(auth, function (u) {
          finish(u || null);
        });
      }
    } catch (e) {
      finish(null);
    }
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
  var snap = null;
  try {
    snap = await Promise.race([
      getDoc(doc(db, COL_POS_USERS, firebaseUser.uid)),
      new Promise(function (_, reject) {
        window.setTimeout(function () {
          reject(new Error("users-doc-timeout"));
        }, USER_DOC_MS);
      })
    ]);
  } catch (e) {
    console.warn("[rbac] Lewat/gagal baca users/{uid} — guna data Auth sahaja.", e);
  }
  var role = ROLES.CASHIER;
  var displayName = (firebaseUser.displayName || "").trim();
  if (snap && snap.exists()) {
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
