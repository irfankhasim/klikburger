/**
 * Hab operasi POS — Firestore sebagai satu sumber data (pesanan, resit, drawer, audit).
 */
import {
  db,
  collection,
  doc,
  addDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  runTransaction,
  writeBatch,
  serverTimestamp
} from "./firebase/init.js";
import {
  COL_POS_META,
  COL_POS_ORDERS,
  COL_POS_RECEIPTS,
  COL_POS_SHIFTS,
  COL_POS_AUDIT,
  COL_POS_SALES_TRANSACTIONS,
  COL_SALES
} from "./firebase/collections.js";
import { PROTOTYPE_MANAGER_PIN } from "./pos-security-constants.js";
import { ensurePosCountersDoc } from "./pos-checkout-firestore-writer.js";

function defaultShift() {
  return {
    isOpen: false,
    shiftId: null,
    openedAt: null,
    openingCash: 0,
    openedByStaffId: "",
    openedByStaffName: "",
    openedByRole: "",
    openedWithOwnerBypass: false,
    movements: [],
    closing: null
  };
}

function defaultState() {
  return {
    version: 2,
    seqOrder: 1000,
    seqReceipt: 1000,
    orders: [],
    receipts: [],
    shift: defaultShift(),
    auditLog: []
  };
}

function tsToIso(v) {
  if (!v) return null;
  if (typeof v.toDate === "function") return v.toDate().toISOString();
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string") return v;
  return null;
}

function normalizeState(o) {
  if (!o || typeof o !== "object") return defaultState();
  if (!Array.isArray(o.orders)) o.orders = [];
  if (!Array.isArray(o.receipts)) o.receipts = [];
  if (!o.shift || typeof o.shift !== "object") o.shift = defaultShift();
  var sh = o.shift;
  if (typeof sh.isOpen !== "boolean") sh.isOpen = false;
  if (sh.shiftId == null) sh.shiftId = null;
  if (typeof sh.openingCash !== "number") sh.openingCash = 0;
  if (!Array.isArray(sh.movements)) sh.movements = [];
  if (sh.openedByStaffId == null) sh.openedByStaffId = "";
  if (sh.openedByStaffName == null) sh.openedByStaffName = "";
  if (sh.openedByRole == null) sh.openedByRole = "";
  if (typeof sh.openedWithOwnerBypass !== "boolean") sh.openedWithOwnerBypass = false;
  if (!Array.isArray(o.auditLog)) o.auditLog = [];
  if (typeof o.seqOrder !== "number") o.seqOrder = 1000;
  if (typeof o.seqReceipt !== "number") o.seqReceipt = 1000;
  if (typeof o.version !== "number") o.version = 2;
  return o;
}

var hubCache = defaultState();
var listeners = new Set();
var unsubscribers = [];
var movementsUnsub = null;
var lastShiftDocId = null;

function emit() {
  var s = hubCache;
  listeners.forEach(function (fn) {
    try {
      fn(s);
    } catch (e) {}
  });
}

function rebuildHubCache(parts) {
  hubCache = normalizeState(
    Object.assign({}, hubCache, parts || {})
  );
  emit();
}

function mapOrderDoc(d) {
  var id = d.id;
  var x = d.data();
  var lines = Array.isArray(x.lines) ? x.lines : [];
  return {
    id: id,
    orderNo: x.orderNo || "",
    receiptNo: x.receiptNo || "",
    saleId: x.saleId || "",
    lifecycle: x.lifecycle || "paid",
    kitchenStage: x.kitchenStage || "waiting",
    createdAt: tsToIso(x.createdAt) || "",
    paidAt: tsToIso(x.paidAt) || "",
    updatedAt: tsToIso(x.updatedAt) || "",
    lines: lines,
    subtotal: typeof x.subtotal === "number" ? x.subtotal : 0,
    totalCogsFifo: typeof x.totalCogsFifo === "number" ? x.totalCogsFifo : 0,
    paymentMethod: x.paymentMethod || "cash",
    tendered: x.tendered != null ? x.tendered : null,
    changeDue: x.changeDue != null ? x.changeDue : null,
    kitchenTicketId: x.kitchenTicketId || "",
    drawerOpenedSimulated: !!x.drawerOpenedSimulated,
    staffId: x.staffId || "",
    staffName: x.staffName || "",
    cancelReason: x.cancelReason || undefined
  };
}

