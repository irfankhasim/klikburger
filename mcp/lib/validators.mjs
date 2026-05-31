/**
 * mcp/lib/validators.mjs
 * Input validation for MCP write tools.
 * Pure JS — no external deps needed (no zod install required).
 * Returns { valid: true } or { valid: false, error: string }
 */

// ─── Primitives ──────────────────────────────────────────────────────────────

function isString(v) { return typeof v === 'string' && v.trim().length > 0; }
function isNumber(v) { return typeof v === 'number' && isFinite(v); }
function isPositive(v) { return isNumber(v) && v > 0; }
function isNonNeg(v) { return isNumber(v) && v >= 0; }

function err(msg) { return { valid: false, error: msg }; }
const OK = { valid: true };

// ─── Roles (two vocabularies — do not mix) ───────────────────────────────────
//
// 1) Firestore `users/{uid}.role` — POS login profile. Lowercase in seed
//    (scripts/seed-demo-auth-users.mjs: owner, staff). js/pos-firebase-auth-bridge.js
//    maps owner|pemilik, admin|pentadbir, shift_lead → session ROLES.* (uppercase strings).
//
// 2) Firestore `staff/{id}.role` — HR roster job roles. Lowercase in UI
//    (js/staff/staff-app.js, js/staff/staff-mappers.js STAFF_ROLES_MS): cashier, kitchen, runner, supervisor.

/** Allowed values for `users/{uid}.role` (Firestore storage). */
export const POS_USER_ROLES = ['owner', 'admin', 'shift_lead', 'staff', 'cashier'];

/** Allowed values for `staff/{id}.role` (HR collection — manage_staff MCP). */
export const STAFF_PROFILE_ROLES = ['cashier', 'kitchen', 'runner', 'supervisor'];

/** @deprecated Use STAFF_PROFILE_ROLES — kept for imports expecting ROLES for staff validators. */
export const ROLES = STAFF_PROFILE_ROLES;

/** POS users who may trigger elevated MCP operations (if you validate operator docs later). */
export const WRITE_ROLES = ['owner', 'admin'];
export const ADMIN_ROLES = ['owner'];

// ─── Staff validators ─────────────────────────────────────────────────────────

export function validateCreateStaff(input) {
  if (!isString(input?.name)) return err('name is required (non-empty string)');
  var em = input && input.email != null ? String(input.email).trim() : "";
  if (em && !em.includes("@")) return err('email must be valid when provided');
  if (!STAFF_PROFILE_ROLES.includes(input?.role))
    return err(`role must be one of: ${STAFF_PROFILE_ROLES.join(', ')}`);
  return OK;
}

export function validateUpdateStaff(input) {
  if (!isString(input?.staffId))   return err('staffId is required');
  const allowed = ['name', 'role', 'email', 'phone', 'isActive'];
  const keys = Object.keys(input?.updates ?? {});
  if (keys.length === 0)           return err('updates object must have at least one field');
  const bad = keys.filter(k => !allowed.includes(k));
  if (bad.length)                  return err(`Unknown update fields: ${bad.join(', ')}`);
  if (input.updates.role && !STAFF_PROFILE_ROLES.includes(input.updates.role))
    return err(`role must be one of: ${STAFF_PROFILE_ROLES.join(', ')}`);
  return OK;
}

// ─── Inventory validators ─────────────────────────────────────────────────────

export function validateUpdateIngredient(input) {
  if (!isString(input?.ingredientId)) return err('ingredientId is required');
  const allowed = ['name', 'unit', 'reorderLevel', 'costPerUnit', 'category'];
  const keys = Object.keys(input?.updates ?? {});
  if (keys.length === 0)              return err('updates must have at least one field');
  const bad = keys.filter(k => !allowed.includes(k));
  if (bad.length)                     return err(`Unknown fields: ${bad.join(', ')}`);
  if (input.updates.reorderLevel !== undefined && !isNonNeg(input.updates.reorderLevel))
    return err('reorderLevel must be a non-negative number');
  if (input.updates.costPerUnit !== undefined && !isPositive(input.updates.costPerUnit))
    return err('costPerUnit must be a positive number');
  return OK;
}

export function validateAddPurchase(input) {
  if (!isString(input?.ingredientId))   return err('ingredientId is required');
  if (!isString(input?.ingredientName)) return err('ingredientName is required');
  if (!isPositive(input?.quantity))     return err('quantity must be positive number');
  if (!isPositive(input?.costPerUnit))  return err('costPerUnit must be positive number');
  if (!isString(input?.unit))           return err('unit is required');
  if (!isString(input?.supplierName))   return err('supplierName is required');
  return OK;
}

