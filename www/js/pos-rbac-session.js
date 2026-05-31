/**
 * POS RBAC + attendance / shift layers (client prototype).
 * Uses localStorage + BroadcastChannel so parent menu and iframes stay aligned.
 * Replace with real auth API later; PIN checks stay swappable via pos-security-constants.
 */
import { getPosHubState, appendPosAudit } from "./pos-operations-hub.js";
import { PROTOTYPE_PIN_MAX_ATTEMPTS } from "./pos-security-constants.js";
import { ROLES, OPERATIONAL_STATUS } from "./pos-rbac-constants.js";

export { ROLES, OPERATIONAL_STATUS };

/** Cermin Firestore — dynamic import elak rantaian modul berat semasa boot / login. */
function mirrorClockStaffActivity(kind) {
  import("./staff/clock-attendance-firestore.js")
    .then(function (m) {
      return m.recordPosClockStaffActivity({ kind: kind, session: loadSession() });
    })
    .catch(function () {});
}

var STORAGE_KEY = "kb_pos_rbac_session_v1";
var BC_NAME = "kb-pos-rbac";

function defaultSession() {
  return {
    version: 1,
    userId: "",
    displayName: "",
    email: "",
    role: ROLES.CASHIER,
    loggedInAt: null,
    clockedIn: false,
    clockedInAt: null,
    clockedOutAt: null,
    /** After a shift close while on duty — staff POS read-only until clock-out or new shift. */
    afterShiftCloseReadOnly: false,
    /** Owner opts into staff-style shift discipline (optional). */
    ownerWorkingShiftMode: false,
    /** Failed prototype PIN attempts (manager auth). */
    pinFailures: 0,
    pinLockedUntil: null,
    /** Dokumen Firestore `staff/{id}` — bila terminal kongsi satu akaun Auth (pekerja pilih nama sendiri). */
    operationalStaffId: "",
    operationalStaffName: ""
  };
}

function safeParse(json) {
  try {
    return JSON.parse(json);
  } catch (e) {
    return null;
  }
}

export function loadSession() {
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultSession();
    var o = safeParse(raw);
    if (!o || typeof o !== "object") return defaultSession();
    var d = defaultSession();
    Object.keys(d).forEach(function (k) {
      if (o[k] !== undefined) d[k] = o[k];
    });
    if (d.role !== ROLES.CASHIER && d.role !== ROLES.SHIFT_LEAD && d.role !== ROLES.OWNER && d.role !== ROLES.ADMIN) {
      d.role = ROLES.CASHIER;
    }
    return d;
  } catch (e) {
    return defaultSession();
  }
}

function saveSession(sess) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sess));
  } catch (e) {}
}

var listeners = new Set();
var bc = null;
try {
  bc = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(BC_NAME) : null;
  if (bc) {
    bc.onmessage = function (ev) {
      if (ev && ev.data && ev.data.type === "kb-pos-rbac-sync") {
        listeners.forEach(function (fn) {
          try {
            fn(getSnapshot());
          } catch (e) {}
        });
      }
    };
  }
} catch (e) {
  bc = null;
}

function emitRbac() {
  var snap = getSnapshot();
  listeners.forEach(function (fn) {
    try {
      fn(snap);
    } catch (e) {}
  });
  if (bc) {
    try {
      bc.postMessage({ type: "kb-pos-rbac-sync", t: Date.now() });
    } catch (e) {}
  }
}

export function getSnapshot() {
  return {
    session: loadSession(),
    hub: getPosHubState(),
    effectiveStatus: getEffectiveOperationalStatus(),
    isElevatedRole: isElevatedRole(),
    isPinLocked: isPinLocked()
  };
}

export function subscribeRbac(fn) {
  listeners.add(fn);
  try {
    fn(getSnapshot());
  } catch (e) {}
  return function () {
    listeners.delete(fn);
  };
}

export function isElevatedRole() {
  var r = loadSession().role;
  return r === ROLES.OWNER || r === ROLES.ADMIN;
}

export function isShiftLead() {
  return loadSession().role === ROLES.SHIFT_LEAD;
}

export function isStaffRole() {
  var r = loadSession().role;
  return r === ROLES.CASHIER || r === ROLES.SHIFT_LEAD;
}

/** Pemilik ikut disiplin syif POS yang sama seperti kakitangan kaunter. */
export function isOwnerRole() {
  return loadSession().role === ROLES.OWNER;
}

