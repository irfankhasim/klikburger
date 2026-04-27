/**
 * Firestore: produk / menu (modifiers) — resipi + harga jual.
 */
import { db, collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot } from "../firebase/init.js";
import { COL_MODIFIERS } from "./collections.js";

export function subscribeModifiers(onNext, onError) {
  return onSnapshot(collection(db, COL_MODIFIERS), onNext, onError);
}

export function addModifier(payload) {
  return addDoc(collection(db, COL_MODIFIERS), payload);
}

export function persistModifier(id, payload) {
  return updateDoc(doc(db, COL_MODIFIERS, id), payload);
}

export function deleteModifier(id) {
  return deleteDoc(doc(db, COL_MODIFIERS, id));
}