function mapReceiptDoc(d) {
  var x = d.data();
  return {
    receiptNo: x.receiptNo || "",
    orderId: x.orderId || "",
    orderNo: x.orderNo || "",
    saleId: x.saleId || "",
    createdAt: tsToIso(x.createdAt) || "",
    paymentMethod: x.paymentMethod || "cash",
    subtotal: typeof x.subtotal === "number" ? x.subtotal : 0,
    totalCogsFifo: typeof x.totalCogsFifo === "number" ? x.totalCogsFifo : 0,
    lines: Array.isArray(x.lines) ? x.lines : [],
    voided: !!x.voided,
    voidedAt: tsToIso(x.voidedAt),
    voidReason: x.voidReason || null,
    refundNote: x.refundNote || null
  };
}

function mapAuditDoc(d) {
  var x = d.data();
  return {
    id: "aud_" + d.id,
    at: tsToIso(x.at) || "",
    type: x.type || "event",
    message: x.message || "",
    userId: x.userId || "",
    userName: x.userName || "",
    role: x.role || "",
    meta: x.meta && typeof x.meta === "object" ? x.meta : {}
  };
}

function attachMovementsListener(shiftDocId, shiftHeader) {
  if (movementsUnsub) {
    movementsUnsub();
    movementsUnsub = null;
  }
  if (!shiftDocId) {
    rebuildHubCache({ shift: defaultShift() });
    return;
  }
  var movQ = query(
    collection(db, COL_POS_SHIFTS, shiftDocId, "cash_movements"),
    orderBy("createdAt", "asc")
  );
  movementsUnsub = onSnapshot(
    movQ,
    function (msnap) {
      var movements = msnap.docs.map(function (md) {
        var m = md.data();
        return {
          type: m.type === "out" ? "out" : "in",
          amount: typeof m.amount === "number" ? m.amount : parseFloat(m.amount) || 0,
          note: m.note || "",
          at: tsToIso(m.createdAt) || ""
        };
      });
      var sh = Object.assign({}, shiftHeader, { movements: movements });
      rebuildHubCache({ shift: sh });
    },
    function () {
      rebuildHubCache({ shift: Object.assign({}, shiftHeader, { movements: [] }) });
    }
  );
}

function buildShiftFromOpenDoc(shiftDoc) {
  var x = shiftDoc.data();
  var openedAt = tsToIso(x.openedAt) || "";
  return {
    isOpen: true,
    shiftId: x.shiftCode || shiftDoc.id,
    openedAt: openedAt,
    openingCash: typeof x.openingCash === "number" ? x.openingCash : parseFloat(x.openingCash) || 0,
    openedByStaffId: String(x.openedByUserId || ""),
    openedByStaffName: String(x.openedByDisplayName || ""),
    openedByRole: String(x.openedByRole || ""),
    openedWithOwnerBypass: !!x.openedWithOwnerBypass,
    movements: [],
    closing: x.closing && typeof x.closing === "object" ? x.closing : null
  };
}

export function registerPosHubPersistHook() {}

export function applyExternalHubState() {}

export function subscribePosHub(fn) {
  listeners.add(fn);
  try {
    fn(hubCache);
  } catch (e) {}
  if (listeners.size === 1) {
    startFirestoreHubListeners();
  }
  return function () {
    listeners.delete(fn);
    if (!listeners.size) {
      stopFirestoreHubListeners();
    }
  };
}

export function getPosHubState() {
  return hubCache;
}

export async function appendPosAudit(entry) {
  await addDoc(collection(db, COL_POS_AUDIT), {
    at: serverTimestamp(),
    type: (entry && entry.type) || "event",
    message: (entry && entry.message) || "",
    userId: (entry && entry.userId) || "",
    userName: (entry && entry.userName) || "",
    role: (entry && entry.role) || "",
    meta: (entry && entry.meta) || {}
  });
}

