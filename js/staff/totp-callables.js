/**
 * Wrapper Cloud Functions callable untuk 2FA (TOTP) clock-in Staff.
 * Enrollment/confirm cuba CF dulu; jika CF gagal cold-start (billing/internal),
 * Owner tulis secret/status terus ke Firestore. Secret tetap tak boleh dibaca klien.
 */
import { functions, httpsCallable, db, doc, setDoc, deleteDoc, getDoc, collection, query, where, getDocs, addDoc, serverTimestamp } from "../firebase/init.js";
import { generateTotpSecret, totpOtpauthUrl, verifyTotpCode } from "./totp-local.js";
import { OWNER_STAFF_DOC_ID } from "./staff-mappers.js";
import { markThisDeviceAsPosTerminal, clearPosTerminalMark, judgeProximity, SKIP_CLOCK_IN_GEO } from "./pos-terminal-trust.js";

var fnCache = {};

function callable(name, opts) {
  var key = name + (opts && opts.timeout ? ":" + opts.timeout : "");
  if (!fnCache[key]) {
    fnCache[key] = opts ? httpsCallable(functions, name, opts) : httpsCallable(functions, name);
  }
  return fnCache[key];
}

function unwrap(res) {
  var data = res && res.data;
  if (!data || typeof data !== "object") {
    return { ok: false, verified: false, error: "Respons tidak sah." };
  }
  return data;
}

// ─── Staff (clock-in) ───────────────────────────────────────────────────────

/**
 * @param {{ lat: number, lng: number }|null} coords — GPS semasa, kalau ada (untuk sekatan lokasi kedai)
 * @param {{ workRole?: string, action?: "clock_in"|"clock_out" }} [opts] — workRole diperlukan untuk
 *   action:"clock_in" (default) supaya server urus roster pos_active_shift (had 1 Cashier serentak).
 * @returns {Promise<{ verified: boolean, error?: string }>}
 */
/** Owner memaksa clock-out sesi aktif (tanpa 2FA staf). */
export async function forceStaffClockOut(staffId, opts) {
  try {
    var payload = { staffId: String(staffId || "") };
    if (opts && typeof opts === "object") {
      if (opts.reason) payload.reason = String(opts.reason);
      if (opts.closeDrawer) payload.closeDrawer = true;
      if (opts.actualCash != null) payload.actualCash = Number(opts.actualCash);
    }
    var res = await callable("forceStaffClockOut")(payload);
    return unwrap(res);
  } catch (err) {
    var msg = err && err.message ? String(err.message) : "";
    if (err && err.details && typeof err.details === "object" && err.details.error) {
      msg = String(err.details.error);
    }
    return { ok: false, verified: false, error: msg || "Tidak dapat clock out staf ini." };
  }
}

export async function getCashDrawerStatus() {
  try {
    var res = await callable("getCashDrawerStatus")({});
    return unwrap(res);
  } catch (err) {
    return { ok: false, error: err && err.message ? String(err.message) : "Tidak dapat semak drawer." };
  }
}

export async function manageStaffAttendance(payload) {
  try {
    var res = await callable("manageStaffAttendance")(payload || {});
    return unwrap(res);
  } catch (err) {
    var msg = err && err.message ? String(err.message) : "";
    if (err && err.details && typeof err.details === "object" && err.details.error) {
      msg = String(err.details.error);
    }
    return { ok: false, error: msg || "Tidak dapat kemaskini kehadiran." };
  }
}

function proximityFromStoreLoc(loc, coords) {
  if (!loc || !isFinite(Number(loc.lat)) || !isFinite(Number(loc.lng))) {
    return { ok: false, errorCode: "location_not_set", error: "Lokasi kedai belum ditetapkan." };
  }
  var judged = judgeProximity(
    Number(loc.lat),
    Number(loc.lng),
    Number(loc.radiusMeters) || 150,
    coords,
    !!(coords && coords.trustedPos)
  );
  if (!judged.ok) {
    return { ok: false, errorCode: judged.errorCode, error: judged.errorCode };
  }
  return { ok: true };
}

