import { db, collection, doc, addDoc, onSnapshot, query, orderBy, limit } from "../firebase/init.js";
import { COL_PURCHASE_HISTORY } from "../firebase/collections.js";

export function subscribeRecentPurchases(maxRows, onNext, onError) {
  var q = query(collection(db, COL_PURCHASE_HISTORY), orderBy("createdAt", "desc"), limit(maxRows || 50));
  return onSnapshot(q, onNext, onError);
}

export function addPurchaseRecord(payload) {
  return addDoc(collection(db, COL_PURCHASE_HISTORY), payload);
}
