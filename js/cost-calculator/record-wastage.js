/**
 * Rekod wastage: tolak stok dari lot belian yang dipilih + baris ingredient_ledger.
 * Kos = costPerUnit lot itu (harga belian semasa lot dibuka), bukan harga semasa katalog.
 */
import {
  db,
  collection,
  doc,
  getDocs,
  runTransaction,
  query,
  where,
  Timestamp,
  serverTimestamp
} from "../firebase/init.js";
import { COL_INGREDIENT_BATCHES, COL_INGREDIENT_LEDGER } from "../firebase/collections.js";
import { convertToBase } from "./core.js";

function codedError(code, message) {
  var err = new Error(message);
  err.code = code;
  return err;
}

function num(v) {
  return typeof v === "number" ? v : parseFloat(v) || 0;
}

function round4(n) {
  return Math.round(n * 10000) / 10000;
}

async function fetchBatchRefs(ingredientId) {
  var refs = [];
  var q = query(collection(db, COL_INGREDIENT_BATCHES), where("ingredientId", "==", ingredientId));
  var snap = await getDocs(q);
  snap.forEach(function (d) {
    refs.push(d.ref);
  });
  return refs;
}

/**
 * @param {object} opts
 * @param {string} opts.ingredientId
 * @param {string} opts.batchId lot belian yang dibuang
 * @param {number} opts.qty
 * @param {string} [opts.unit] unit input; ditukar ke unit stok bahan jika mass/volume
 * @param {string} [opts.stockUnit] unit pada dokumen ingredients
 * @param {string} [opts.reason] burnt | spoiled | dropped | other
 * @param {string} [opts.notes]
 * @param {string} [opts.nameSnapshot]
 */
export async function recordIngredientWastage(opts) {
  var ingredientId = String((opts && opts.ingredientId) || "");
  var batchId = String((opts && opts.batchId) || "");
  var qtyIn = typeof opts.qty === "number" ? opts.qty : parseFloat(opts.qty) || 0;
  var stockUnit = String((opts && opts.stockUnit) || (opts && opts.unit) || "");
  var inputUnit = String((opts && opts.unit) || stockUnit || "");
  var reason = String((opts && opts.reason) || "other");
  var notes = String((opts && opts.notes) || "").trim();
  var nameSnapshot = String((opts && opts.nameSnapshot) || "");

  if (!ingredientId) throw codedError("need-ingredient", "Bahan diperlukan.");
  if (!batchId) throw codedError("need-lot", "Lot belian diperlukan.");
  if (!(qtyIn > 0)) throw codedError("bad-qty", "Kuantiti wastage mesti lebih daripada 0.");

  var qtyNeed = convertToBase(qtyIn, inputUnit, stockUnit || inputUnit);
  if (!(qtyNeed > 0)) throw codedError("bad-qty", "Kuantiti wastage mesti lebih daripada 0.");

  var MAX_ATTEMPT = 8;
  var lastErr = null;
  for (var attempt = 0; attempt < MAX_ATTEMPT; attempt++) {
    try {
      var batchRefs = await fetchBatchRefs(ingredientId);
      var result = await runTransaction(db, async function (transaction) {
        var states = [];
        for (var i = 0; i < batchRefs.length; i++) {
          var snap = await transaction.get(batchRefs[i]);
          if (!snap.exists()) continue;
          var dat = snap.data();
          states.push({
            ref: batchRefs[i],
            id: snap.id,
            ingredientId: String(dat.ingredientId || ""),
            qtyRemaining: num(dat.qtyRemaining),
            costPerUnit: num(dat.costPerUnit),
            openedAt: dat.openedAt || null,
            purchaseOccurredAt: dat.purchaseOccurredAt || null,
            synthetic: dat.synthetic === true
          });
        }

        var lot = null;
        for (var s = 0; s < states.length; s++) {
          if (states[s].id === batchId) {
            lot = states[s];
            break;
          }
        }
        if (!lot || lot.ingredientId !== ingredientId) {
          throw Object.assign(new Error("LOT"), { code: "missing-batch" });
        }
        if (!(lot.qtyRemaining > 1e-9)) {
          throw Object.assign(new Error("STOCK"), { code: "insufficient-batch", remain: qtyNeed });
        }
        if (qtyNeed > lot.qtyRemaining + 1e-6) {
          throw Object.assign(new Error("STOCK"), {
            code: "insufficient-batch",
            remain: qtyNeed - lot.qtyRemaining
          });
        }

        var take = qtyNeed;
        var fifoCost = round4(take * lot.costPerUnit);
        var nextQty = round4(lot.qtyRemaining - take);
        if (nextQty < 1e-9) nextQty = 0;
        transaction.update(lot.ref, { qtyRemaining: nextQty });

        var ledgerRef = doc(collection(db, COL_INGREDIENT_LEDGER));
        transaction.set(ledgerRef, {
          ingredientId: ingredientId,
          kind: "wastage",
          reason: reason,
          occurredAt: Timestamp.now(),
          createdAt: serverTimestamp(),
          purchaseQty: take,
          purchasePrice: fifoCost,
          unit: stockUnit || inputUnit,
          costPerUnit: lot.costPerUnit,
          batchId: lot.id,
          batchAllocations: [
            {
              batchId: lot.id,
              qty: take,
              costPerUnit: lot.costPerUnit,
              costRm: fifoCost,
              openedAt: lot.openedAt,
              purchaseOccurredAt: lot.purchaseOccurredAt,
              synthetic: lot.synthetic === true
            }
          ],
          notes: notes.slice(0, 120),
          nameSnapshot: nameSnapshot
        });

        return {
          ledgerId: ledgerRef.id,
          qty: take,
          costRm: Math.round(fifoCost * 100) / 100,
          costPerUnit: lot.costPerUnit,
          batchId: lot.id
        };
      });
      return result;
    } catch (err) {
      lastErr = err;
      if (err && err.code === "missing-batch") {
        throw codedError("missing-batch", "Lot belian tidak dijumpai. Pilih lot yang masih ada baki.");
      }
      if (err && err.code === "insufficient-batch") {
        throw codedError("insufficient-batch", "Kuantiti melebihi baki lot belian ini.");
      }
      if (err && err.code === "failed-precondition") continue;
      if (err && err.code === "aborted") continue;
      throw err;
    }
  }
  throw lastErr || codedError("retry", "Gagal rekod wastage selepas beberapa percubaan.");
}
