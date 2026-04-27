/**
 * Tulis pesanan, resit, pembilang & transaksi POS dalam transaksi Firestore yang sama dengan jualan/FIFO.
 * Panggil hanya selepas semua `transaction.get` lain (bacaan counters mesti awal transaksi).
 */
import { db, doc, collection, serverTimestamp, runTransaction } from "./firebase/init.js";
import {
  COL_POS_META,
  COL_POS_ORDERS,
  COL_POS_RECEIPTS,
  COL_POS_SALES_TRANSACTIONS
} from "./firebase/collections.js";

/**
 * @param {import("firebase/firestore").Transaction} transaction
 * @param {import("firebase/firestore").DocumentSnapshot} countersSnap — hasil `transaction.get(countersRef)` di awal transaksi
 * @param {object} params
 * @param {import("firebase/firestore").DocumentReference} params.saleRef
 * @param {string} params.saleId
 * @param {Array<object>} params.saleLines
 * @param {number} params.subtotal
 * @param {number} params.totalCogsFifo
 * @param {string} params.paymentMethod
 * @param {number|null} [params.tendered]
 * @param {number|null} [params.changeDue]
 * @param {boolean} [params.drawerOpenedSimulated]
 * @param {string} [params.staffId]
 * @param {string} [params.staffName]
 */
export function appendCheckoutInTransaction(transaction, countersSnap, params) {
  var countersRef = countersSnap.ref;
  var d = countersSnap.exists() ? countersSnap.data() : {};
  var seqO = (typeof d.seqOrder === "number" ? d.seqOrder : 1000) + 1;
  var seqR = (typeof d.seqReceipt === "number" ? d.seqReceipt : 1000) + 1;
  var activeShiftDocId = d.activeShiftDocId != null && d.activeShiftDocId !== "" ? String(d.activeShiftDocId) : "";

  var orderRef = doc(collection(db, COL_POS_ORDERS));
  var orderId = orderRef.id;
  var receiptRef = doc(collection(db, COL_POS_RECEIPTS));
  var receiptDocId = receiptRef.id;
  var orderNo = "KB-" + seqO;
  var receiptNo = "R-" + seqR;
  var now = serverTimestamp();
  var saleLines = params.saleLines || [];
  var subtotal = typeof params.subtotal === "number" ? params.subtotal : 0;
  var totalCogs = typeof params.totalCogsFifo === "number" ? params.totalCogsFifo : 0;
  var pay = params.paymentMethod || "cash";
  var kt = "KT-" + receiptNo.replace(/^R-/, "");

  var hubLines = saleLines.map(function (ln) {
    return {
      id: ln.modifierId,
      name: ln.name,
      qty: ln.qty,
      unitPrice: ln.unitPrice,
      lineTotal: ln.lineTotal,
      cogsFifo: typeof ln.cogsFifo === "number" ? ln.cogsFifo : 0
    };
  });

  transaction.set(
    countersRef,
    {
      seqOrder: seqO,
      seqReceipt: seqR,
      updatedAt: now
    },
    { merge: true }
  );

  transaction.set(orderRef, {
    orderNo: orderNo,
    receiptNo: receiptNo,
    saleId: params.saleId,
    lifecycle: "paid",
    kitchenStage: "waiting",
    createdAt: now,
    paidAt: now,
    updatedAt: now,
    subtotal: subtotal,
    totalCogsFifo: totalCogs,
    paymentMethod: pay,
    tendered: params.tendered != null ? params.tendered : null,
    changeDue: params.changeDue != null ? params.changeDue : null,
    kitchenTicketId: kt,
    drawerOpenedSimulated: !!params.drawerOpenedSimulated,
    staffId: params.staffId || "",
    staffName: params.staffName || "",
    shiftDocId: activeShiftDocId || null,
    lines: hubLines
  });

  saleLines.forEach(function (ln, idx) {
    var lineRef = doc(collection(db, COL_POS_ORDERS, orderId, "items"));
    transaction.set(lineRef, {
      productId: ln.modifierId,
      name: ln.name,
      qty: ln.qty,
      unitPrice: ln.unitPrice,
      lineTotal: ln.lineTotal,
      cogsFifo: typeof ln.cogsFifo === "number" ? ln.cogsFifo : 0,
      sortIndex: idx,
      createdAt: now
    });
  });

  transaction.set(receiptRef, {
    receiptNo: receiptNo,
    orderId: orderId,
    orderNo: orderNo,
    saleId: params.saleId,
    createdAt: now,
    paymentMethod: pay,
    subtotal: subtotal,
    totalCogsFifo: totalCogs,
    voided: false,
    voidedAt: null,
    voidReason: null,
    refundNote: null,
    lines: hubLines
  });

  var txRef = doc(db, COL_POS_SALES_TRANSACTIONS, params.saleId);
  transaction.set(txRef, {
    saleId: params.saleId,
    orderId: orderId,
    receiptNo: receiptNo,
    subtotal: subtotal,
    totalCogsFifo: totalCogs,
    lines: saleLines,
    createdAt: now,
    staffId: params.staffId || "",
    staffName: params.staffName || ""
  });

  transaction.update(params.saleRef, {
    posOrderId: orderId,
    posReceiptNo: receiptNo,
    posReceiptDocId: receiptDocId
  });

  var nowIso = new Date().toISOString();
  return {
    order: {
      id: orderId,
      orderNo: orderNo,
      receiptNo: receiptNo,
      saleId: params.saleId,
      lifecycle: "paid",
      kitchenStage: "waiting",
      createdAt: nowIso,
      paidAt: nowIso,
      updatedAt: nowIso,
      lines: hubLines,
      subtotal: subtotal,
      totalCogsFifo: totalCogs,
      paymentMethod: pay,
      tendered: params.tendered != null ? params.tendered : null,
      changeDue: params.changeDue != null ? params.changeDue : null,
      kitchenTicketId: kt,
      drawerOpenedSimulated: !!params.drawerOpenedSimulated,
      staffId: params.staffId || "",
      staffName: params.staffName || ""
    },
    receipt: {
      receiptNo: receiptNo,
      orderId: orderId,
      orderNo: orderNo,
      saleId: params.saleId,
      createdAt: nowIso,
      paymentMethod: pay,
      subtotal: subtotal,
      totalCogsFifo: totalCogs,
      lines: hubLines,
      voided: false,
      voidedAt: null,
      voidReason: null,
      refundNote: null
    },
    orderNo: orderNo,
    receiptNo: receiptNo
  };
}

/** Pastikan dokumen pembilang wujud (panggil sekali dari hub sync). */
export async function ensurePosCountersDoc() {
  var countersRef = doc(db, COL_POS_META, "counters");
  await runTransaction(db, async function (transaction) {
    var snap = await transaction.get(countersRef);
    if (!snap.exists()) {
      transaction.set(countersRef, {
        seqOrder: 1000,
        seqReceipt: 1000,
        activeShiftDocId: null,
        updatedAt: serverTimestamp()
      });
    }
  });
}