// ─── Order / POS validators ───────────────────────────────────────────────────

export function validateUpdateOrderStatus(input) {
  const allowed = ['pending', 'preparing', 'ready', 'completed', 'cancelled'];
  if (!isString(input?.orderId))          return err('orderId is required');
  if (!allowed.includes(input?.status))   return err(`status must be one of: ${allowed.join(', ')}`);
  return OK;
}

export function validateVoidReceipt(input) {
  if (!isString(input?.receiptId))  return err('receiptId is required');
  if (!isString(input?.reason))     return err('reason is required (min 10 chars)');
  if (input.reason.trim().length < 10) return err('reason must be at least 10 characters');
  if (!isString(input?.operatorId)) return err('operatorId is required');
  return OK;
}

// ─── Menu validators ──────────────────────────────────────────────────────────

export function validateUpdateMenuItem(input) {
  if (!isString(input?.menuItemId))  return err('menuItemId is required');
  const allowed = ['name', 'price', 'category', 'isAvailable', 'description', 'imageUrl'];
  const keys = Object.keys(input?.updates ?? {});
  if (keys.length === 0)             return err('updates must have at least one field');
  const bad = keys.filter(k => !allowed.includes(k));
  if (bad.length)                    return err(`Unknown fields: ${bad.join(', ')}`);
  if (input.updates.price !== undefined && !isPositive(input.updates.price))
    return err('price must be a positive number');
  return OK;
}

// ─── Report validators ────────────────────────────────────────────────────────

export function validateMonthlyReport(input) {
  if (!isString(input?.yearMonth)) return err('yearMonth is required');
  if (!/^\d{4}-\d{2}$/.test(input.yearMonth))
    return err('yearMonth must be YYYY-MM format (e.g. 2025-01)');
  return OK;
}

// ─── Shift validators ─────────────────────────────────────────────────────────

export function validateCloseShift(input) {
  if (!isString(input?.shiftId))        return err('shiftId is required');
  if (!isString(input?.operatorId))     return err('operatorId is required');
  if (!isNonNeg(input?.closingCash))    return err('closingCash must be a non-negative number');
  return OK;
}

// ─── Document (generic) validators ───────────────────────────────────────────

/**
 * Set MCP_FULL_FIRESTORE_ACCESS=1 on the MCP server process to allow generic
 * create_document / update_document / delete_document on any top-level
 * collection (still blocks path injection: no "/", "..").
 * Use only in trusted environments — Admin SDK bypasses Firestore rules.
 */
export function isFullFirestoreAccessEnabled() {
  const v = process.env.MCP_FULL_FIRESTORE_ACCESS;
  return v === '1' || String(v).toLowerCase() === 'true';
}

/** Top-level collection or document id segment — no subcollection paths. */
export function isSafeFirestoreSegment(name) {
  if (typeof name !== 'string') return false;
  const s = name.trim();
  if (s.length === 0 || s.length > 700) return false;
  if (s.includes('/') || s.includes('..')) return false;
  return true;
}

/** Whitelist of collections AI is allowed to write to */
export const WRITABLE_COLLECTIONS = [
  'staff', 'staff_settings', 'staff_activity', 'ingredients', 'ingredient_batches',
  'ingredient_ledger', 'recipes', 'menu_items', 'modifiers', 'purchase_history',
  'pos_audit_logs', 'monthly_reports', 'pos_orders', 'pos_shifts', 'sales',
];

/** Collections that are NEVER writable via generic tools (unless full access) */
export const PROTECTED_COLLECTIONS = [
  'users', 'pos_meta', 'pos_sales_transactions', 'pos_receipts',
];

export function validateWritableCollection(collection) {
  if (!isSafeFirestoreSegment(collection))
    return err(`Invalid collection id (use a single top-level name, no "/" or "..")`);
  if (isFullFirestoreAccessEnabled()) return OK;
  if (PROTECTED_COLLECTIONS.includes(collection))
    return err(`Collection '${collection}' is protected and cannot be written via MCP`);
  if (!WRITABLE_COLLECTIONS.includes(collection))
    return err(`Collection '${collection}' is not in the writable allowlist`);
  return OK;
}