export async function updateKitchenStage(orderId, stage) {
  var ref = doc(db, COL_POS_ORDERS, String(orderId));
  var snap = await getDoc(ref);
  if (!snap.exists()) return null;
  var now = serverTimestamp();
  var lifecycle = snap.data().lifecycle || "paid";
  if (stage === "preparing") lifecycle = "preparing";
  else if (stage === "ready") lifecycle = "ready";
  else if (stage === "handed") lifecycle = "completed";
  else if (stage === "waiting") lifecycle = "paid";
  await updateDoc(ref, {
    kitchenStage: stage,
    lifecycle: lifecycle,
    updatedAt: now
  });
  return getPosHubState().orders.find(function (o) {
    return o.id === String(orderId);
  });
}

export async function cancelOrderInHub(orderId, reason) {
  var ref = doc(db, COL_POS_ORDERS, String(orderId));
  var snap = await getDoc(ref);
  if (!snap.exists()) return null;
  await updateDoc(ref, {
    lifecycle: "cancelled",
    kitchenStage: "cancelled",
    cancelReason: String(reason || ""),
    updatedAt: serverTimestamp()
  });
  return getPosHubState().orders.find(function (o) {
    return o.id === String(orderId);
  });
}

export async function voidReceiptInHub(receiptNo, auth) {
  var opts =
    typeof auth === "object" && auth !== null && !Array.isArray(auth)
      ? auth
      : { pin: auth };
  var pin = opts.pin != null ? String(opts.pin) : "";
  var actor = opts.actor || {};
  var rno = String(receiptNo).trim();
  var rq = query(collection(db, COL_POS_RECEIPTS), where("receiptNo", "==", rno), limit(1));
  var rs = await getDocs(rq);
  if (rs.empty) return { ok: false, error: "Resit tidak dijumpai." };
  var rdoc = rs.docs[0];
  var data = rdoc.data();
  if (data.voided) return { ok: false, error: "Resit sudah dibatalkan." };
  if (!opts.ownerBypass && pin !== PROTOTYPE_MANAGER_PIN) {
    await appendPosAudit({
      type: "pin_fail",
      message: "Void receipt — invalid PIN",
      userId: actor.userId || "",
      userName: actor.userName || "",
      role: actor.role || "",
      meta: { receiptNo: rno }
    });
    return { ok: false, error: "PIN pengurus tidak sah (prototype: " + PROTOTYPE_MANAGER_PIN + ")." };
  }
  await updateDoc(rdoc.ref, {
    voided: true,
    voidedAt: serverTimestamp(),
    voidReason: "void"
  });
  await appendPosAudit({
    type: "void_receipt",
    message: "Void receipt " + rno,
    userId: actor.userId || "",
    userName: actor.userName || "",
    role: actor.role || "",
    meta: { receiptNo: rno, ownerBypass: !!opts.ownerBypass }
  });
  var base = mapReceiptDoc(rdoc);
  return { ok: true, receipt: Object.assign({}, base, { voided: true, voidedAt: new Date().toISOString() }) };
}

export async function removeVoidedReceiptFromHub(receiptNo, actor) {
  actor = actor || {};
  var rno = String(receiptNo).trim();
  var rq = query(collection(db, COL_POS_RECEIPTS), where("receiptNo", "==", rno), limit(1));
  var rs = await getDocs(rq);
  if (rs.empty) return { ok: false, error: "Resit tidak dijumpai." };
  var rdoc = rs.docs[0];
  var rd = rdoc.data();
  if (!rd.voided) return { ok: false, error: "Hanya resit yang sudah void boleh dipadam daripada senarai." };
  var orderId = rd.orderId || "";
  var saleId = rd.saleId || "";
  var batch = writeBatch(db);
  if (orderId) {
    var itemsSnap = await getDocs(collection(db, COL_POS_ORDERS, orderId, "items"));
    itemsSnap.forEach(function (d) {
      batch.delete(d.ref);
    });
    batch.delete(doc(db, COL_POS_ORDERS, orderId));
  }
  batch.delete(rdoc.ref);
  if (saleId) {
    batch.delete(doc(db, COL_POS_SALES_TRANSACTIONS, saleId));
    batch.delete(doc(db, COL_SALES, saleId));
  }
  await batch.commit();
  await appendPosAudit({
    type: "receipt_remove",
    message: "Padam resit void " + rno,
    userId: actor.userId || "",
    userName: actor.userName || "",
    role: actor.role || "",
    meta: { receiptNo: rno, orderId: orderId }
  });
  return { ok: true };
}

