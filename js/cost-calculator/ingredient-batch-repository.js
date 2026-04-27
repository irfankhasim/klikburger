/**
 * Firestore: lot stok bahan (FIFO) — satu dokumen per batch belian.
 */
import {
  db,
  collection,
  doc,
  addDoc,
  getDocs,
  writeBatch,
  query,
  where,
  limit,
  onSnapshot,
  serverTimestamp,
  Timestamp
} from "../firebase/init.js";
import { COL_INGREDIENT_BATCHES } from "./collections.js";

function batchOpenedMillis(b) {
  var t = b && b.openedAt;
  if (t && typeof t.toMillis === "function") return t.toMillis();
  return 0;
}


export function compareFifoBatches(a, b) {
  var ma = batchOpenedMillis(a) - batchOpenedMillis(b);
  if (ma !== 0) return ma;
  return String(a && a.id ? a.id : "").localeCompare(String(b && b.id ? b.id : ""));
}

export function sortBatchesFifo(list) {
  return (list || []).slice().sort(compareFifoBatches);
}


export function getActiveFifoBatchFromList(list) {
  var sorted = sortBatchesFifo((list || []).filter(function (b) {
    var r = b.qtyRemaining;
    var n = typeof r === "number" ? r : parseFloat(r) || 0;
    return n > 0;
  }));
  return sorted[0] || null;
}

export function subscribeIngredientBatches(onNext, onError) {
  return onSnapshot(collection(db, COL_INGREDIENT_BATCHES), onNext, onError);
}

/** @returns {Record<string, Array<object>>} */
export function groupBatchesByIngredientId(snap) {
  var by = {};
  snap.docs.forEach(function (d) {
    var data = d.data();
    var ingId = String(data.ingredientId || "");
    if (!ingId) return;
    if (!by[ingId]) by[ingId] = [];
    var qr = typeof data.qtyRemaining === "number" ? data.qtyRemaining : parseFloat(data.qtyRemaining) || 0;
    var qo = data.qtyOriginal;
    var qon = typeof qo === "number" ? qo : parseFloat(qo);
    var ptr = data.purchaseTotalRm;
    var purchaseTotalRm = typeof ptr === "number" ? ptr : parseFloat(ptr);
    if (isNaN(purchaseTotalRm)) purchaseTotalRm = null;
    by[ingId].push({
      id: d.id,
      ingredientId: ingId,
      qtyRemaining: qr,
      qtyOriginal: !isNaN(qon) && qon > 0 ? qon : qr,
      costPerUnit: typeof data.costPerUnit === "number" ? data.costPerUnit : parseFloat(data.costPerUnit) || 0,
      openedAt: data.openedAt,
      purchaseOccurredAt: data.purchaseOccurredAt || null,
      purchaseTotalRm: purchaseTotalRm,
      purchaseUnit: data.purchaseUnit != null && String(data.purchaseUnit) !== "" ? String(data.purchaseUnit) : null,
      synthetic: data.synthetic === true,
      ledgerEntryId: data.ledgerEntryId || null
    });
  });
  return by;
}

/**
 * @param {object} p
 * @param {string} p.ingredientId
 * @param {number} p.qtyRemaining
 * @param {number} p.costPerUnit
 * @param {import("firebase/firestore").Timestamp} [p.purchaseOccurredAt] — tarikh akaun (borang); FIFO guna masa sebenar
 * @param {string} [p.purchaseUnit] — unit pakej belian (paparan)
 * @param {string} [p.ledgerEntryId]
 * @param {number} [p.qtyOriginal]
 * @param {number} [p.purchaseTotalRm] — jumlah RM untuk pakej lot (paparan harga pakej batch)
 * @param {boolean} [p.synthetic]
 * @param {import("firebase/firestore").Timestamp} [p.openedAtOverride] — jarang; lalai Timestamp.now()
 * @param {import("firebase/firestore").Timestamp} [p.expiryAt] — tarikh luput lot (pilihan)
 * @param {string} [p.supplierBatchCode] — kod / label lot pembekal (pilihan)
 */
export function createPurchaseBatch(p) {
  var qty = typeof p.qtyRemaining === "number" ? p.qtyRemaining : parseFloat(p.qtyRemaining) || 0;
  var orig = p.qtyOriginal != null ? p.qtyOriginal : qty;
  var origN = typeof orig === "number" ? orig : parseFloat(orig) || qty;
  var fifoAt = p.openedAtOverride != null ? p.openedAtOverride : Timestamp.now();
  var cpu = typeof p.costPerUnit === "number" ? p.costPerUnit : parseFloat(p.costPerUnit) || 0;
  var totalRm =
    typeof p.purchaseTotalRm === "number" && !isNaN(p.purchaseTotalRm)
      ? p.purchaseTotalRm
      : Math.round(cpu * origN * 10000) / 10000;
  var doc = {
    ingredientId: String(p.ingredientId || ""),
    qtyRemaining: qty,
    qtyOriginal: origN,
    costPerUnit: cpu,
    openedAt: fifoAt,
    purchaseOccurredAt: p.purchaseOccurredAt != null ? p.purchaseOccurredAt : null,
    purchaseTotalRm: totalRm,
    purchaseUnit: p.purchaseUnit != null && String(p.purchaseUnit) !== "" ? String(p.purchaseUnit) : null,
    ledgerEntryId: p.ledgerEntryId ? String(p.ledgerEntryId) : null,
    synthetic: p.synthetic === true,
    createdAt: serverTimestamp()
  };
  if (p.expiryAt != null) doc.expiryAt = p.expiryAt;
  if (p.supplierBatchCode != null && String(p.supplierBatchCode) !== "") {
    doc.supplierBatchCode = String(p.supplierBatchCode);
  }
  return addDoc(collection(db, COL_INGREDIENT_BATCHES), doc);
}

export async function deleteBatchesForIngredient(ingredientId) {
  var id = String(ingredientId || "");
  if (!id) return;
  var q = query(collection(db, COL_INGREDIENT_BATCHES), where("ingredientId", "==", id), limit(500));
  var snap = await getDocs(q);
  while (!snap.empty) {
    var batch = writeBatch(db);
    snap.forEach(function (d) {
      batch.delete(doc(db, COL_INGREDIENT_BATCHES, d.id));
    });
    await batch.commit();
    snap = await getDocs(q);
  }
}
