/**
 * Pemalar RBAC ringkas — tiada import ke hab Firestore.
 * Elak rantaian modul: pos-firebase-auth-bridge ↔ pos-rbac-session (pos-operations-hub).
 */

export var ROLES = {
  CASHIER: "CASHIER",
  SHIFT_LEAD: "SHIFT_LEAD",
  OWNER: "OWNER",
  ADMIN: "ADMIN"
};

export var OPERATIONAL_STATUS = {
  NOT_CLOCKED_IN: "NOT_CLOCKED_IN",
  CLOCKED_IN: "CLOCKED_IN",
  SHIFT_OPEN: "SHIFT_OPEN",
  SHIFT_CLOSED: "SHIFT_CLOSED"
};
