import { db, collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot } from "../../../shared/firebase/init.js";
import { COL_MENU_ITEMS } from "../../../shared/firebase/collections.js";

export function subscribeMenuItems(onNext, onError) {
  return onSnapshot(collection(db, COL_MENU_ITEMS), onNext, onError);
}

export function addMenuItem(payload) {
  return addDoc(collection(db, COL_MENU_ITEMS), payload);
}

export function persistMenuItem(id, payload) {
  return updateDoc(doc(db, COL_MENU_ITEMS, id), payload);
}

export function deleteMenuItem(id) {
  return deleteDoc(doc(db, COL_MENU_ITEMS, id));
}