/** Pilih rekod `staff` semasa clock in (terminal kongsi + pemilik). */
export function requiresOperationalStaffPicker() {
  var r = loadSession().role;
  return r === ROLES.CASHIER || r === ROLES.SHIFT_LEAD || r === ROLES.OWNER;
}

export function isPinLocked() {
  var s = loadSession();
  if (!s.pinLockedUntil) return false;
  return Date.now() < s.pinLockedUntil;
}

/**
 * Effective POS lifecycle status. Pemilik ikut aliran clock in / drawer seperti staf;
 * hanya ADMIN boleh langkau (akaun sistem).
 */
export function getEffectiveOperationalStatus() {
  var sess = loadSession();
  var hub = getPosHubState();
  if (sess.role === ROLES.ADMIN) {
    return OPERATIONAL_STATUS.SHIFT_OPEN;
  }
  if (!sess.clockedIn) return OPERATIONAL_STATUS.NOT_CLOCKED_IN;
  if (hub.shift && hub.shift.isOpen) return OPERATIONAL_STATUS.SHIFT_OPEN;
  if (sess.afterShiftCloseReadOnly) return OPERATIONAL_STATUS.SHIFT_CLOSED;
  return OPERATIONAL_STATUS.CLOCKED_IN;
}

export function canBypassStaffRestrictions() {
  return loadSession().role === ROLES.ADMIN;
}

/** Layer 1+2: full sales & kitchen ops (not money drawer extras). */
export function canAccessOperationalModules() {
  if (canBypassStaffRestrictions()) return true;
  var st = getEffectiveOperationalStatus();
  return st !== OPERATIONAL_STATUS.NOT_CLOCKED_IN && st !== OPERATIONAL_STATUS.SHIFT_CLOSED;
}

/** Read-only: dashboard-style view for locked staff. */
export function isReadOnlyMode() {
  if (canBypassStaffRestrictions()) return false;
  return getEffectiveOperationalStatus() === OPERATIONAL_STATUS.SHIFT_CLOSED;
}

/** Layer 2+: cash, shift open/close, void/refund, cash in/out. */
export function canUseFinancialControls() {
  if (canBypassStaffRestrictions()) return true;
  return getEffectiveOperationalStatus() === OPERATIONAL_STATUS.SHIFT_OPEN;
}

export function setSession(partial) {
  var s = loadSession();
  Object.keys(partial || {}).forEach(function (k) {
    s[k] = partial[k];
  });
  saveSession(s);
  emitRbac();
}

/** Ikat jualan / staff_activity kepada rekod `staff` (bukan UID Auth). */
export function setPosOperationalStaff(staffDocId, displayName) {
  setSession({
    operationalStaffId: String(staffDocId || "").trim(),
    operationalStaffName: String(displayName || "").trim()
  });
}

export function clearPosOperationalStaff() {
  setSession({ operationalStaffId: "", operationalStaffName: "" });
}

export function loginSession(payload) {
  var s = defaultSession();
  s.userId = String((payload && payload.userId) || "user_" + Date.now());
  s.displayName = String((payload && payload.displayName) || "User");
  s.email = String((payload && payload.email) || "");
  s.role = (payload && payload.role) || ROLES.CASHIER;
  s.loggedInAt = new Date().toISOString();
  s.clockedIn = false;
  s.clockedInAt = null;
  s.afterShiftCloseReadOnly = false;
  s.ownerWorkingShiftMode = false;
  s.pinFailures = 0;
  s.pinLockedUntil = null;
  saveSession(s);
  emitRbac();
}

/**
 * Sebab log keluar disekat — null jika dibenarkan.
 * Semak drawer/syif kaunter dahulu, kemudian status clock in.
 */
export function getLogoutBlockReason() {
  var sess = loadSession();
  var hub = getPosHubState();
  if (hub.shift && hub.shift.isOpen) {
    return "Tutup drawer tunai (syif kaunter) dahulu sebelum log keluar. Pergi ke menu Clock In / Drawer.";
  }
  if (sess.clockedIn) {
    return "Sila clock out terlebih dahulu sebelum log keluar. Pergi ke menu Clock In / Clock Out.";
  }
  return null;
}

export function canLogout() {
  return !getLogoutBlockReason();
}

/** Sahkan sedia log keluar — termasuk semakan Firestore jika cache hub belum dimuat. */
export async function assertLogoutReady() {
  var reason = getLogoutBlockReason();
  if (reason) return reason;
  try {
    var hubMod = await import("./pos-firestore-hub.js");
    if (await hubMod.queryOpenShiftExists()) {
      return "Tutup drawer tunai (syif kaunter) dahulu sebelum log keluar. Pergi ke menu Clock In / Drawer.";
    }
  } catch (e) {}
  return null;
}

