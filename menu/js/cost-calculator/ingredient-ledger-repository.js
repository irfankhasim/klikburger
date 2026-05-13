/**
 * Firestore: sejarah harga & rekod pembelian per bahan (ingredient_ledger).
 */
import {
  db,
  collection,
  doc,
  addDoc,
  deleteDoc,
  onSnapshot,
  getDocs,
  writeBatch,
  query,
  where,
  limit,
  serverTimestamp
} from "../../../shared/firebase/init.js";
import { COL_INGREDIENT_LEDGER } from "./collections.js";

export function subscribeIngredientLedger(ingredientId, onNext, onError) {
  var id = String(ingredientId || "");
  if (!id) {
    if (onError) onError(new Error("ingredientId diperlukan"));
    return function () {};
  }
  /**
   * Hanya `where` — indeks tunggal automatik sahaja (tiada indeks komposit).
   * Susun `occurredAt` menurun di klien (elak ralat “create index” sebelum deploy).
   */
  var q = query(collection(db, COL_INGREDIENT_LEDGER), where("ingredientId", "==", id));
  return onSnapshot(
    q,
    function (snap) {
      var docs = snap.docs.slice().sort(function (a, b) {
        var ax = a.data().occurredAt;
        var bx = b.data().occurredAt;
        var am = ax && typeof ax.toMillis === "function" ? ax.toMillis() : 0;
        var bm = bx && typeof bx.toMillis === "function" ? bx.toMillis() : 0;
        return bm - am;
      });
      onNext({
        docs: docs,
        empty: docs.length === 0,
        forEach: function (cb) {
          docs.forEach(cb);
        }
      });
    },
    onError
  );
}

/** @param {object} payload — medan Firestore untuk satu baris lejar */
export function addIngredientLedgerEntry(payload) {
  return addDoc(collection(db, COL_INGREDIENT_LEDGER), Object.assign({}, payload, { createdAt: serverTimestamp() }));
}

export async function deleteLedgerEntriesForIngredient(ingredientId) {
  var id = String(ingredientId || "");
  if (!id) return;
  var q = query(collection(db, COL_INGREDIENT_LEDGER), where("ingredientId", "==", id), limit(500));
  var snap = await getDocs(q);
  while (!snap.empty) {
    var batch = writeBatch(db);
    snap.forEach(function (d) {
      batch.delete(doc(db, COL_INGREDIENT_LEDGER, d.id));
    });
    await batch.commit();
    snap = await getDocs(q);
  }
}
