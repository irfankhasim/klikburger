/**
 * Firestore: bahan mentah (CRUD + snapshot).
 */
import {
  db,
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  getDocs,
  writeBatch,
  serverTimestamp
} from "../../../shared/firebase/init.js";
import { COL_INGREDIENTS, COL_MODIFIERS } from "./collections.js";
import { deleteLedgerEntriesForIngredient } from "./ingredient-ledger-repository.js";
import { deleteBatchesForIngredient } from "./ingredient-batch-repository.js";

export function subscribeIngredients(onNext, onError) {
  return onSnapshot(collection(db, COL_INGREDIENTS), onNext, onError);
}

export function addIngredient(payload) {
  return addDoc(
    collection(db, COL_INGREDIENTS),
    Object.assign({}, payload, { createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
  );
}

export function persistIngredient(id, payload) {
  return updateDoc(doc(db, COL_INGREDIENTS, id), Object.assign({}, payload, { updatedAt: serverTimestamp() }));
}

/**
 * Padam bahan + buang kunci usage daripada semua dokumen modifiers.
 */
export async function deleteIngredientAndPruneModifiers(ingredientId) {
  await deleteLedgerEntriesForIngredient(ingredientId);
  await deleteBatchesForIngredient(ingredientId);
  await deleteDoc(doc(db, COL_INGREDIENTS, ingredientId));
  var modsSnap = await getDocs(collection(db, COL_MODIFIERS));
  var batch = writeBatch(db);
  modsSnap.forEach(function (d) {
    var data = d.data();
    var u = data.usage && typeof data.usage === "object" ? Object.assign({}, data.usage) : {};
    delete u[ingredientId];
    batch.update(doc(db, COL_MODIFIERS, d.id), { usage: u });
  });
  if (!modsSnap.empty) await batch.commit();
}
