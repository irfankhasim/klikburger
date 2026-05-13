import { db, collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot } from "../../../shared/firebase/init.js";
import { COL_RECIPES } from "../../../shared/firebase/collections.js";

export function subscribeRecipes(onNext, onError) {
  return onSnapshot(collection(db, COL_RECIPES), onNext, onError);
}

export function addRecipe(payload) {
  return addDoc(collection(db, COL_RECIPES), payload);
}

export function persistRecipe(id, payload) {
  return updateDoc(doc(db, COL_RECIPES, id), payload);
}

export function deleteRecipe(id) {
  return deleteDoc(doc(db, COL_RECIPES, id));
}
