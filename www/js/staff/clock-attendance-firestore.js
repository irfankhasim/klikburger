/**
 * Cermin clock in/out POS ke koleksi staff_activity (Firestore) untuk paparan BO.
 * staffId = `operationalStaffId` jika pekerja pilih rekod `staff` di terminal kongsi;
 * jika tidak, guna `userId` sesi (UID Auth — biasanya akaun staff kongsi).
 * Gagal rangkaian tidak mengganggu aliran POS (localStorage kekal sumber utama sesi).
 */
import { appendStaffActivity } from "./staff-repository.js";

/**
 * @param {{ kind: 'clock_in'|'clock_out', session: { userId?: string, displayName?: string, email?: string, role?: string, operationalStaffId?: string, operationalStaffName?: string } }} opts
 */
export function recordPosClockStaffActivity(opts) {
  var s = opts && opts.session;
  if (!s || !s.userId) return Promise.resolve();
  var kind = opts.kind === "clock_out" ? "clock_out" : "clock_in";
  var opId = String(s.operationalStaffId || "").trim();
  var staffId = opId ? opId : String(s.userId);
  var staffName = opId
    ? String(s.operationalStaffName || "").trim() || String(s.displayName || "")
    : String(s.displayName || "");
  return appendStaffActivity({
    staffId: staffId,
    staffName: staffName,
    kind: kind,
    saleId: "",
    detail: JSON.stringify({
      source: "pos_clock",
      role: String(s.role || ""),
      email: String(s.email || "")
    }),
    subtotal: null,
    orderCount: null
  }).catch(function (e) {
    console.warn("[staff_activity] clock mirror:", e && e.message ? e.message : e);
  });
}
