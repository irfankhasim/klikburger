/**
 * Data permulaan Klik Burger — bahan mentah (Firestore + lot FIFO + lejar),
 * rekod belian agregat, dan produk/menu `modifiers` dengan resipi (usage).
 *
 * Syarat: hanya dijalankan jika kedua-dua koleksi `ingredients` dan `modifiers` kosong,
 * supaya tidak overwrite data sedia. Kosongkan koleksi tersebut dalam Firestore jika mahu isi semula.
 */
import { db, collection, getDocs, Timestamp, addDoc, serverTimestamp } from "../../../shared/firebase/init.js";
import {
  COL_INGREDIENTS,
  COL_MODIFIERS,
  COL_PURCHASE_HISTORY
} from "../../../shared/firebase/collections.js";
import { addIngredient } from "./ingredients-repository.js";
import { addIngredientLedgerEntry } from "./ingredient-ledger-repository.js";
import { createPurchaseBatch } from "./ingredient-batch-repository.js";
import { addModifier } from "./modifiers-repository.js";
import { getIngredientCatalog, getProductTemplates, buildUsage } from "./burger-startup-seed-data.js";

var MS_DAY = 86400000;

function roundMoney(n) {
  return Math.round(n * 10000) / 10000;
}

function costPerUnitFrom(price, qty) {
  var q = typeof qty === "number" ? qty : parseFloat(qty) || 0;
  if (q <= 0) return 0;
  return roundMoney(price / q);
}

/**
 * @param {object} spec
 * @param {string} spec.slug
 * @param {string} spec.name
 * @param {string} spec.category
 * @param {string} spec.unit
 * @param {number} spec.listPurchasePrice — harga “pakej rujukan” terkini pada kad bahan
 * @param {number} spec.listPurchaseQty
 * @param {number} spec.sortIndex
 * @param {string} [spec.supplier]
 * @param {number} [spec.minStockQty]
 * @param {string} [spec.stockStatus]
 * @param {Array<{
 *   qtyRemaining:number,
 *   qtyOriginal?:number,
 *   totalRm:number,
 *   daysAgoPurchase:number,
 *   daysAgoOpened?:number,
 *   ledgerKind?:string,
 *   supplierBatchCode?:string,
 *   daysToExpiry?:number,
 *   ledgerNotes?:string
 * }>} spec.batchesSpec
 */
async function seedOneIngredient(spec, purchaseLines) {
  var supplier = spec.supplier || "Pembekal utama (seed)";
  var ref = await addIngredient({
    sortIndex: spec.sortIndex,
    name: spec.name,
    purchasePrice: spec.listPurchasePrice,
    purchaseQty: spec.listPurchaseQty,
    unit: spec.unit,
    category: spec.category,
    supplier: supplier,
    minStockQty: typeof spec.minStockQty === "number" ? spec.minStockQty : 0,
    stockStatus: spec.stockStatus || "ok"
  });
  var id = ref.id;
  var name = spec.name;
  var unit = spec.unit;

  for (var i = 0; i < spec.batchesSpec.length; i++) {
    var b = spec.batchesSpec[i];
    var qOrig = b.qtyOriginal != null ? b.qtyOriginal : b.qtyRemaining;
    var cpu = costPerUnitFrom(b.totalRm, qOrig);
    var purchaseAt = Timestamp.fromMillis(Date.now() - (b.daysAgoPurchase || 0) * MS_DAY);
    var openedAt =
      b.daysAgoOpened != null
        ? Timestamp.fromMillis(Date.now() - b.daysAgoOpened * MS_DAY)
        : purchaseAt;
    var ledgerRef = await addIngredientLedgerEntry({
      ingredientId: id,
      kind: b.ledgerKind || (i === 0 ? "initial" : "purchase"),
      occurredAt: purchaseAt,
      purchasePrice: b.totalRm,
      purchaseQty: qOrig,
      unit: unit,
      costPerUnit: cpu,
      nameSnapshot: name,
      notes: b.ledgerNotes || "",
      supplier: supplier
    });
    var expiryAt =
      typeof b.daysToExpiry === "number"
        ? Timestamp.fromMillis(openedAt.toMillis() + b.daysToExpiry * MS_DAY)
        : null;
    await createPurchaseBatch({
      ingredientId: id,
      qtyRemaining: b.qtyRemaining,
      qtyOriginal: qOrig,
      costPerUnit: cpu,
      purchaseTotalRm: b.totalRm,
      purchaseOccurredAt: purchaseAt,
      purchaseUnit: unit,
      ledgerEntryId: ledgerRef.id,
      openedAtOverride: openedAt,
      expiryAt: expiryAt,
      supplierBatchCode: b.supplierBatchCode || "SEED-" + String(spec.slug).toUpperCase() + "-" + (i + 1)
    });
    purchaseLines.push({
      ingredientId: id,
      label: name,
      qty: qOrig,
      unit: unit,
      unitCost: cpu,
      lineTotal: roundMoney(b.totalRm)
    });
  }
  return id;
}