export function logoutSession() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {}
  emitRbac();
}

export function clockIn() {
  var s = loadSession();
  if (s.clockedIn) return { ok: false, error: "Sudah clock in." };
  if (getPosHubState().shift && getPosHubState().shift.isOpen) {
    return { ok: false, error: "Drawer tunai masih dibuka. Tutup drawer dahulu sebelum clock in." };
  }
  s.clockedIn = true;
  s.clockedInAt = new Date().toISOString();
  s.clockedOutAt = null;
  s.afterShiftCloseReadOnly = false;
  saveSession(s);
  appendPosAudit({
    type: "clock_in",
    message: "Clock in",
    userId: s.userId,
    userName: s.displayName,
    role: s.role,
    meta: {}
  });
  mirrorClockStaffActivity("clock_in");
  emitRbac();
  return { ok: true };
}

export function clockOut() {
  var hub = getPosHubState();
  if (hub.shift && hub.shift.isOpen) {
    return { ok: false, error: "Tutup drawer tunai dahulu sebelum clock out." };
  }
  var s = loadSession();
  s.clockedIn = false;
  s.clockedOutAt = new Date().toISOString();
  s.afterShiftCloseReadOnly = false;
  s.pinFailures = 0;
  s.pinLockedUntil = null;
  saveSession(s);
  appendPosAudit({
    type: "clock_out",
    message: "Clock out",
    userId: s.userId,
    userName: s.displayName,
    role: s.role,
    meta: {}
  });
  mirrorClockStaffActivity("clock_out");
  clearPosOperationalStaff();
  emitRbac();
  return { ok: true };
}

export function setOwnerWorkingShiftMode(on) {
  if (!isElevatedRole()) return { ok: false, error: "Owner/Admin only." };
  var s = loadSession();
  s.ownerWorkingShiftMode = !!on;
  saveSession(s);
  appendPosAudit({
    type: "owner_working_mode",
    message: on ? "Owner working shift mode ON" : "Owner working shift mode OFF",
    userId: s.userId,
    userName: s.displayName,
    role: s.role,
    meta: { on: !!on }
  });
  emitRbac();
  return { ok: true };
}

export function notifyShiftClosedForStaff() {
  var s = loadSession();
  if (s.role === ROLES.ADMIN) return;
  s.afterShiftCloseReadOnly = true;
  saveSession(s);
  emitRbac();
}

export function notifyShiftOpenedClearReadOnly() {
  var s = loadSession();
  s.afterShiftCloseReadOnly = false;
  saveSession(s);
  emitRbac();
}

/**
 * Record failed manager PIN; lock after max attempts.
 */
export function recordManagerPinFailure(context) {
  var s = loadSession();
  if (isPinLocked()) return { ok: false, locked: true, error: "PIN entry locked. Try again later or contact owner." };
  s.pinFailures = (s.pinFailures || 0) + 1;
  var locked = s.pinFailures >= PROTOTYPE_PIN_MAX_ATTEMPTS;
  if (locked) {
    s.pinLockedUntil = Date.now() + 10 * 60 * 1000;
  }
  saveSession(s);
  /* PIN failure rows are written by pos-operations-hub where auth runs; here we only track lockout. */
  emitRbac();
  return { ok: false, locked: locked, attempts: s.pinFailures };
}

export function clearManagerPinFailures() {
  var s = loadSession();
  s.pinFailures = 0;
  s.pinLockedUntil = null;
  saveSession(s);
  emitRbac();
}

export function getActorForAudit() {
  var s = loadSession();
  var opId = String(s.operationalStaffId || "").trim();
  if (opId) {
    return {
      userId: opId,
      userName: String(s.operationalStaffName || "").trim() || s.displayName,
      role: s.role
    };
  }
  return {
    userId: s.userId,
    userName: s.displayName,
    role: s.role
  };
}

/**
 * Back office is outside the POS module — only owner/admin may switch there from main-menu.
 * Staff (including shift lead) stay on front counter only.
 */
export function canAccessBackOfficeModule() {
  return isElevatedRole();
}

/** Paparan di menu POS & skrin terbenam — kekal ringkas untuk kakitangan kaunter. */
export function staffLockMessage() {
  return "Sila clock in terlebih dahulu untuk membuka drawer tunai serta menu Jualan, Resit, dan Senarai Pesanan.";
}
