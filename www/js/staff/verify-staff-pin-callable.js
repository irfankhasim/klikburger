/**
 * Semak PIN clock-in melalui Cloud Function (PIN tidak dibaca dari Firestore klien).
 */
import { functions, httpsCallable } from "../firebase/init.js";

var _verifyStaffPinFn;

function getVerifyStaffPinFn() {
  if (!_verifyStaffPinFn) {
    _verifyStaffPinFn = httpsCallable(functions, "verifyStaffPin");
  }
  return _verifyStaffPinFn;
}

/**
 * @param {string} staffId
 * @param {string} pin
 * @returns {Promise<{ verified: boolean, noPin?: boolean, error?: string }>}
 */
export async function verifyStaffPinCallable(staffId, pin) {
  var res = await getVerifyStaffPinFn()({
    staffId: String(staffId || ""),
    pin: pin != null ? String(pin) : ""
  });
  var data = res && res.data;
  if (!data || typeof data !== "object") {
    return { verified: false, error: "Respons tidak sah." };
  }
  return data;
}
