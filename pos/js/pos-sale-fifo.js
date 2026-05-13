/**
 * Jualan POS + tolak stok FIFO + rekod COGS pada dokumen `sales`.
 */
import {
  db,
  collection,
  doc,
  getDoc,
  getDocs,
  runTransaction,
  query,
  where,
  serverTimestamp
} from "../../shared/firebase/init.js";
import { COL_INGREDIENTS, COL_INGREDIENT_BATCHES, COL_SALES, COL_POS_META } from "../../shared/firebase/collections.js";
import { createPurchaseBatch, compareFifoBatches } from "../../js/cost-calculator/ingredient-batch-repository.js";
import { usageBaseQty } from "../../js/cost-calculator/core.js";
import { appendCheckoutInTransaction } from "./pos-checkout-firestore-writer.js";

/**
 * Agregat keperluan bahan (unit asas bahan) untuk satu troli.
 * @param {Record<string, object>} ingredientsById
 * @param {Array<{id:string,qty:number}>} cart
 * @param {Record<string, {usage:object}>} modifiersById
 */
export function aggregateCartConsumption(ingredientsById, cart, modifiersById) {
  var totalByIng = {};
  cart.forEach(function (line) {
    var p = modifiersById[line.id];
    if (!p || !p.usage) return;
    var q = typeof line.qty === "number" ? line.qty : parseFloat(line.qty) || 0;
    if (q <= 0) return;
    Object.keys(p.usage).forEach(function (ingId) {
      var ing = ingredientsById[ingId];
      if (!ing) return;
      var base = usageBaseQty(ing, p.usage[ingId]);
      if (!base) return;
      totalByIng[ingId] = (totalByIng[ingId] || 0) + base * q;
    });
  });
  return totalByIng;
}

async function fetchBatchRefsForIngredients(ingredientIds) {
  var refs = [];
  var seen = {};
  for (var i = 0; i < ingredientIds.length; i++) {
    var id = ingredientIds[i];
    var q = query(collection(db, COL_INGREDIENT_BATCHES), where("ingredientId", "==", id));
    var snap = await getDocs(q);
    snap.forEach(function (d) {
      if (!seen[d.id]) {
        seen[d.id] = true;
        refs.push(d.ref);
      }
    });
  }
  return refs;
}

/**
 * Jika tiada batch aktif, cipta satu lot daripada snapshot `ingredients` semasa (migrasi lembut).
 */
export async function ensureSyntheticBatchIfNeeded(ingredientId) {
  var id = String(ingredientId || "");
  if (!id) return;
  var q = query(collection(db, COL_INGREDIENT_BATCHES), where("ingredientId", "==", id));
  var snap = await getDocs(q);
  var hasPositive = false;
  snap.forEach(function (d) {
    var r = d.data().qtyRemaining;
    var n = typeof r === "number" ? r : parseFloat(r) || 0;
    if (n > 0) hasPositive = true;
  });
  if (hasPositive) return;
  var ingSnap = await getDoc(doc(db, COL_INGREDIENTS, id));
  if (!ingSnap.exists()) return;
  var ing = ingSnap.data();
  var qty = typeof ing.purchaseQty === "number" ? ing.purchaseQty : parseFloat(ing.purchaseQty) || 0;
  if (qty <= 0) {
    throw new Error(
      "Tiada lot stok ??? Tambah belian atau semak rujukan pakej."
    );
  }
  var price = typeof ing.purchasePrice === "number" ? ing.purchasePrice : parseFloat(ing.purchasePrice) || 0;
  var cpu = price / qty;
  await createPurchaseBatch({
    ingredientId: id,
    qtyRemaining: qty,
    qtyOriginal: qty,
    costPerUnit: cpu,
    synthetic: true
  });
}

/**
 * Simulasi FIFO pada salinan keadaan batch (selepas baca transaksi).
 */
