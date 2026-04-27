/**
 * Logik seed burger (bahan, modifiers, purchase_history) — dipanggil oleh setup / CLI.
 * @param {FirebaseFirestore.Firestore} db
 * @param {{ force?: boolean }} opts
 */
import { getIngredientCatalog, getProductTemplates, buildUsage } from "../../js/cost-calculator/burger-startup-seed-data.js";
import {
  COL_INGREDIENTS,
  COL_MODIFIERS,
  COL_INGREDIENT_LEDGER,
  COL_INGREDIENT_BATCHES,
  COL_PURCHASE_HISTORY
} from "../../js/firebase/collections.js";

function roundMoney(n) {
  return Math.round(n * 10000) / 10000;
}

function costPerUnitFrom(price, qty) {
  var q = typeof qty === "number" ? qty : parseFloat(qty) || 0;
  if (q <= 0) return 0;
  return roundMoney(price / q);
}

export async function runBurgerCatalogSeed(db, adminFieldValue, adminTimestamp, opts) {
  opts = opts || {};
  var FieldValue = adminFieldValue;
  var Timestamp = adminTimestamp;
  var MS_DAY = 86400000;

  if (!opts.force) {
    var ingSnap = await db.collection(COL_INGREDIENTS).limit(1).get();
    var modSnap = await db.collection(COL_MODIFIERS).limit(1).get();
    if (!ingSnap.empty || !modSnap.empty) {
      console.log("  (langkau burger catalog — ingredients/modifiers sudah ada)");
      return { skipped: true };
    }
  }

  async function seedOneIngredientAdmin(spec, purchaseLines) {
    var supplier = spec.supplier || "Pembekal utama (seed)";
    var ingRef = await db.collection(COL_INGREDIENTS).add({
      sortIndex: spec.sortIndex,
      name: spec.name,
      purchasePrice: spec.listPurchasePrice,
      purchaseQty: spec.listPurchaseQty,
      unit: spec.unit,
      category: spec.category,
      supplier: supplier,
      minStockQty: typeof spec.minStockQty === "number" ? spec.minStockQty : 0,
      stockStatus: spec.stockStatus || "ok",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
    var id = ingRef.id;
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
      var ledgerRef = await db.collection(COL_INGREDIENT_LEDGER).add({
        ingredientId: id,
        kind: b.ledgerKind || (i === 0 ? "initial" : "purchase"),
        occurredAt: purchaseAt,
        purchasePrice: b.totalRm,
        purchaseQty: qOrig,
        unit: unit,
        costPerUnit: cpu,
        nameSnapshot: name,
        notes: b.ledgerNotes || "",
        supplier: supplier,
        createdAt: FieldValue.serverTimestamp()
      });
      var expiryAt =
        typeof b.daysToExpiry === "number"
          ? Timestamp.fromMillis(openedAt.toMillis() + b.daysToExpiry * MS_DAY)
          : null;
      var totalRm =
        typeof b.totalRm === "number" && !isNaN(b.totalRm)
          ? b.totalRm
          : Math.round(cpu * qOrig * 10000) / 10000;

      var batchPayload = {
        ingredientId: id,
        qtyRemaining: b.qtyRemaining,
        qtyOriginal: qOrig,
        costPerUnit: cpu,
        openedAt: openedAt,
        purchaseOccurredAt: purchaseAt,
        purchaseTotalRm: totalRm,
        purchaseUnit: unit,
        ledgerEntryId: ledgerRef.id,
        synthetic: false,
        createdAt: FieldValue.serverTimestamp()
      };
      if (expiryAt != null) batchPayload.expiryAt = expiryAt;
      var code = b.supplierBatchCode || "SEED-" + String(spec.slug).toUpperCase() + "-" + (i + 1);
      if (code) batchPayload.supplierBatchCode = String(code);
      await db.collection(COL_INGREDIENT_BATCHES).add(batchPayload);

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

  var slugToId = {};
  var purchaseLines = [];
  var catalog = getIngredientCatalog();

  for (var i = 0; i < catalog.length; i++) {
    var spec = catalog[i];
    var id = await seedOneIngredientAdmin(spec, purchaseLines);
    slugToId[spec.slug] = id;
  }

  var productTemplates = getProductTemplates();
  for (var p = 0; p < productTemplates.length; p++) {
    var tpl = productTemplates[p];
    await db.collection(COL_MODIFIERS).add({
      name: tpl.name,
      sellingPrice: tpl.sellingPrice,
      sortIndex: tpl.sortIndex,
      usage: buildUsage(slugToId, tpl.usageParts),
      menuCategory: tpl.sortIndex >= 200 ? "Tambahan" : "Menu utama",
      seededFrom: "burger-startup-seed-v1"
    });
  }

  var phTotal = roundMoney(
    purchaseLines.reduce(function (s, row) {
      return s + row.lineTotal;
    }, 0)
  );
  await db.collection(COL_PURCHASE_HISTORY).add({
    createdAt: FieldValue.serverTimestamp(),
    totalAmount: phTotal,
    supplier: "Pelbagai pembekal (stok permulaan seed)",
    notes:
      "Rekod agregat permulaan — seed terminal (firebase-admin); sepadan dengan ingredient_ledger + ingredient_batches.",
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

  console.log("  burger catalog:", catalog.length, "bahan,", productTemplates.length, "produk");
  return { skipped: false, ingredients: catalog.length, modifiers: productTemplates.length, purchaseTotalRm: phTotal };
}
