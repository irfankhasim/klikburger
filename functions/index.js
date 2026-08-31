const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { authenticator } = require("otplib");

initializeApp();

const REGION = "asia-southeast1";
/** Mesti padan js/staff/staff-mappers.js OWNER_STAFF_DOC_ID. */
const OWNER_STAFF_DOC_ID = "owner_01";
const OWNER_ROLES = ["owner", "OWNER", "pemilik", "PEMILIK"];
const MAX_TOTP_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 10;

/**
 * Sahkan caller (request.auth.uid) memang Owner, guna users/{uid}.role.
 * Sepadan logik isOwner() dalam firestore.rules — disemak semula di sini sebab
 * Admin SDK dalam Cloud Function memintas Firestore rules sepenuhnya.
 */
async function assertCallerIsOwner(request) {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Log masuk diperlukan.");
  }
  const db = getFirestore();
  const userSnap = await db.collection("users").doc(request.auth.uid).get();
  const role = userSnap.exists ? userSnap.data().role : null;
  if (!OWNER_ROLES.includes(role)) {
    throw new HttpsError("permission-denied", "Hanya pemilik (owner) boleh buat tindakan ini.");
  }
  return request.auth.uid;
}

function requireCode(code) {
  const codeStr = typeof code === "string" ? code.trim() : "";
  if (!/^\d{6}$/.test(codeStr)) {
    throw new HttpsError("invalid-argument", "Kod 2FA mesti 6 digit angka.");
  }
  return codeStr;
}

/** Semak kunci-lockout sedia ada; throw kalau masih terkunci. */
function assertNotLocked(data) {
  const lockedUntil = data && data.lockedUntil;
  if (lockedUntil && typeof lockedUntil.toMillis === "function" && lockedUntil.toMillis() > Date.now()) {
    throw new HttpsError("resource-exhausted", "Terlalu banyak percubaan salah. Cuba lagi sebentar.");
  }
}

/** Rekod kegagalan TOTP: naikkan failedAttempts, kunci lepas had. Pulangkan patch untuk update(). */
function failureUpdatePatch(data) {
  const attempts = (data && typeof data.failedAttempts === "number" ? data.failedAttempts : 0) + 1;
  const patch = { failedAttempts: attempts, updatedAt: FieldValue.serverTimestamp() };
  if (attempts >= MAX_TOTP_ATTEMPTS) {
    patch.lockedUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000);
    patch.failedAttempts = 0;
  }
  return patch;
}

const successUpdatePatch = () => ({
  failedAttempts: 0,
  lockedUntil: null,
  updatedAt: FieldValue.serverTimestamp()
});

const EARTH_RADIUS_M = 6371000;

