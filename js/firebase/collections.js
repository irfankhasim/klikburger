/**
 * Pendaftaran nama koleksi Firestore — satu sumber untuk seluruh app.
 *
 * --- Skema cadangan (medan utama) ---
 *
 * **ingredients**
 * - name, purchasePrice, purchaseQty, unit, sortIndex
 * - createdAt, updatedAt (serverTimestamp)
 * - (pilihan / laporan) category, supplier, minStockQty, stockStatus — disimpan oleh seed & borang masa hadapan
 * - Rujukan pakej; stok sebenar & FIFO dalam `ingredient_batches` (+ sejarah `ingredient_ledger`)
 *
 * **modifiers** (legacy — gabungan “menu + resipi” dalam satu dokumen)
 * - name, sellingPrice, usage{...}, sortIndex
 * - Kekalkan untuk UI `pos-cost-calculator.html` sedia ada; pelan migrasi: MENU-COSTING-ARCHITECTURE.md
 *
 * **recipes** (resipi / BOM sahaja)
 * - name, usage{ ingredientId: number | { guna, gunaUnit } }, sortIndex
 * - Tiada harga jual — dikongsi oleh satu atau lebih menu_items
 *
 * **menu_items** (SKU menu + harga jual)
 * - name, sellingPrice, recipeId (rujuk dokumen `recipes`), sortIndex
 *
 * **sales** (transaksi / ringkasan jualan)
 * - createdAt, lines[], subtotal, totalCogsFifo, table, customerName, notes
 * - staffId, staffName (POS — jejak prestasi kakitangan)
 *
 * **purchase_history** (belian stok / bulk)
 * - createdAt, totalAmount, supplier?, lines[{ ingredientId?, label, qty, unit, unitCost, lineTotal }], notes?
 *
 * **ingredient_ledger** (sejarah harga & pembelian per bahan)
 * - ingredientId, kind: initial | purchase | price_adjust, occurredAt, createdAt
 * - purchasePrice, purchaseQty, unit, costPerUnit, notes?, nameSnapshot?
 *
 * **ingredient_batches** (stok FIFO per lot belian)
 * - ingredientId, qtyRemaining, qtyOriginal, costPerUnit, openedAt (Timestamp — susunan FIFO, unik per simpanan)
 * - purchaseOccurredAt, purchaseTotalRm? (jumlah RM pakej lot), purchaseUnit?, ledgerEntryId?, synthetic?, createdAt
 * - (pilihan) expiryAt (Timestamp), supplierBatchCode (string — kod lot pembekal / seed)
 */

export const COL_INGREDIENTS = "ingredients";
export const COL_INGREDIENT_LEDGER = "ingredient_ledger";
export const COL_INGREDIENT_BATCHES = "ingredient_batches";
/** Legacy: produk + usage dalam satu dokumen (kalkulator sedia ada) */
export const COL_MODIFIERS = "modifiers";
export const COL_RECIPES = "recipes";
export const COL_MENU_ITEMS = "menu_items";
export const COL_SALES = "sales";
export const COL_PURCHASE_HISTORY = "purchase_history";

/** Kakitangan — profil pekerja + syif mingguan (weeklyRoster) */
export const COL_STAFF = "staff";
/** Log audit / aktiviti POS (siapa jual, ubah, dll.) */
export const COL_STAFF_ACTIVITY = "staff_activity";
/** Tetapan bonus/KPI (satu dokumen) */
export const COL_STAFF_SETTINGS = "staff_settings";

/** --- POS (Firestore sahaja; tiada SQLite) --- */
/** Profil POS / peranan (`role`: owner | staff), selaras Auth UID */
export const COL_POS_USERS = "users";
/** `counters`: seqOrder, seqReceipt, activeShiftDocId */
export const COL_POS_META = "pos_meta";
/** Pesanan POS; subkoleksi `items` */
export const COL_POS_ORDERS = "pos_orders";
/** Resit POS */
export const COL_POS_RECEIPTS = "pos_receipts";
/** Drawer tunai; subkoleksi `cash_movements` */
export const COL_POS_SHIFTS = "pos_shifts";
/** Ringkasan transaksi jualan POS (selaras `sales` / checkout) */
export const COL_POS_SALES_TRANSACTIONS = "pos_sales_transactions";
/** Log audit POS */
export const COL_POS_AUDIT = "pos_audit_logs";