async function verifyStaffClockInFallback(staffId, totpCode, coords, opts) {
  var id = String(staffId || "").trim();
  var actionStr = opts && opts.action === "clock_out" ? "clock_out" : "clock_in";
  var staffSnap = await getDoc(doc(db, "staff", id));
  if (!staffSnap.exists()) {
    return { verified: false, error: "Rekod staf tidak dijumpai." };
  }
  var staffData = staffSnap.data() || {};
  var staffName = String(staffData.name || staffData.staffName || "").trim();
  var isOwnerRecord =
    id === OWNER_STAFF_DOC_ID ||
    !!staffData.isOwner ||
    String(staffData.role || "").toLowerCase() === "owner";

  if (!SKIP_CLOCK_IN_GEO && actionStr === "clock_in" && !isOwnerRecord) {
    var locSnap = await getDoc(doc(db, "pos_meta", "store_location"));
    var loc = locSnap.exists() ? locSnap.data() : null;
    if (loc) {
      loc.lat = Number(loc.lat);
      loc.lng = Number(loc.lng);
      loc.radiusMeters = Number(loc.radiusMeters);
    }
    var geo = proximityFromStoreLoc(loc, coords);
    if (!geo.ok) return { verified: false, errorCode: geo.errorCode, error: geo.error };
  }

  var statusSnap = await getDoc(doc(db, "staff_totp_status", id));
  var totpEnabled = statusSnap.exists() && statusSnap.data().enabled === true;
  if (totpEnabled) {
    var totpSnap;
    try {
      totpSnap = await getDoc(doc(db, "staff_totp", id));
    } catch (readErr) {
      return {
        verified: false,
        errorCode: "totp_unreadable",
        error: "Tidak dapat baca secret 2FA. Sila log masuk semula sebagai owner."
      };
    }
    var secret = totpSnap.exists() ? String(totpSnap.data().secret || totpSnap.data().secretBase32 || "").trim() : "";
    if (!secret) {
      return { verified: false, errorCode: "totp_missing", error: "2FA staf ini bermasalah. Hubungi pemilik." };
    }
    var totpOk = false;
    try {
      totpOk = await verifyTotpCode(secret, totpCode, 2);
    } catch (verErr) {
      console.error("[clock-in] verifyTotpCode:", verErr);
      return { verified: false, errorCode: "totp_error", error: "Tidak dapat semak kod 2FA pada peranti ini." };
    }
    if (!totpOk) return { verified: false, errorCode: "totp_mismatch", error: "Kod 2FA tidak sepadan." };
  }

  var shiftRef = doc(db, "pos_active_shift", id);
  if (actionStr === "clock_out") {
    var outSnap = await getDoc(shiftRef);
    var roleAtShift = outSnap.exists()
      ? String(outSnap.data().workRole || (isOwnerRecord ? "owner" : "cashier"))
      : isOwnerRecord
        ? "owner"
        : "cashier";
    if (outSnap.exists()) await deleteDoc(shiftRef).catch(function () {});
    return { verified: true, workRole: roleAtShift };
  }

  var role = isOwnerRecord ? "owner" : String((opts && opts.workRole) || "cashier").toLowerCase();
  if (role !== "kitchen") role = isOwnerRecord ? "owner" : role === "owner" ? "cashier" : role;
  if (!isOwnerRecord && role !== "kitchen") role = "cashier";
  if (isOwnerRecord) role = "owner";

  var mine = await getDoc(shiftRef);
  if (mine.exists()) {
    return { verified: true, alreadyActive: true, workRole: String(mine.data().workRole || role) };
  }
  if (role === "cashier") {
    try {
      var cashierSnap = await getDocs(query(collection(db, "pos_active_shift"), where("workRole", "==", "cashier")));
      if (!cashierSnap.empty) {
        var other = cashierSnap.docs[0];
        if (other.id !== id) {
          return {
            verified: false,
            errorCode: "cashier_taken",
            error: "Cashier sudah bertugas: " + String(other.data().staffName || "staf lain") + ". Sila pilih Kitchen."
          };
        }
      }
    } catch (qErr) {
      console.warn("[clock-in] cashier slot query:", qErr);
    }
  }
  try {
    await setDoc(shiftRef, {
      staffId: id,
      staffName: staffName,
      workRole: role,
      testingSession: !!(opts && opts.testingSession),
      clockedInAt: serverTimestamp()
    });
  } catch (writeErr) {
    console.error("[clock-in] pos_active_shift write:", writeErr);
    return {
      verified: false,
      errorCode: "shift_write",
      error: writeErr && writeErr.message ? String(writeErr.message) : "Tidak dapat simpan clock in."
    };
  }
  if (role !== "cashier") {
    await addDoc(collection(db, "staff_activity"), {
      staffId: id,
      staffName: staffName,
      kind: "clock_in",
      saleId: "",
      detail: JSON.stringify({ source: "client_fallback", workRole: role }),
      workRole: role,
      excludeFromStaffReport: role === "owner" || !!(opts && opts.testingSession),
      testingSession: !!(opts && opts.testingSession),
      createdAt: serverTimestamp()
    }).catch(function () {});
  }
  return { verified: true, workRole: role };
}