function takeFifoCost(batchesById, ingId, qtyNeed) {
  var cost = 0;
  var remain = qtyNeed;
  var list = batchesById
    .filter(function (b) {
      return b.ingredientId === ingId && b.qtyRemaining > 0;
    })
    .sort(compareFifoBatches);
  for (var i = 0; i < list.length && remain > 1e-9; i++) {
    var b = list[i];
    var take = Math.min(b.qtyRemaining, remain);
    cost += take * b.costPerUnit;
    b.qtyRemaining -= take;
    remain -= take;
  }
  if (remain > 1e-6) {
    return { ok: false, cost: 0, remain: remain };
  }
  return { ok: true, cost: cost, remain: 0 };
}

/**
 * @param {object} opts
 * @param {Array<{id:string,name:string,price:number,qty:number}>} opts.cart
 * @param {Record<string, object>} opts.modifiersById ??? hasil docToProduct keyed by id
 * @param {Array<object>} opts.ingredientsList ??? docToIngredient[]
 * @param {string} [opts.table]
 * @param {string} [opts.customerName]
 * @param {string} [opts.notes]
 * @param {string} [opts.staffId] ??? kakitangan di kaunter (prestasi / audit)
 * @param {string} [opts.staffName]
 * @param {'cash'|'duitnow'} [opts.paymentMethod]
 * @param {number|null} [opts.tendered]
 * @param {number|null} [opts.changeDue]
 * @param {boolean} [opts.drawerOpenedSimulated]
 */
