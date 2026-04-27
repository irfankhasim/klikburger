import { db, collection, doc, addDoc, onSnapshot, query, orderBy, limit } from "../firebase/init.js";
import { COL_SALES } from "../firebase/collections.js";

export function subscribeRecentSales(maxRows, onNext, onError) {
  var q = query(collection(db, COL_SALES), orderBy("createdAt", "desc"), limit(maxRows || 50));
  return onSnapshot(q, onNext, onError);
}

export function addSaleRecord(payload) {
  return addDoc(collection(db, COL_SALES), payload);
}
