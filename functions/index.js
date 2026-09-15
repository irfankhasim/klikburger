const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { authenticator } = require("otplib");

initializeApp();

const REGION = "asia-southeast1";
/** Sementara: clock-in staf tidak disekat GPS. Set false bila nak hidupkan semula. */
const SKIP_CLOCK_IN_GEO = true;
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

function roundMoney(n) {
  const x = typeof n === "number" ? n : parseFloat(n);
  if (!isFinite(x)) return 0;
  return Math.round(x * 100) / 100;
}

function tsToMs(ts) {
  if (!ts) return 0;
  if (typeof ts.toMillis === "function") return ts.toMillis();
  if (ts instanceof Date) return ts.getTime();
  const d = new Date(ts);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

function normalizeWorkRole(workRole, isOwnerRecord) {
  if (isOwnerRecord) return "owner";
  const raw = String(workRole || "").trim().toLowerCase();
  if (raw === "owner") return "owner";
  if (raw === "kitchen") return "kitchen";
  return "cashier";
}

function varianceCategory(variance) {
  if (variance == null || !isFinite(variance)) return "unknown";
  if (Math.abs(variance) < 0.005) return "balanced";
  return variance > 0 ? "over" : "short";
}

function evaluateStoreProximity(storeLocSnap, lat, lng) {
  if (!storeLocSnap || !storeLocSnap.exists) {
    return {
      ok: false,
      errorCode: "location_not_set",
      error: "Login Blocked. Store location is not set. Clock-in is not allowed remotely."
    };
  }
  const loc = storeLocSnap.data() || {};
  if (typeof loc.lat !== "number" || typeof loc.lng !== "number") {
    return {
      ok: false,
      errorCode: "location_not_set",
      error: "Login Blocked. Store location is not set. Clock-in is not allowed remotely."
    };
  }
  const radius =
    typeof loc.radiusMeters === "number" && loc.radiusMeters > 0 ? loc.radiusMeters : 150;
  if (typeof lat !== "number" || typeof lng !== "number") {
    return {
      ok: false,
      errorCode: "gps_required",
      error:
        "Login Blocked. Location is required. Allow location access, move closer to the POS device, and try again."
    };
  }
  const dist = distanceMeters(lat, lng, loc.lat, loc.lng);
  if (dist > radius) {
    return {
      ok: false,
      errorCode: "too_far",
      error:
        "Login Blocked. Your device is too far from the POS terminal. Please move closer to the POS device and try again."
    };
  }
  return { ok: true };
}

async function verifyTotpIfEnabled(db, staffId, totpCode) {
  const totpStatusSnap = await db.collection("staff_totp_status").doc(staffId).get();
  const totpEnabled = totpStatusSnap.exists && totpStatusSnap.data().enabled === true;
  if (!totpEnabled) return { required: false, ok: true };
  const totpRef = db.collection("staff_totp").doc(staffId);
  const totpSnap = await totpRef.get();
  if (!totpSnap.exists || !totpSnap.data().secret) {
    return { required: true, ok: false, error: "2FA staf ini bermasalah. Hubungi pemilik." };
  }
  const totpData = totpSnap.data();
  assertNotLocked(totpData);
  const codeStr = typeof totpCode === "string" ? totpCode.trim() : "";
  if (!/^\d{6}$/.test(codeStr) || !authenticator.check(codeStr, totpData.secret)) {
    await totpRef.update(failureUpdatePatch(totpData));
    return { required: true, ok: false, error: "Kod 2FA tidak sepadan." };
  }
  await totpRef.update(successUpdatePatch());
  return { required: true, ok: true };
}

function staffActivityDoc(p) {
  const extra = p.extra || {};
  const workRole = p.workRole || "cashier";
  const exclude =
    workRole === "owner" || !!extra.testingSession || !!extra.excludeFromStaffReport;
  const detailObj = Object.assign({ source: p.source || "server", workRole: workRole }, extra);
  if (exclude) detailObj.excludeFromStaffReport = true;
  if (workRole === "owner") detailObj.ownerSession = true;
  if (extra.testingSession) {
    detailObj.testingSession = true;
    detailObj.sessionLabel = "Owner Testing Session";
  }
  const doc = {
    staffId: p.staffId,
    staffName: p.staffName || "",
    kind: p.kind,
    saleId: "",
    detail: JSON.stringify(detailObj),
    subtotal: null,
    orderCount: null,
    workRole: workRole,
    excludeFromStaffReport: exclude,
    testingSession: !!extra.testingSession,
    createdAt: extra.atMs ? Timestamp.fromMillis(extra.atMs) : FieldValue.serverTimestamp()
  };
  return doc;
}

async function writeAttendanceAudit(db, payload) {
  await db.collection("attendance_audit").add({
    actorUid: payload.actorUid || "",
    actorName: payload.actorName || "Owner",
    actorRole: "owner",
    staffId: payload.staffId || "",
    staffName: payload.staffName || "",
    action: payload.action || "",
    reason: String(payload.reason || "").trim(),
    changes: payload.changes || {},
    createdAt: FieldValue.serverTimestamp()
  });
  await db.collection("pos_audit_logs").add({
    type: "attendance_" + String(payload.action || "manage"),
    message: payload.message || payload.action || "attendance",
    userId: payload.actorUid || "",
    userName: payload.actorName || "Owner",
    role: "owner",
    meta: {
      staffId: payload.staffId || "",
      staffName: payload.staffName || "",
      reason: String(payload.reason || "").trim(),
      changes: payload.changes || {}
    },
    createdAt: FieldValue.serverTimestamp()
  });
}

async function computeOpenDrawerSnapshot(db) {
  const cSnap = await db.collection("pos_meta").doc("counters").get();
  const activeId =
    cSnap.exists && cSnap.data().activeShiftDocId ? String(cSnap.data().activeShiftDocId) : "";
  if (!activeId) return { isOpen: false };
  const sSnap = await db.collection("pos_shifts").doc(activeId).get();
  if (!sSnap.exists || String(sSnap.data().status || "") !== "open") {
    return { isOpen: false, shiftId: activeId };
  }
  const sd = sSnap.data() || {};
  const openingCash = roundMoney(sd.openingCash);
  let movementsNet = 0;
  const movSnap = await db.collection("pos_shifts").doc(activeId).collection("cash_movements").get();
  movSnap.forEach((d) => {
    const x = d.data() || {};
    const a = roundMoney(x.amount);
    movementsNet += x.type === "out" ? -a : a;
  });
  const openedMs = tsToMs(sd.openedAt);
  let cashSales = 0;
  try {
    const recSnap = await db.collection("pos_receipts").orderBy("createdAt", "desc").limit(500).get();
    recSnap.forEach((d) => {
      const x = d.data() || {};
      if (x.voided || x.isVoided) return;
      const ct = tsToMs(x.createdAt);
      if (openedMs && ct && ct < openedMs) return;
      const pm = String(x.paymentMethod || "cash").toLowerCase();
      if (pm !== "cash" && pm !== "tunai") return;
      cashSales += typeof x.subtotal === "number" ? x.subtotal : parseFloat(x.subtotal) || 0;
    });
  } catch (e) {
    console.warn("[drawer] receipt scan:", e && e.message ? e.message : e);
  }
  cashSales = roundMoney(cashSales);
  const expectedCash = roundMoney(openingCash + cashSales + movementsNet);
  return {
    isOpen: true,
    shiftId: activeId,
    shiftCode: String(sd.shiftCode || activeId),
    openingCash,
    cashSales,
    movementsNet: roundMoney(movementsNet),
    expectedCash,
    actualCash: null,
    difference: null,
    differenceStatus: "pending"
  };
}

async function closeOpenDrawerAdmin(db, actualCash, actor) {
  const snap = await computeOpenDrawerSnapshot(db);
  if (!snap.isOpen) return { ok: true, skipped: true, drawer: snap };
  if (actualCash == null || actualCash === "" || !isFinite(Number(actualCash))) {
    throw new HttpsError("invalid-argument", "Masukkan jumlah tunai sebenar dalam laci.");
  }
  const actual = roundMoney(actualCash);
  const expected = snap.expectedCash;
  const variance = roundMoney(actual - expected);
  const closing = {
    shiftId: snap.shiftCode,
    closedAt: new Date().toISOString(),
    expectedDrawer: expected,
    actualDrawer: actual,
    variance,
    varianceCategory: varianceCategory(variance),
    cashDifference: variance,
    amountToBePaid: variance < 0 ? roundMoney(Math.abs(variance)) : 0,
    paymentStatus: variance < 0 ? "unpaid" : "not_applicable",
    cashSales: snap.cashSales,
    closedWithOwnerBypass: true,
    closedOnBehalf: true
  };
  const sid = snap.shiftId;
  await db.runTransaction(async (tx) => {
    const cref = db.collection("pos_meta").doc("counters");
    const tcs = await tx.get(cref);
    const active = tcs.exists && tcs.data().activeShiftDocId ? String(tcs.data().activeShiftDocId) : "";
    if (active !== sid) {
      throw new HttpsError("failed-precondition", "Drawer tidak sepadan.");
    }
    tx.update(db.collection("pos_shifts").doc(sid), {
      status: "closed",
      closedAt: FieldValue.serverTimestamp(),
      closing,
      updatedAt: FieldValue.serverTimestamp()
    });
    tx.set(cref, { activeShiftDocId: null, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });
  await db.collection("pos_audit_logs").add({
    type: "shift_close",
    message: "Drawer ditutup oleh Owner bagi pihak staf",
    userId: (actor && actor.uid) || "",
    userName: (actor && actor.name) || "Owner",
    role: "owner",
    meta: { variance, expected, actual, onBehalf: true },
    createdAt: FieldValue.serverTimestamp()
  });
  return {
    ok: true,
    closing,
    drawer: Object.assign({}, snap, {
      isOpen: false,
      actualCash: actual,
      difference: variance,
      differenceStatus: varianceCategory(variance)
    })
  };
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
// Staff 2FA — clock-in, togol per-staf, diurus oleh Owner dari Staff Management.
// Owner (owner_01) juga boleh enroll authenticator; jika enabled, clock in/out wajib 2FA.
// ============================================================================

exports.enrollStaffTotp = onCall({ region: REGION }, async (request) => {
  await assertCallerIsOwner(request);
  const staffId = String((request.data && request.data.staffId) || "").trim();
  if (!staffId) throw new HttpsError("invalid-argument", "staffId diperlukan.");
  try {
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
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    console.error("enrollStaffTotp", e);
    throw new HttpsError(
      "internal",
      e && e.message ? String(e.message) : "Gagal jana 2FA."
    );
  }
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
 * Verify staff clock-in/out: TOTP (wajib bila diaktifkan untuk rekod staf ini, termasuk Owner).
 * Cashier uniqueness dikuatkuasa dalam transaction. Owner workRole "owner" tidak ambil slot Cashier.
 */
exports.verifyStaffClockIn = onCall({ region: REGION, minInstances: 1 }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Login diperlukan.");
  }

  const { staffId, totpCode, lat, lng, workRole, action, testingSession } = request.data || {};

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
    const isOwnerRecord =
      staffId === OWNER_STAFF_DOC_ID ||
      !!staffData.isOwner ||
      String(staffData.role || "").toLowerCase() === "owner";

    if (!SKIP_CLOCK_IN_GEO && actionStr === "clock_in" && !isOwnerRecord) {
      const storeLocSnap = await db.collection("pos_meta").doc("store_location").get();
      const geo = evaluateStoreProximity(storeLocSnap, lat, lng);
      if (!geo.ok) {
        return { verified: false, errorCode: geo.errorCode, error: geo.error };
      }
    }

    const totp = await verifyTotpIfEnabled(db, staffId, totpCode);
    if (!totp.ok) return { verified: false, error: totp.error };

    const shiftRef = db.collection("pos_active_shift").doc(staffId);

    if (actionStr === "clock_out") {
      const shiftSnap = await shiftRef.get();
      const roleAtShift = shiftSnap.exists
        ? String(shiftSnap.data().workRole || (isOwnerRecord ? "owner" : "cashier"))
        : null;
      const testingAtShift = !!(
        testingSession ||
        (shiftSnap.exists && shiftSnap.data().testingSession)
      );
      if (shiftSnap.exists) await shiftRef.delete();
      if (roleAtShift && roleAtShift !== "cashier") {
        await db.collection("staff_activity").add(
          staffActivityDoc({
            staffId,
            staffName,
            kind: "clock_out",
            workRole: roleAtShift,
            source: "pos_clock_roster",
            extra: { testingSession: testingAtShift }
          })
        );
      }
      return { verified: true, workRole: roleAtShift || (isOwnerRecord ? "owner" : "cashier") };
    }

    const role = normalizeWorkRole(workRole, isOwnerRecord);
    let alreadyActive = false;
    let activeRole = role;
    let cashierTakenBy = "";
    try {
      await db.runTransaction(async (tx) => {
        const mine = await tx.get(shiftRef);
        if (mine.exists) {
          alreadyActive = true;
          activeRole = String(mine.data().workRole || role);
          return;
        }
        if (role === "cashier") {
          const cashierQuery = db.collection("pos_active_shift").where("workRole", "==", "cashier").limit(1);
          const cashierSnap = await tx.get(cashierQuery);
          if (!cashierSnap.empty) {
            const other = cashierSnap.docs[0];
            if (other.id === staffId) {
              alreadyActive = true;
              activeRole = "cashier";
              return;
            }
            cashierTakenBy = String(other.data().staffName || "staf lain");
            return;
          }
        }
        tx.set(shiftRef, {
          staffId,
          staffName,
          workRole: role,
          testingSession: !!testingSession,
          clockedInAt: FieldValue.serverTimestamp()
        });
      });
    } catch (txErr) {
      console.error("[verifyStaffClockIn] transaction:", txErr);
      throw new HttpsError("internal", "Ralat semasa semak clock-in.");
    }

    if (cashierTakenBy) {
      return {
        verified: false,
        error: "Cashier sudah bertugas: " + cashierTakenBy + ". Sila pilih Kitchen."
      };
    }

    if (alreadyActive) {
      return { verified: true, alreadyActive: true, workRole: activeRole };
    }

    if (role !== "cashier") {
      await db.collection("staff_activity").add(
        staffActivityDoc({
          staffId,
          staffName,
          kind: "clock_in",
          workRole: role,
          source: "pos_clock_roster",
          extra: { testingSession: !!testingSession }
        })
      );
    }

    return { verified: true, workRole: role };
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    console.error("[verifyStaffClockIn] error:", err);
    throw new HttpsError("internal", "Ralat semasa semak clock-in.");
  }
});

exports.getCashDrawerStatus = onCall({ region: REGION }, async (request) => {
  await assertCallerIsOwner(request);
  const db = getFirestore();
  const drawer = await computeOpenDrawerSnapshot(db);
  return { ok: true, drawer };
});

/**
 * Owner memaksa clock-out. Jika drawer masih terbuka, mesti closeDrawer + actualCash.
 */
exports.forceStaffClockOut = onCall({ region: REGION }, async (request) => {
  const actorUid = await assertCallerIsOwner(request);
  const data = request.data || {};
  const staffId = data.staffId;
  if (!staffId || typeof staffId !== "string") {
    throw new HttpsError("invalid-argument", "staffId diperlukan.");
  }
  const reason = String(data.reason || "").trim();
  const db = getFirestore();
  const shiftRef = db.collection("pos_active_shift").doc(staffId);
  const shiftSnap = await shiftRef.get();
  let staffName = "";
  let workRole = "cashier";
  if (shiftSnap.exists) {
    const d = shiftSnap.data() || {};
    staffName = String(d.staffName || "").trim();
    workRole = String(d.workRole || "cashier").trim().toLowerCase() || "cashier";
  }
  const drawer = await computeOpenDrawerSnapshot(db);
  const cashierHoldsDrawer = drawer.isOpen && workRole === "cashier";

  if (cashierHoldsDrawer && !data.closeDrawer) {
    return {
      ok: false,
      verified: false,
      needsDrawerClose: true,
      drawer,
      error: "Drawer masih terbuka. Tutup drawer bagi pihak staf dan masukkan jumlah tunai sebenar."
    };
  }

  let closing = null;
  if (cashierHoldsDrawer && data.closeDrawer) {
    const closed = await closeOpenDrawerAdmin(db, data.actualCash, { uid: actorUid, name: "Owner" });
    closing = closed.closing || null;
  }

  if (shiftSnap.exists) {
    await shiftRef.delete();
  }

  if (!staffName) {
    const staffSnap = await db.collection("staff").doc(staffId).get();
    if (staffSnap.exists) {
      const sd = staffSnap.data() || {};
      staffName = String(sd.name || sd.staffName || "").trim();
    }
  }

  await db.collection("staff_activity").add(
    staffActivityDoc({
      staffId,
      staffName,
      kind: "clock_out",
      workRole,
      source: "owner_force_clock_out",
      extra: { reason: reason, ownerManual: true }
    })
  );

  await writeAttendanceAudit(db, {
    actorUid,
    staffId,
    staffName,
    action: "force_clock_out",
    reason: reason,
    message: "Owner manual clock out",
    changes: {
      workRole,
      closedDrawer: !!closing,
      variance: closing ? closing.variance : null
    }
  });

  return { ok: true, verified: true, staffId, workRole, closing, drawerClosed: !!closing };
});

exports.manageStaffAttendance = onCall({ region: REGION }, async (request) => {
  const actorUid = await assertCallerIsOwner(request);
  const data = request.data || {};
  const action = String(data.action || "").trim();
  const staffId = String(data.staffId || "").trim();
  const reason = String(data.reason || "").trim();
  if (!staffId) throw new HttpsError("invalid-argument", "staffId diperlukan.");
  if (!reason) throw new HttpsError("invalid-argument", "Sebab / nota diperlukan untuk audit.");
  if (!action) throw new HttpsError("invalid-argument", "action diperlukan.");

  const db = getFirestore();
  const staffSnap = await db.collection("staff").doc(staffId).get();
  if (!staffSnap.exists) throw new HttpsError("not-found", "Rekod staf tidak dijumpai.");
  const sd = staffSnap.data() || {};
  const staffName = String(sd.name || sd.staffName || "").trim();
  const isOwnerRecord =
    staffId === OWNER_STAFF_DOC_ID || !!sd.isOwner || String(sd.role || "").toLowerCase() === "owner";

  if (action === "release_slot") {
    const shiftRef = db.collection("pos_active_shift").doc(staffId);
    const shiftSnap = await shiftRef.get();
    const workRole = shiftSnap.exists ? String(shiftSnap.data().workRole || "") : "";
    if (shiftSnap.exists) await shiftRef.delete();
    await writeAttendanceAudit(db, {
      actorUid,
      staffId,
      staffName,
      action: "release_slot",
      reason,
      message: "Owner release stuck role/session",
      changes: { workRole, hadActive: shiftSnap.exists }
    });
    return { ok: true, released: shiftSnap.exists, workRole };
  }

  if (action === "manual_clock_in") {
    const role = normalizeWorkRole(data.workRole, isOwnerRecord);
    const shiftRef = db.collection("pos_active_shift").doc(staffId);
    let cashierTakenBy = "";
    await db.runTransaction(async (tx) => {
      const mine = await tx.get(shiftRef);
      if (mine.exists) return;
      if (role === "cashier") {
        const cashierSnap = await tx.get(
          db.collection("pos_active_shift").where("workRole", "==", "cashier").limit(1)
        );
        if (!cashierSnap.empty && cashierSnap.docs[0].id !== staffId) {
          cashierTakenBy = String(cashierSnap.docs[0].data().staffName || "staf lain");
          return;
        }
      }
      tx.set(shiftRef, {
        staffId,
        staffName,
        workRole: role,
        clockedInAt: FieldValue.serverTimestamp(),
        ownerManual: true
      });
    });
    if (cashierTakenBy) {
      throw new HttpsError(
        "failed-precondition",
        "Cashier sudah bertugas: " + cashierTakenBy + ". Lepaskan slot dahulu."
      );
    }
    const atMs = typeof data.clockInAtMs === "number" ? data.clockInAtMs : Date.now();
    await db.collection("staff_activity").add(
      staffActivityDoc({
        staffId,
        staffName,
        kind: "clock_in",
        workRole: role,
        source: "owner_manual_clock_in",
        extra: { atMs, ownerManual: true, reason }
      })
    );
    await writeAttendanceAudit(db, {
      actorUid,
      staffId,
      staffName,
      action: "manual_clock_in",
      reason,
      message: "Owner manual clock in",
      changes: { workRole: role, clockInAtMs: atMs }
    });
    return { ok: true, workRole: role };
  }

  if (action === "manual_clock_out") {
    const shiftRef = db.collection("pos_active_shift").doc(staffId);
    const shiftSnap = await shiftRef.get();
    const workRole = shiftSnap.exists
      ? String(shiftSnap.data().workRole || "cashier")
      : String(data.workRole || "cashier");
    const drawer = await computeOpenDrawerSnapshot(db);
    const cashierHoldsDrawer = drawer.isOpen && workRole === "cashier";
    if (cashierHoldsDrawer && !data.closeDrawer) {
      return {
        ok: false,
        needsDrawerClose: true,
        drawer,
        error: "Drawer masih terbuka. Tutup drawer bagi pihak staf dahulu."
      };
    }
    let closing = null;
    if (cashierHoldsDrawer && data.closeDrawer) {
      const closed = await closeOpenDrawerAdmin(db, data.actualCash, { uid: actorUid, name: "Owner" });
      closing = closed.closing || null;
    }
    if (shiftSnap.exists) await shiftRef.delete();
    const atMs = typeof data.clockOutAtMs === "number" ? data.clockOutAtMs : Date.now();
    await db.collection("staff_activity").add(
      staffActivityDoc({
        staffId,
        staffName,
        kind: "clock_out",
        workRole,
        source: "owner_manual_clock_out",
        extra: { atMs, ownerManual: true, reason }
      })
    );
    await writeAttendanceAudit(db, {
      actorUid,
      staffId,
      staffName,
      action: "manual_clock_out",
      reason,
      message: "Owner manual clock out",
      changes: { workRole, clockOutAtMs: atMs, closedDrawer: !!closing }
    });
    return { ok: true, workRole, closing };
  }

  if (action === "edit_session") {
    const inId = String(data.clockInDocId || "").trim();
    const outId = String(data.clockOutDocId || "").trim();
    const changes = {};
    if (inId && typeof data.clockInAtMs === "number") {
      await db.collection("staff_activity").doc(inId).update({
        createdAt: Timestamp.fromMillis(data.clockInAtMs),
        editedByOwner: true,
        updatedAt: FieldValue.serverTimestamp()
      });
      changes.clockInAtMs = data.clockInAtMs;
      changes.clockInDocId = inId;
    }
    if (outId && typeof data.clockOutAtMs === "number") {
      await db.collection("staff_activity").doc(outId).update({
        createdAt: Timestamp.fromMillis(data.clockOutAtMs),
        editedByOwner: true,
        updatedAt: FieldValue.serverTimestamp()
      });
      changes.clockOutAtMs = data.clockOutAtMs;
      changes.clockOutDocId = outId;
    }
    if (!Object.keys(changes).length) {
      throw new HttpsError("invalid-argument", "Tiada masa untuk dikemaskini.");
    }
    await writeAttendanceAudit(db, {
      actorUid,
      staffId,
      staffName,
      action: "edit_session",
      reason,
      message: "Owner edit clock in/out times",
      changes
    });
    return { ok: true, changes };
  }

  throw new HttpsError("invalid-argument", "action tidak dikenali.");
});