/** Jarak antara dua titik GPS (meter), formula haversine. */
function distanceMeters(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ============================================================================
// Lokasi kedai — sekatan geo untuk clock-in, elak clock-in dari jauh (cth staf
// minta kawan clock-in bagi pihak dia semasa dia tak berada di kedai).
// ============================================================================

exports.setStoreLocation = onCall({ region: REGION }, async (request) => {
  await assertCallerIsOwner(request);
  const { lat, lng, radiusMeters } = request.data || {};
  if (typeof lat !== "number" || typeof lng !== "number" || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    throw new HttpsError("invalid-argument", "Koordinat GPS tidak sah.");
  }
  const radius = typeof radiusMeters === "number" && radiusMeters > 0 ? radiusMeters : 150;
  const db = getFirestore();
  await db.collection("pos_meta").doc("store_location").set({
    lat,
    lng,
    radiusMeters: radius,
    updatedAt: FieldValue.serverTimestamp()
  });
  return { ok: true };
});

exports.clearStoreLocation = onCall({ region: REGION }, async (request) => {
  await assertCallerIsOwner(request);
  const db = getFirestore();
  await db.collection("pos_meta").doc("store_location").delete();
  return { ok: true };
});

// ============================================================================
// Staff 2FA — clock-in, togol per-staf, diurus oleh Owner dari Staff Management
// (Owner TIDAK tertakluk 2FA — rekod owner_01 sentiasa dilangkau, lihat verifyStaffClockIn.)
// ============================================================================

exports.enrollStaffTotp = onCall({ region: REGION }, async (request) => {
  await assertCallerIsOwner(request);
  const staffId = String((request.data && request.data.staffId) || "").trim();
  if (!staffId) throw new HttpsError("invalid-argument", "staffId diperlukan.");
  if (staffId === OWNER_STAFF_DOC_ID) {
    throw new HttpsError("permission-denied", "Rekod Owner tidak menggunakan Staff 2FA. Guna tetapan 2FA akaun sendiri.");
  }
  const db = getFirestore();
  const secret = authenticator.generateSecret();
  await db.collection("staff_totp").doc(staffId).set({
    secret,
    failedAttempts: 0,
    lockedUntil: null,
    updatedAt: FieldValue.serverTimestamp()
  });
  const otpauthUrl = authenticator.keyuri(staffId, "Tab Kaunter", secret);
  return { secret, otpauthUrl };
});

exports.confirmStaffTotpEnrollment = onCall({ region: REGION }, async (request) => {
  await assertCallerIsOwner(request);
  const staffId = String((request.data && request.data.staffId) || "").trim();
  const code = requireCode(request.data && request.data.code);
  if (!staffId) throw new HttpsError("invalid-argument", "staffId diperlukan.");
  const db = getFirestore();
  const ref = db.collection("staff_totp").doc(staffId);
  const snap = await ref.get();
  if (!snap.exists || !snap.data().secret) {
    throw new HttpsError("failed-precondition", "Belum ada secret 2FA. Mula enrollment dahulu.");
  }
  if (!authenticator.check(code, snap.data().secret)) {
    throw new HttpsError("invalid-argument", "Kod tidak sepadan. Sila cuba lagi.");
  }
  await db.collection("staff_totp_status").doc(staffId).set({
    enrolled: true,
    enabled: true,
    enrolledAt: FieldValue.serverTimestamp()
  });
  return { ok: true };
});

exports.setStaffTotpEnabled = onCall({ region: REGION }, async (request) => {
  await assertCallerIsOwner(request);
  const staffId = String((request.data && request.data.staffId) || "").trim();
  const enabled = !!(request.data && request.data.enabled);
  if (!staffId) throw new HttpsError("invalid-argument", "staffId diperlukan.");
  if (staffId === OWNER_STAFF_DOC_ID) {
    throw new HttpsError("permission-denied", "Rekod Owner tidak menggunakan Staff 2FA.");
  }
  const db = getFirestore();
  const statusRef = db.collection("staff_totp_status").doc(staffId);
  if (enabled) {
    const statusSnap = await statusRef.get();
    if (!statusSnap.exists || !statusSnap.data().enrolled) {
      throw new HttpsError("failed-precondition", "Sediakan (scan QR) 2FA untuk staf ini dahulu sebelum aktifkan.");
    }
  }
  await statusRef.set({ enabled }, { merge: true });
  return { ok: true };
});

exports.resetStaffTotp = onCall({ region: REGION }, async (request) => {
  await assertCallerIsOwner(request);
  const staffId = String((request.data && request.data.staffId) || "").trim();
  if (!staffId) throw new HttpsError("invalid-argument", "staffId diperlukan.");
  const db = getFirestore();
  await db.collection("staff_totp").doc(staffId).delete();
  await db.collection("staff_totp_status").doc(staffId).set({ enrolled: false, enabled: false }, { merge: true });
  return { ok: true };
});

/**
 * Verify staff clock-in/out: TOTP (wajib bila diaktifkan Owner untuk staf ini). Tiada PIN.
 * Called from POS terminal — secret TOTP tidak pernah dihantar balik ke client.
 *
 * Selepas pengesahan identiti (TOTP/geofence), urus roster `pos_active_shift` (siapa
 * sedang bertugas serentak): Cashier terhad SATU orang merentasi seluruh kedai pada satu
 * masa (dikuatkuasa dalam transaction di sini); role lain (cth Kitchen) tiada had bilangan.
 */
// minInstances:1 — function paling kerap dipanggil (setiap clock-in); elak cold-start
// (1-3 saat) supaya clock-in laju konsisten. Kos kecil bulanan berterusan (Blaze plan).
exports.verifyStaffClockIn = onCall({ region: REGION, minInstances: 1 }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Login diperlukan.");
  }

  const { staffId, totpCode, lat, lng, workRole, action } = request.data || {};

  if (!staffId || typeof staffId !== "string") {
    throw new HttpsError("invalid-argument", "staffId diperlukan.");
  }
  const actionStr = action === "clock_out" ? "clock_out" : "clock_in";

  const db = getFirestore();

  try {
    const staffSnap = await db.collection("staff").doc(staffId).get();
    if (!staffSnap.exists) {
      throw new HttpsError("not-found", "Rekod staf tidak dijumpai.");
    }
    const staffData = staffSnap.data();
    const staffName = String(staffData.name || staffData.staffName || "").trim();

    // Owner-sebagai-staf: tak sesekali wajib TOTP/lokasi (walau ada bug di UI/state).
    const isOwnerRecord = staffId === OWNER_STAFF_DOC_ID;

    if (!isOwnerRecord) {
      // Sekatan lokasi (pilihan) — kalau Owner dah tetapkan lokasi kedai, clock-in mesti
      // berada dalam radius. Elak clock-in dari jauh (cth staf minta kawan clock-in-kan dia).
      const storeLocSnap = await db.collection("pos_meta").doc("store_location").get();
      if (storeLocSnap.exists) {
        const loc = storeLocSnap.data();
        if (typeof lat !== "number" || typeof lng !== "number") {
          return { verified: false, error: "Lokasi (GPS) diperlukan untuk clock-in. Benarkan akses lokasi pada peranti anda." };
        }
        const dist = distanceMeters(lat, lng, loc.lat, loc.lng);
        if (dist > loc.radiusMeters) {
          return { verified: false, error: "Anda berada di luar kawasan kedai. Clock-in mesti dibuat di premis." };
        }
      }

      const totpStatusSnap = await db.collection("staff_totp_status").doc(staffId).get();
      const totpEnabled = totpStatusSnap.exists && totpStatusSnap.data().enabled === true;
      if (totpEnabled) {
        const totpRef = db.collection("staff_totp").doc(staffId);
        const totpSnap = await totpRef.get();
        if (!totpSnap.exists || !totpSnap.data().secret) {
          // Status kata enabled tapi secret hilang — anggap gagal (fail-closed), bukan lulus senyap.
          return { verified: false, error: "2FA staf ini bermasalah. Hubungi pemilik." };
        }
        const totpData = totpSnap.data();
        assertNotLocked(totpData);

        const codeStr = typeof totpCode === "string" ? totpCode.trim() : "";
        if (!/^\d{6}$/.test(codeStr) || !authenticator.check(codeStr, totpData.secret)) {
          await totpRef.update(failureUpdatePatch(totpData));
          return { verified: false, error: "Kod 2FA tidak sepadan." };
        }
        await totpRef.update(successUpdatePatch());
      }
    }

    // ── Roster pos_active_shift (siapa sedang bertugas) ──────────────────────
    const shiftRef = db.collection("pos_active_shift").doc(staffId);

    if (actionStr === "clock_out") {
      const shiftSnap = await shiftRef.get();
      // Dok roster tiada (cth dah dipadam lebih awal, double-click race, atau clock-in gagal
      // separuh jalan) — kita TAK tahu role sebenar staf tu. Anggap ia laluan Cashier (client
      // dah tulis staff_activity sendiri utk Cashier), supaya kita elak tulis rekod clock_out
      // pendua/salah-role kalau ini sebenarnya panggilan susulan untuk Cashier yang dah clock-out.
      const roleAtShift = shiftSnap.exists ? String(shiftSnap.data().workRole || "cashier") : null;
      if (shiftSnap.exists) await shiftRef.delete();
      // Laluan Cashier: staff_activity clock_out ditulis client-side (mirrorClockStaffActivity,
      // dengan queue offline) — jangan tulis dua kali di sini. Laluan bukan-cashier (baharu,
      // roster serentak): tulis di server sebab ia tak lalu client-session sedia ada.
      if (roleAtShift && roleAtShift !== "cashier") {
        await db.collection("staff_activity").add({
          staffId,
          staffName,
          kind: "clock_out",
          saleId: "",
          detail: JSON.stringify({ source: "pos_clock_roster", workRole: roleAtShift }),
          subtotal: null,
          orderCount: null,
          workRole: roleAtShift,
          createdAt: FieldValue.serverTimestamp()
        });
      }
      return { verified: true };
    }

    // clock_in
    const role = String(workRole || "").trim().toLowerCase() === "kitchen" ? "kitchen" : "cashier";
    try {
      await db.runTransaction(async (tx) => {
        const mine = await tx.get(shiftRef);
        if (mine.exists) {
          throw new HttpsError("already-exists", "Sudah clock in.");
        }
        if (role === "cashier") {
          const cashierQuery = db.collection("pos_active_shift").where("workRole", "==", "cashier").limit(1);
          const cashierSnap = await tx.get(cashierQuery);
          if (!cashierSnap.empty) {
            const otherName = String(cashierSnap.docs[0].data().staffName || "staf lain");
            throw new HttpsError("failed-precondition", "Cashier sudah bertugas: " + otherName + ". Sila pilih Kitchen.");
          }
        }
        tx.set(shiftRef, {
          staffId,
          staffName,
          workRole: role,
          clockedInAt: FieldValue.serverTimestamp()
        });
      });
    } catch (txErr) {
      if (txErr instanceof HttpsError) {
        return { verified: false, error: txErr.message };
      }
      throw txErr;
    }

    // Laluan bukan-cashier (roster serentak, baharu): tulis staff_activity terus di server
    // (Admin SDK) — tiada session client sedia ada untuk laluan ni. Cashier kekal tulis
    // client-side (tak berubah, kekalkan queue offline sedia ada).
    if (role !== "cashier") {
      await db.collection("staff_activity").add({
        staffId,
        staffName,
        kind: "clock_in",
        saleId: "",
        detail: JSON.stringify({ source: "pos_clock_roster", workRole: role }),
        subtotal: null,
        orderCount: null,
        workRole: role,
        createdAt: FieldValue.serverTimestamp()
      });
    }

    return { verified: true };
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    console.error("[verifyStaffClockIn] error:", err);
    throw new HttpsError("internal", "Ralat semasa semak clock-in.");
  }
});

