/**
 * Wrapper Cloud Functions callable untuk 2FA (TOTP) clock-in Staff.
 * Secret TOTP tidak pernah dibaca terus dari Firestore klien; semua semakan/enrollment
 * lalu Cloud Function (Admin SDK). Owner tidak tertakluk 2FA — tiada wrapper untuk Owner di sini.
 */
import { functions, httpsCallable } from "../firebase/init.js";

var fnCache = {};

function callable(name) {
  if (!fnCache[name]) {
    fnCache[name] = httpsCallable(functions, name);
  }
  return fnCache[name];
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
export async function verifyStaffClockIn(staffId, totpCode, coords, opts) {
  var payload = {
    staffId: String(staffId || ""),
    totpCode: totpCode != null ? String(totpCode) : ""
  };
  if (coords && typeof coords.lat === "number" && typeof coords.lng === "number") {
    payload.lat = coords.lat;
    payload.lng = coords.lng;
  }
  if (opts && opts.workRole) payload.workRole = String(opts.workRole);
  if (opts && opts.action) payload.action = String(opts.action);
  var res = await callable("verifyStaffClockIn")(payload);
  return unwrap(res);
}

// ─── Lokasi kedai (sekatan geo clock-in) ────────────────────────────────────

export async function setStoreLocation(lat, lng, radiusMeters) {
  var res = await callable("setStoreLocation")({
    lat: Number(lat),
    lng: Number(lng),
    radiusMeters: radiusMeters != null ? Number(radiusMeters) : undefined
  });
  return unwrap(res);
}

export async function clearStoreLocation() {
  var res = await callable("clearStoreLocation")({});
  return unwrap(res);
}

/** @returns {Promise<{ secret: string, otpauthUrl: string }>} */
export async function enrollStaffTotp(staffId) {
  var res = await callable("enrollStaffTotp")({ staffId: String(staffId || "") });
  return unwrap(res);
}

export async function confirmStaffTotpEnrollment(staffId, code) {
  var res = await callable("confirmStaffTotpEnrollment")({
    staffId: String(staffId || ""),
    code: String(code || "")
  });
  return unwrap(res);
}

export async function setStaffTotpEnabled(staffId, enabled) {
  var res = await callable("setStaffTotpEnabled")({
    staffId: String(staffId || ""),
    enabled: !!enabled
  });
  return unwrap(res);
}

export async function resetStaffTotp(staffId) {
  var res = await callable("resetStaffTotp")({ staffId: String(staffId || "") });
  return unwrap(res);
}