/**
 * @returns {Promise<{ ok: boolean, skipped?: boolean, reason?: string, counts?: object, error?: string }>}
 */
export async function runBurgerStartupSeed() {
  var ingSnap = await getDocs(collection(db, COL_INGREDIENTS));
  var modSnap = await getDocs(collection(db, COL_MODIFIERS));
  if (!ingSnap.empty || !modSnap.empty) {
    return {
      ok: false,
      skipped: true,
      reason:
        "Koleksi `ingredients` atau `modifiers` tidak kosong. Kosongkan kedua-duanya dalam Firestore (dan `ingredient_batches` / `ingredient_ledger` berkaitan jika perlu) untuk seed bersih."
    };
  }

  var slugToId = {};
  var purchaseLines = [];
  var catalog = getIngredientCatalog();

  try {
    for (var i = 0; i < catalog.length; i++) {
      var spec = catalog[i];
      var id = await seedOneIngredient(spec, purchaseLines);
      slugToId[spec.slug] = id;
    }

    function inferSeedMenuCategory(tpl) {
      if (tpl.sortIndex >= 200) return "addon";
      var n = String(tpl.name || "").toLowerCase();
      if (n.indexOf("kentang") !== -1) return "fries";
      if (n.indexOf("obolong") !== -1) return "oblong";
      if (n.indexOf("benjo") !== -1) return "benjo";
      return "burger";
    }

    var productTemplates = getProductTemplates();
    for (var p = 0; p < productTemplates.length; p++) {
      var tpl = productTemplates[p];
      await addModifier({
        name: tpl.name,
        sellingPrice: tpl.sellingPrice,
        sortIndex: tpl.sortIndex,
        usage: buildUsage(slugToId, tpl.usageParts),
        menuKind: "single",
        menuCategory: inferSeedMenuCategory(tpl),
        packageLines: [],
        seededFrom: "burger-startup-seed-v1"
      });
    }

    var phTotal = purchaseLines.reduce(function (s, row) {
      return s + (typeof row.lineTotal === "number" ? row.lineTotal : 0);
    }, 0);
    phTotal = roundMoney(phTotal);

    await addDoc(collection(db, COL_PURCHASE_HISTORY), {
      createdAt: serverTimestamp(),
      totalAmount: phTotal,
      supplier: "Pelbagai pembekal (stok permulaan seed)",
      notes:
        "Rekod agregat permulaan daripada skrip burger-startup-seed — sepadan dengan entri `ingredient_ledger` + `ingredient_batches`.",
      lines: purchaseLines.map(function (row) {
        return {
          ingredientId: row.ingredientId,
          label: row.label,
          qty: row.qty,
          unit: row.unit,
          unitCost: row.unitCost,
          lineTotal: row.lineTotal
        };
      })
    });

    return {
      ok: true,
      counts: {
        ingredients: catalog.length,
        modifiers: productTemplates.length,
        purchaseHistoryLines: purchaseLines.length
      }
    };
  } catch (err) {
    console.error(err);
    return {
      ok: false,
      error: err && err.message ? err.message : String(err),
      code: err && err.code ? err.code : undefined
    };
  }
}
