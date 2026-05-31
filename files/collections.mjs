/**
 * mcp/lib/collections.mjs
 * Single source of truth for Firestore collection names.
 * Mirrors js/firebase/collections.js — keep in sync.
 */

export const COL = {
  // Inventory & Menu
  INGREDIENTS:         'ingredients',
  INGREDIENT_LEDGER:   'ingredient_ledger',
  INGREDIENT_BATCHES:  'ingredient_batches',
  MODIFIERS:           'modifiers',          // legacy
  RECIPES:             'recipes',
  MENU_ITEMS:          'menu_items',
  PURCHASE_HISTORY:    'purchase_history',
  SALES:               'sales',

  // Staff
  STAFF:               'staff',
  STAFF_ACTIVITY:      'staff_activity',
  STAFF_SETTINGS:      'staff_settings',

  // POS
  USERS:               'users',
  POS_META:            'pos_meta',
  POS_ORDERS:          'pos_orders',          // subcol: items
  POS_RECEIPTS:        'pos_receipts',
  POS_SHIFTS:          'pos_shifts',           // subcol: cash_movements
  POS_SALES_TX:        'pos_sales_transactions',
  POS_AUDIT_LOGS:      'pos_audit_logs',

  // Reports
  MONTHLY_REPORTS:     'monthly_reports',
};

// Sub-collections
export const SUBCOL = {
  ORDER_ITEMS:    'items',
  CASH_MOVEMENTS: 'cash_movements',
};

// pos_meta document IDs
export const META_DOC = {
  COUNTERS: 'counters',
};