export async function finalizePosSaleFifo(opts) {
  var cart = opts.cart || [];
  var modifiersById = opts.modifiersById || {};
  var ingredientsList = opts.ingredientsList || [];
  if (!cart.length) throw new Error("Troli kosong.");

  var ingredientsById = {};
  ingredientsList.forEach(function (ing) {
    ingredientsById[ing.id] = ing;
  });

  var totalByIng = aggregateCartConsumption(ingredientsById, cart, modifiersById);
  var ingIds = Object.keys(totalByIng);
  if (!ingIds.length) {
    throw new Error("Tiada resipi bahan pada produk dalam troli ??? semak Produk & kos.");
  }

  for (var e = 0; e < ingIds.length; e++) {
    await ensureSyntheticBatchIfNeeded(ingIds[e]);
  }

  var MAX_ATTEMPT = 8;
  var lastErr = null;
  for (var attempt = 0; attempt < MAX_ATTEMPT; attempt++) {
    try {
      var batchRefs = await fetchBatchRefsForIngredients(ingIds);
      var result = await runTransaction(db, async function (transaction) {
        var countersRef = doc(db, COL_POS_META, "counters");
        var countersSnap = await transaction.get(countersRef);
        var states = [];
        for (var i = 0; i < batchRefs.length; i++) {
          var snap = await transaction.get(batchRefs[i]);
          if (snap.exists()) {
            var dat = snap.data();
            states.push({
              ref: batchRefs[i],
              id: snap.id,
              ingredientId: String(dat.ingredientId || ""),
              qtyRemaining: typeof dat.qtyRemaining === "number" ? dat.qtyRemaining : parseFloat(dat.qtyRemaining) || 0,
              costPerUnit: typeof dat.costPerUnit === "number" ? dat.costPerUnit : parseFloat(dat.costPerUnit) || 0,
              openedAt: dat.openedAt
            });
          }
        }

        var working = states.map(function (s) {
          return {
            ref: s.ref,
            id: s.id,
            ingredientId: s.ingredientId,
            qtyRemaining: s.qtyRemaining,
            costPerUnit: s.costPerUnit,
            openedAt: s.openedAt
          };
        });

        var saleLines = [];
        var subtotal = 0;

        for (var c = 0; c < cart.length; c++) {
          var line = cart[c];
          var p = modifiersById[line.id];
          if (!p) {
            throw Object.assign(new Error("MISSING_MOD"), { code: "missing-modifier", modifierId: line.id });
          }
          var lineQty = typeof line.qty === "number" ? line.qty : parseFloat(line.qty) || 0;
          var unitPrice = typeof line.price === "number" ? line.price : parseFloat(line.price) || 0;
          var lineTotal = unitPrice * lineQty;
          subtotal += lineTotal;
          var lineCogs = 0;
          if (p.usage) {
            Object.keys(p.usage).forEach(function (ingId) {
              var ing = ingredientsById[ingId];
              if (!ing) return;
              var need = usageBaseQty(ing, p.usage[ingId]) * lineQty;
              if (need <= 0) return;
              var r = takeFifoCost(working, ingId, need);
              if (!r.ok) {
                throw Object.assign(new Error("STOCK"), {
                  code: "insufficient-batch",
                  ingId: ingId,
                  ingName: ing.name || ingId,
                  remain: r.remain
                });
              }
              lineCogs += r.cost;
            });
          }
          saleLines.push({
            modifierId: line.id,
            name: line.name || p.name || "",
            qty: lineQty,
            unitPrice: unitPrice,
            lineTotal: lineTotal,
            cogsFifo: Math.round(lineCogs * 10000) / 10000,
            grossProfitFifo: Math.round((lineTotal - lineCogs) * 10000) / 10000
          });
        }

        var totalCogs = saleLines.reduce(function (s, x) {
          return s + (typeof x.cogsFifo === "number" ? x.cogsFifo : 0);
        }, 0);
        totalCogs = Math.round(totalCogs * 10000) / 10000;

        for (var u = 0; u < states.length; u++) {
          var orig = states[u];
          var w = working.find(function (x) {
            return x.id === orig.id;
          });
          if (!w) continue;
          if (w.qtyRemaining !== orig.qtyRemaining) {
            transaction.update(orig.ref, { qtyRemaining: w.qtyRemaining });
          }
        }

        var saleRef = doc(collection(db, COL_SALES));
        transaction.set(saleRef, {
          createdAt: serverTimestamp(),
          subtotal: Math.round(subtotal * 100) / 100,
          totalCogsFifo: totalCogs,
          totalGrossProfitFifo: Math.round((subtotal - totalCogs) * 100) / 100,
          lines: saleLines,
          table: opts.table || "",
          customerName: opts.customerName || "",
          notes: opts.notes || "",
          staffId: opts.staffId ? String(opts.staffId) : "",
          staffName: opts.staffName ? String(opts.staffName) : ""
        });

        var checkout = appendCheckoutInTransaction(transaction, countersSnap, {
          saleRef: saleRef,
          saleId: saleRef.id,
          saleLines: saleLines,
          subtotal: Math.round(subtotal * 100) / 100,
          totalCogsFifo: totalCogs,
          paymentMethod: opts.paymentMethod || "cash",
          tendered: opts.tendered != null ? opts.tendered : null,
          changeDue: opts.changeDue != null ? opts.changeDue : null,
          drawerOpenedSimulated: !!opts.drawerOpenedSimulated,
          staffId: opts.staffId ? String(opts.staffId) : "",
          staffName: opts.staffName ? String(opts.staffName) : "",
          customerName: opts.customerName != null ? String(opts.customerName) : ""
        });

        return {
          saleId: saleRef.id,
          subtotal: subtotal,
          totalCogsFifo: totalCogs,
          lines: saleLines,
          order: checkout.order,
          receipt: checkout.receipt
        };
      });
      return result;
    } catch (err) {
      lastErr = err;
      if (err && err.code === "insufficient-batch") {
        throw new Error(
          "Stok batch tidak mencukupi untuk " + (err.ingName || "bahan") + ". Rekod pembelian baharu di lejar bahan."
        );
      }
      if (err && err.code === "missing-modifier") {
        throw new Error("Menu tidak sepadan dengan troli ??? muat semula halaman POS.");
      }
      if (err && err.code === "failed-precondition") continue;
      if (err && err.code === "aborted") continue;
      throw err;
    }
  }
  throw lastErr || new Error("Transaksi jualan gagal selepas beberapa percubaan.");
}
