import {
  db,
  collection,
  addDoc,
  onSnapshot,
  query,
  orderBy,
  limit,
  serverTimestamp
} from "../firebase/init.js";
import { COL_PURCHASE_HISTORY } from "../firebase/collections.js";

export function subscribeRecentPurchases(maxRows, onNext, onError) {
  var q = query(collection(db, COL_PURCHASE_HISTORY), orderBy("createdAt", "desc"), limit(maxRows || 50));
  return onSnapshot(q, onNext, onError);
}

export function addPurchaseRecord(payload) {
  return addDoc(collection(db, COL_PURCHASE_HISTORY), payload);
}

/** Rekod belian tunggal — selaras laporan bulanan (`totalAmount`, `lines`). */
export function recordIngredientPurchaseHistory(opts) {
  var o = opts || {};
  var qty = typeof o.qty === "number" ? o.qty : parseFloat(o.qty) || 0;
  var cpu = typeof o.costPerUnit === "number" ? o.costPerUnit : parseFloat(o.costPerUnit) || 0;
  var total = typeof o.totalAmountRm === "number" ? o.totalAmountRm : parseFloat(o.totalAmountRm) || 0;
  return addPurchaseRecord({
    createdAt: serverTimestamp(),
    totalAmount: Math.round(total * 100) / 100,
    supplier: String(o.supplier || "").slice(0, 80),
    notes: String(o.notes || "").slice(0, 200),
    lines: [
      {
        ingredientId: String(o.ingredientId || ""),
        label: String(o.label || "").slice(0, 120),
        qty: qty,
        unit: String(o.unit || ""),
        unitCost: cpu,
        lineTotal: Math.round(total * 100) / 100
      }
    ]
  });
}