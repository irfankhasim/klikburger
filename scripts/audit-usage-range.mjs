#!/usr/bin/env node
/**
 * Audit kuantiti resepi: mana yang julat (min ≠ max) dan mana yang tepat (min = max),
 * serta kesannya pada kos setiap produk. Baca sahaja — tiada tulisan ke Firestore.
 *
 *   node scripts/audit-usage-range.mjs
 */
import { ensureAdminInitialized, getAdminFirestore } from "./lib/admin-init.mjs";

var USAGE_NOMINAL_BIAS = 0.65;

/** Sepadan dengan parseUsageBounds() dalam js/cost-calculator/core.js. */
function bounds(usageVal, ingUnit) {
  if (usageVal == null) return null;
  if (typeof usageVal === "number") {
    return { min: usageVal, max: usageVal, nominal: usageVal, unit: ingUnit, isRange: false };
  }
  if (typeof usageVal !== "object") return null;

  var unit = usageVal.gunaUnit || ingUnit;
  var hasMin = usageVal.gunaMin != null && usageVal.gunaMin !== "";
  var hasMax = usageVal.gunaMax != null && usageVal.gunaMax !== "";

  if (hasMin || hasMax) {
    var mn = parseFloat(hasMin ? usageVal.gunaMin : usageVal.gunaMax) || 0;
    var mx = parseFloat(hasMax ? usageVal.gunaMax : usageVal.gunaMin) || 0;
    if (mx < mn) {
      var t = mn;
      mn = mx;
      mx = t;
    }
    var spread = mx > mn + 1e-12;
    var explicit = parseFloat(usageVal.guna);
    var nom =
      isFinite(explicit) && explicit > 0
        ? Math.min(Math.max(explicit, mn), mx)
        : spread
          ? mn + (mx - mn) * USAGE_NOMINAL_BIAS
          : mn;
    return { min: mn, max: mx, nominal: nom, unit: unit, isRange: spread };
  }

  var g = parseFloat(usageVal.guna) || 0;
  return { min: g, max: g, nominal: g, unit: unit, isRange: false };
}

/** Faktor tukar unit resepi → unit stok bahan. */
function unitFactor(fromUnit, toUnit) {
  var f = String(fromUnit || "").toLowerCase();
  var t = String(toUnit || "").toLowerCase();
  if (f === t) return 1;
  if (f === "g" && t === "kg") return 0.001;
  if (f === "kg" && t === "g") return 1000;
  if (f === "ml" && t === "l") return 0.001;
  if (f === "l" && t === "ml") return 1000;
  return 1;
}

async function main() {
  if (!ensureAdminInitialized()) {
    console.error("\n✗ Admin SDK tidak dimulakan.\n");
    process.exit(1);
  }
  var db = getAdminFirestore();

  var ingSnap = await db.collection("ingredients").get();
  var ings = {};
  ingSnap.docs.forEach(function (d) {
    ings[d.id] = Object.assign({ id: d.id }, d.data());
  });

  var modSnap = await db.collection("modifiers").get();

  console.log("\n=== 1. Kuantiti resepi setiap produk ===\n");
  var rangeLines = 0;
  var exactLines = 0;
  var orphanLines = 0;

  modSnap.docs.forEach(function (md) {
    var data = md.data();
    var usage = data.usage && typeof data.usage === "object" ? data.usage : {};
    var ids = Object.keys(usage);
    if (!ids.length) return;

    console.log("  " + (data.name || md.id) + (data.menuKind === "package" ? " [pakej]" : ""));
    ids.forEach(function (ingId) {
      var ing = ings[ingId];
      if (!ing) {
        console.log("      ⚠ bahan tiada dalam senarai: " + ingId);
        orphanLines++;
        return;
      }
      var b = bounds(usage[ingId], ing.unit);
      if (!b) return;
      if (b.isRange) {
        rangeLines++;
        console.log("      • " + ing.name + ": " + b.min + " – " + b.max + " " + b.unit + "  (julat)");
      } else {
        exactLines++;
        console.log("      • " + ing.name + ": " + b.min + " " + b.unit + "  (tepat)");
      }
    });
  });

  console.log(
    "\n  Julat: " + rangeLines + " baris | Tepat: " + exactLines + " baris" +
      (orphanLines ? " | Bahan hilang: " + orphanLines + " baris" : "")
  );

  console.log("\n=== 2. Kos produk (min – max) ===\n");
  modSnap.docs.forEach(function (md) {
    var data = md.data();
    if (data.menuKind === "package") return;
    var usage = data.usage && typeof data.usage === "object" ? data.usage : {};
    var cMin = 0;
    var cNom = 0;
    var cMax = 0;

    Object.keys(usage).forEach(function (ingId) {
      var ing = ings[ingId];
      if (!ing || !ing.purchaseQty) return;
      var per = ing.purchasePrice / ing.purchaseQty;
      var b = bounds(usage[ingId], ing.unit);
      if (!b) return;
      var f = unitFactor(b.unit, ing.unit);
      cMin += per * b.min * f;
      cNom += per * b.nominal * f;
      cMax += per * b.max * f;
    });

    var price = parseFloat(data.sellingPrice) || 0;
    var marginWorst = price > 0 ? ((price - cMax) / price) * 100 : 0;
    console.log(
      "  " +
        String(data.name || md.id).padEnd(26) +
        " harga=RM" +
        price.toFixed(2) +
        "  kos=RM" +
        cMin.toFixed(2) +
        "–RM" +
        cMax.toFixed(2) +
        " (nominal RM" +
        cNom.toFixed(2) +
        ")  margin terburuk=" +
        marginWorst.toFixed(1) +
        "%"
    );
  });

  console.log("");
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