function callVerifyStaffClockInCf(payload) {
  return new Promise(function (resolve, reject) {
    var done = false;
    var t = setTimeout(function () {
      if (done) return;
      done = true;
      var err = new Error("functions/unavailable");
      err.code = "functions/unavailable";
      reject(err);
    }, 4000);
    callable("verifyStaffClockIn", { timeout: 4000 })(payload).then(
      function (res) {
        if (done) return;
        done = true;
        clearTimeout(t);
        resolve(res);
      },
      function (err) {
        if (done) return;
        done = true;
        clearTimeout(t);
        reject(err);
      }
    );
  });
}

export async function verifyStaffClockIn(staffId, totpCode, coords, opts) {
  var payload = {
    staffId: String(staffId || ""),
    totpCode: totpCode != null ? String(totpCode) : ""
  };
  if (coords && typeof coords.lat === "number" && typeof coords.lng === "number") {
    payload.lat = coords.lat;
    payload.lng = coords.lng;
  }
  if (coords && coords.trustedPos) payload.trustedPos = true;
  if (opts && opts.workRole) payload.workRole = String(opts.workRole);
  if (opts && opts.action) payload.action = String(opts.action);
  if (opts && opts.testingSession) payload.testingSession = true;

  try {
    return await verifyStaffClockInFallback(staffId, totpCode, coords, opts);
  } catch (e2) {
    var perm = /permission-denied|PERMISSION_DENIED/i.test(
      String((e2 && e2.code) || "") + " " + String((e2 && e2.message) || "")
    );
    if (!perm) {
      console.error("[clock-in] fallback gagal:", e2);
      return {
        verified: false,
        error: e2 && e2.message ? String(e2.message) : "Tidak dapat sahkan clock in."
      };
    }
    console.warn("[clock-in] fallback tiada permission, cuba CF:", e2);
  }

  try {
    var res = await callVerifyStaffClockInCf(payload);
    var data = unwrap(res);
    if (data && data.verified === true) return data;
    if (data && data.verified === false) return data;
  } catch (err) {
    if (!isCfUnavailable(err)) {
      var msg = err && err.message ? String(err.message) : "";
      if (err && err.details && typeof err.details === "object" && err.details.error) {
        msg = String(err.details.error);
      }
      return { verified: false, error: msg || "Tidak dapat sahkan clock in." };
    }
  }
  return { verified: false, error: "Tidak dapat sahkan clock in." };
}

// ─── Lokasi kedai (sekatan geo clock-in) ────────────────────────────────────

export async function setStoreLocation(lat, lng, radiusMeters) {
  var latN = Number(lat);
  var lngN = Number(lng);
  var radius = radiusMeters != null && Number(radiusMeters) > 0 ? Number(radiusMeters) : 150;
  try {
    var res = await callable("setStoreLocation")({
      lat: latN,
      lng: lngN,
      radiusMeters: radius
    });
    var data = unwrap(res);
    if (data && data.ok !== false) {
      markThisDeviceAsPosTerminal(latN, lngN);
      return data;
    }
  } catch (err) {
    if (!isCfUnavailable(err)) throw err;
    console.warn("[store] setStoreLocation CF gagal, guna fallback tempatan:", err);
  }
  await setDoc(doc(db, "pos_meta", "store_location"), {
    lat: latN,
    lng: lngN,
    radiusMeters: radius,
    updatedAt: serverTimestamp()
  });
  markThisDeviceAsPosTerminal(latN, lngN);
  return { ok: true };
}

