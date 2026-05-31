/**
 * Firebase Auth + dokumen Firestore `users/{uid}` (medan `role`, `displayName`) untuk RBAC POS.
 */
import { auth, onAuthStateChanged, db, doc, getDoc, collection, query, where, limit, getDocs } from "./firebase/init.js";
import { COL_POS_USERS } from "./firebase/collections.js";
import { ROLES } from "./pos-rbac-constants.js";

var AUTH_WAIT_MS = 8000;

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

/**
 * Tapis petikan pintar / BOM; elak ralat "owner" dengan aksara tersembunyi tidak dipadankan.
 */
function coerceRoleInput(v) {
  if (v == null) return "";
  if (typeof v === "string") {
    return v
      .replace(/[\ufeff]/g, "")
      .replace(/[\u201c\u201d\u2018\u2019]/g, '"')
      .trim();
  }
  if (typeof v === "number" && !isNaN(v)) return String(v);
  return "";
}

/**
 * Ambil string peranan daripada medan biasa / nama alternatif / `profile.role`.
 */
export function pickRoleRawStringFromUserData(d) {
  if (!d || typeof d !== "object") return "";
  var keys = ["role", "userRole", "posRole", "rbacRole", "user_role", "Role", "USER_ROLE"];
  for (var i = 0; i < keys.length; i++) {
    var s = coerceRoleInput(d[keys[i]]);
    if (s) return s;
  }
  if (d.profile && typeof d.profile === "object") {
    var p = coerceRoleInput(d.profile.role);
    if (p) return p;
  }
  return "";
}

export function mapFirestoreRoleToRbac(roleStr) {
  var r = String(coerceRoleInput(roleStr) || "")
    .toLowerCase()
    .replace(/\s+/g, "_");
  if (r === "owner" || r === "pemilik") return ROLES.OWNER;
  if (r === "admin" || r === "pentadbir") return ROLES.ADMIN;
  if (r === "shift_lead" || r === "shiftlead") return ROLES.SHIFT_LEAD;
  return ROLES.CASHIER;
}

/** Petakan keseluruhan dokumen `users/{uid}` kepada ROLES.* */
export function mapUserDocToRbacRole(userData) {
  return mapFirestoreRoleToRbac(pickRoleRawStringFromUserData(userData));
}

/**
 * Baca `users/{auth.uid}`; jika tiada, cari dokumen dengan medan `email` sama (ID dokumen sering tersalah vs UID Auth).
 * @param {import("firebase/auth").User} firebaseUser
 * @returns {Promise<import("firebase/firestore").DocumentSnapshot>}
 */
export async function fetchUserProfileSnapForAuth(firebaseUser) {
  var uid = String(firebaseUser.uid || "");
  var snap = await getDoc(doc(db, COL_POS_USERS, uid));
  if (snap.exists()) return snap;
  var rawEmail = (firebaseUser.email || "").trim();
  if (!rawEmail) return snap;
  var variants = [rawEmail, rawEmail.toLowerCase()];
  var tried = {};
  for (var v = 0; v < variants.length; v++) {
    var em = variants[v];
    if (!em || tried[em]) continue;
    tried[em] = true;
    try {
      var qs = await getDocs(
        query(collection(db, COL_POS_USERS), where("email", "==", em), limit(25))
      );
      if (qs.empty) continue;
      var docs = qs.docs;
      for (var i = 0; i < docs.length; i++) {
        var rr = mapUserDocToRbacRole(docs[i].data());
        if (rr === ROLES.OWNER || rr === ROLES.ADMIN) {
          return docs[i];
        }
      }
      return docs[0];
    } catch (err) {
      console.warn("[rbac] carian users by email gagal:", em, err);
    }
  }
  return snap;
}

/**
 * @param {import("firebase/auth").User} firebaseUser
 * @returns {Promise<{ userId: string, displayName: string, email: string, role: string }>}
 */
export async function getPosUserRbacPayload(firebaseUser) {
  var snap = null;
  try {
    snap = await fetchUserProfileSnapForAuth(firebaseUser);
  } catch (e) {
    console.warn("[rbac] Gagal baca users/{uid} — guna data Auth sahaja.", e);
  }
  var role = ROLES.CASHIER;
  var displayName = (firebaseUser.displayName || "").trim();
  if (snap && snap.exists()) {
    var d = snap.data();
    role = mapUserDocToRbacRole(d);
    var dn = coerceRoleInput(d.displayName) || coerceRoleInput(d.name);
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