export async function shiftOpen(openingCash, auth) {
  auth = auth || {};
  try {
    await runTransaction(db, async function (transaction) {
      var countersRef = doc(db, COL_POS_META, "counters");
      var cSnap = await transaction.get(countersRef);
      var c = cSnap.exists() ? cSnap.data() : {};
      if (c.activeShiftDocId) {
        var exRef = doc(db, COL_POS_SHIFTS, String(c.activeShiftDocId));
        var ex = await transaction.get(exRef);
        if (ex.exists() && (ex.data().status || "") === "open") {
          throw new Error("Drawer sudah dibuka.");
        }
        transaction.set(
          countersRef,
          { activeShiftDocId: null, updatedAt: serverTimestamp() },
          { merge: true }
        );
      }
      var n = typeof openingCash === "number" ? openingCash : parseFloat(openingCash) || 0;
      var shiftRef = doc(collection(db, COL_POS_SHIFTS));
      var shiftCode = "SHF-" + Date.now();
      transaction.set(shiftRef, {
        shiftCode: shiftCode,
        status: "open",
        openedAt: serverTimestamp(),
        openingCash: Math.round(n * 100) / 100,
        closedAt: null,
        closing: null,
        openedByUserId: String(auth.userId || ""),
        openedByDisplayName: String(auth.userName || ""),
        openedByRole: String(auth.role || ""),
        openedWithOwnerBypass: !!auth.ownerBypass,
        updatedAt: serverTimestamp()
      });
      transaction.set(
        countersRef,
        {
          activeShiftDocId: shiftRef.id,
          updatedAt: serverTimestamp()
        },
        { merge: true }
      );
    });
    await appendPosAudit({
      type: "shift_open",
      message: "Shift opened",
      userId: auth.userId || "",
      userName: auth.userName || "",
      role: auth.role || "",
      meta: { ownerBypass: !!auth.ownerBypass }
    });
    return { ok: true, shift: getPosHubState().shift };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

export async function shiftCashMovement(type, amount, note, auditActor) {
  var countersRef = doc(db, COL_POS_META, "counters");
  var cSnap = await getDoc(countersRef);
  if (!cSnap.exists() || !cSnap.data().activeShiftDocId) return { ok: false, error: "Tiada drawer aktif." };
  var sid = String(cSnap.data().activeShiftDocId);
  var amt = typeof amount === "number" ? amount : parseFloat(amount) || 0;
  if (amt <= 0) return { ok: false, error: "Amaun tidak sah." };
  var act = auditActor || {};
  await addDoc(collection(db, COL_POS_SHIFTS, sid, "cash_movements"), {
    type: type === "out" ? "out" : "in",
    amount: Math.round(amt * 100) / 100,
    note: String(note || ""),
    createdAt: serverTimestamp()
  });
  await appendPosAudit({
    type: type === "out" ? "cash_out" : "cash_in",
    message: type === "out" ? "Cash out" : "Cash in",
    userId: act.userId || "",
    userName: act.userName || "",
    role: act.role || "",
    meta: { amount: Math.round(amt * 100) / 100, note: String(note || "") }
  });
  return { ok: true };
}

function ordersInCurrentShift(state) {
  if (!state.shift || !state.shift.openedAt) return [];
  var t0 = new Date(state.shift.openedAt).getTime();
  var t1 =
    state.shift.closing && state.shift.closing.closedAt
      ? new Date(state.shift.closing.closedAt).getTime()
      : null;
  return state.orders.filter(function (o) {
    if (!o.paidAt) return false;
    var pt = new Date(o.paidAt).getTime();
    if (pt < t0) return false;
    if (t1 != null && pt > t1) return false;
    return true;
  });
}

function isReceiptVoided(state, receiptNo) {
  var r = state.receipts.find(function (x) {
    return x.receiptNo === receiptNo;
  });
  return r && r.voided;
}

function sumCashSales(state) {
  var list = ordersInCurrentShift(state);
  return list.reduce(function (s, o) {
    if (o.paymentMethod === "cash" && o.lifecycle !== "cancelled" && !isReceiptVoided(state, o.receiptNo)) {
      return s + (typeof o.subtotal === "number" ? o.subtotal : 0);
    }
    return s;
  }, 0);
}

export function getExpectedDrawerCash() {
  var state = hubCache;
  if (!state.shift.isOpen) return 0;
  var open = state.shift.openingCash || 0;
  var mov = state.shift.movements.reduce(function (s, m) {
    var a = m.amount || 0;
    return s + (m.type === "out" ? -a : a);
  }, 0);
  return Math.round((open + sumCashSales(state) + mov) * 100) / 100;
}

export function getShiftSalesBreakdown() {
  var state = hubCache;
  var cash = 0;
  var qr = 0;
  var card = 0;
  var ewallet = 0;
  var total = 0;
  var scope = ordersInCurrentShift(state);
  scope.forEach(function (o) {
    if (o.lifecycle === "cancelled") return;
    if (isReceiptVoided(state, o.receiptNo)) return;
    var sub = typeof o.subtotal === "number" ? o.subtotal : 0;
    total += sub;
    if (o.paymentMethod === "cash") cash += sub;
    else if (o.paymentMethod === "duitnow") qr += sub;
    else if (o.paymentMethod === "card") card += sub;
    else if (o.paymentMethod === "ewallet") ewallet += sub;
  });
  return {
    total: Math.round(total * 100) / 100,
    cash: Math.round(cash * 100) / 100,
    duitnow: Math.round(qr * 100) / 100,
    card: Math.round(card * 100) / 100,
    ewallet: Math.round(ewallet * 100) / 100
  };
}

export async function shiftClose(p) {
  p = p || {};
  var actor = p.actor || {};
  var expected = getExpectedDrawerCash();
  var actual = typeof p.actualCount === "number" ? p.actualCount : parseFloat(p.actualCount) || 0;
  var variance = Math.round((actual - expected) * 100) / 100;
  var br = getShiftSalesBreakdown();
  var countersRef = doc(db, COL_POS_META, "counters");
  var cSnap = await getDoc(countersRef);
  if (!cSnap.exists() || !cSnap.data().activeShiftDocId) {
    return { ok: false, error: "Tiada drawer untuk ditutup." };
  }
  var sid = String(cSnap.data().activeShiftDocId);
  var sSnap = await getDoc(doc(db, COL_POS_SHIFTS, sid));
  if (!sSnap.exists()) return { ok: false, error: "Tiada drawer untuk ditutup." };
  var sd = sSnap.data();
  var closing = {
    shiftId: sd.shiftCode || sid,
    closedAt: new Date().toISOString(),
    expectedDrawer: expected,
    actualDrawer: Math.round(actual * 100) / 100,
    variance: variance,
    salesTotal: br.total,
    cashSales: br.cash,
    qrSales: br.duitnow,
    cardSales: br.card,
    ewalletSales: br.ewallet,
    refundNotes: p.refundNotes != null ? String(p.refundNotes) : "",
    closedWithOwnerBypass: !!p.ownerBypass
  };
  await runTransaction(db, async function (transaction) {
    var cref = doc(db, COL_POS_META, "counters");
    var tcs = await transaction.get(cref);
    var active = tcs.exists() && tcs.data().activeShiftDocId ? String(tcs.data().activeShiftDocId) : "";
    if (active !== sid) throw new Error("Drawer tidak sepadan.");
    var sref = doc(db, COL_POS_SHIFTS, sid);
    transaction.update(sref, {
      status: "closed",
      closedAt: serverTimestamp(),
      closing: closing,
      updatedAt: serverTimestamp()
    });
    transaction.set(
      cref,
      {
        activeShiftDocId: null,
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );
  });
  await appendPosAudit({
    type: "shift_close",
    message: "Shift closed",
    userId: actor.userId || "",
    userName: actor.userName || "",
    role: actor.role || "",
    meta: { variance: variance, ownerBypass: !!p.ownerBypass }
  });
  return { ok: true, closing: closing };
}

export function getOrdersByKitchenStage(stage) {
  var state = hubCache;
  return state.orders.filter(function (o) {
    return o.kitchenStage === stage && o.lifecycle !== "cancelled";
  });
}

export function orderPriorityFlag(order) {
  if (!order || !order.paidAt) return false;
  if (order.kitchenStage !== "waiting") return false;
  var t = new Date(order.paidAt).getTime();
  return Date.now() - t > 15 * 60 * 1000;
}

export function paymentMethodLabel(code) {
  var m = {
    cash: "Tunai",
    duitnow: "DuitNow QR",
    card: "Kad",
    ewallet: "eWallet"
  };
  return m[code] || code;
}

export { PROTOTYPE_MANAGER_PIN };

function stopFirestoreHubListeners() {
  unsubscribers.forEach(function (u) {
    try {
      u();
    } catch (e) {}
  });
  unsubscribers = [];
  if (movementsUnsub) {
    movementsUnsub();
    movementsUnsub = null;
  }
  lastShiftDocId = null;
}

function startFirestoreHubListeners() {
  stopFirestoreHubListeners();
  ensurePosCountersDoc().catch(function () {});

  var ordersQ = query(collection(db, COL_POS_ORDERS), orderBy("paidAt", "desc"), limit(150));
  unsubscribers.push(
    onSnapshot(ordersQ, function (snap) {
      var orders = snap.docs.map(mapOrderDoc);
      rebuildHubCache({ orders: orders });
    })
  );

  var receiptsQ = query(collection(db, COL_POS_RECEIPTS), orderBy("createdAt", "desc"), limit(150));
  unsubscribers.push(
    onSnapshot(receiptsQ, function (snap) {
      var receipts = snap.docs.map(mapReceiptDoc);
      rebuildHubCache({ receipts: receipts });
    })
  );

  var auditQ = query(collection(db, COL_POS_AUDIT), orderBy("at", "desc"), limit(500));
  unsubscribers.push(
    onSnapshot(auditQ, function (snap) {
      var auditLog = snap.docs.map(mapAuditDoc);
      rebuildHubCache({ auditLog: auditLog });
    })
  );

  var countersRef = doc(db, COL_POS_META, "counters");
  unsubscribers.push(
    onSnapshot(countersRef, function (snap) {
      var d = snap.exists() ? snap.data() : {};
      rebuildHubCache({
        seqOrder: typeof d.seqOrder === "number" ? d.seqOrder : 1000,
        seqReceipt: typeof d.seqReceipt === "number" ? d.seqReceipt : 1000
      });
    })
  );

  var openShiftQ = query(collection(db, COL_POS_SHIFTS), where("status", "==", "open"), limit(1));
  unsubscribers.push(
    onSnapshot(openShiftQ, function (snap) {
      if (snap.empty) {
        lastShiftDocId = null;
        if (movementsUnsub) {
          movementsUnsub();
          movementsUnsub = null;
        }
        rebuildHubCache({ shift: defaultShift() });
        return;
      }
      var sdoc = snap.docs[0];
      var header = buildShiftFromOpenDoc(sdoc);
      if (lastShiftDocId !== sdoc.id) {
        lastShiftDocId = sdoc.id;
        attachMovementsListener(sdoc.id, header);
      } else {
        rebuildHubCache({ shift: Object.assign({}, header, { movements: hubCache.shift.movements || [] }) });
      }
    })
  );
}