export async function clearStoreLocation() {
  try {
    var res = await callable("clearStoreLocation")({});
    var data = unwrap(res);
    if (data && data.ok !== false) {
      clearPosTerminalMark();
      return data;
    }
  } catch (err) {
    if (!isCfUnavailable(err)) throw err;
    console.warn("[store] clearStoreLocation CF gagal, guna fallback tempatan:", err);
  }
  await deleteDoc(doc(db, "pos_meta", "store_location")).catch(function () {});
  clearPosTerminalMark();
  return { ok: true };
}

function isCfUnavailable(err) {
  var code = err && err.code ? String(err.code) : "";
  var msg = err && err.message ? String(err.message).toLowerCase() : "";
  return (
    code === "functions/internal" ||
    code === "internal" ||
    code === "functions/unavailable" ||
    code === "functions/deadline-exceeded" ||
    code === "deadline-exceeded" ||
    msg.indexOf("internal") !== -1 ||
    msg.indexOf("billing") !== -1 ||
    msg.indexOf("deadline") !== -1 ||
    msg.indexOf("403") !== -1
  );
}

var pendingEnrollSecret = "";

/** @returns {Promise<{ secret: string, otpauthUrl: string }>} */
export async function enrollStaffTotp(staffId) {
  var id = String(staffId || "").trim();
  try {
    var res = await callable("enrollStaffTotp")({ staffId: id });
    var data = unwrap(res);
    if (data && data.secret && data.otpauthUrl) {
      pendingEnrollSecret = data.secret;
      return data;
    }
  } catch (err) {
    if (!isCfUnavailable(err)) throw err;
    console.warn("[totp] enrollStaffTotp CF gagal, guna fallback tempatan:", err);
  }
  var secret = generateTotpSecret();
  var otpauthUrl = totpOtpauthUrl(id, "Tab Kaunter", secret);
  await setDoc(
    doc(db, "staff_totp", id),
    {
      secret: secret,
      failedAttempts: 0,
      lockedUntil: null,
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );
  pendingEnrollSecret = secret;
  return { secret: secret, otpauthUrl: otpauthUrl };
}

export async function confirmStaffTotpEnrollment(staffId, code) {
  var id = String(staffId || "").trim();
  var codeStr = String(code || "");
  try {
    var res = await callable("confirmStaffTotpEnrollment")({
      staffId: id,
      code: codeStr
    });
    var data = unwrap(res);
    if (data && data.ok === true) return data;
  } catch (err) {
    if (!isCfUnavailable(err)) throw err;
    console.warn("[totp] confirmStaffTotpEnrollment CF gagal, guna fallback tempatan:", err);
  }
  var secretForCheck = pendingEnrollSecret;
  if (!secretForCheck) {
    var snap = await getDoc(doc(db, "staff_totp", id));
    secretForCheck = snap.exists() ? String(snap.data().secret || "") : "";
  }
  var ok = await verifyTotpCode(secretForCheck, codeStr, 2);
  if (!ok) {
    var e = new Error("Kod tidak sepadan.");
    throw e;
  }
  await setDoc(
    doc(db, "staff_totp_status", id),
    {
      enrolled: true,
      enabled: true,
      enrolledAt: serverTimestamp()
    },
    { merge: true }
  );
  return { ok: true };
}

export async function setStaffTotpEnabled(staffId, enabled) {
  var id = String(staffId || "");
  try {
    var res = await callable("setStaffTotpEnabled")({
      staffId: id,
      enabled: !!enabled
    });
    return unwrap(res);
  } catch (err) {
    if (!isCfUnavailable(err)) throw err;
  }
  await setDoc(doc(db, "staff_totp_status", id), { enabled: !!enabled }, { merge: true });
  return { ok: true };
}

export async function resetStaffTotp(staffId) {
  var id = String(staffId || "");
  try {
    var res = await callable("resetStaffTotp")({ staffId: id });
    return unwrap(res);
  } catch (err) {
    if (!isCfUnavailable(err)) throw err;
  }
  await deleteDoc(doc(db, "staff_totp", id)).catch(function () {});
  await setDoc(
    doc(db, "staff_totp_status", id),
    { enrolled: false, enabled: false },
    { merge: true }
  );
  pendingEnrollSecret = "";
  return { ok: true };
}
