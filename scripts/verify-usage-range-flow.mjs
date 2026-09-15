#!/usr/bin/env node
/**
 * Ujian aliran julat kuantiti — tiada Firestore, logik tulen sahaja.
 *
 *   node scripts/verify-usage-range-flow.mjs
 */
import {
  USAGE_NOMINAL_BIAS,
  parseUsageBounds,
  usageBaseQty,
  usageBaseQtyMin,
  usageBaseQtyMax,
  productCost,
  productCostRange,
  formatUsageSummary
} from "../js/cost-calculator/core.js";
import { enrichProductsWithResolvedUsage } from "../js/cost-calculator/package-resolved-usage.js";

var pass = 0;
var fail = 0;

function near(a, b, tol) {
  return Math.abs(a - b) <= (tol == null ? 1e-6 : tol);
}

function check(label, actual, expected, tol) {
  var ok = typeof expected === "number" ? near(actual, expected, tol) : actual === expected;
  if (ok) {
    pass++;
    console.log("  ✓ " + label + " = " + actual);
  } else {
    fail++;
    console.log("  ✗ " + label + " = " + actual + " (jangka " + expected + ")");
  }
}

var sosCili = { id: "sos", name: "Sos Cili", unit: "ml", purchasePrice: 6.5, purchaseQty: 500 };
var salad = { id: "salad", name: "Salad", unit: "kg", purchasePrice: 8, purchaseQty: 1 };
var patty = { id: "patty", name: "Patty Daging", unit: "pcs", purchasePrice: 55, purchaseQty: 50 };
var ings = [sosCili, salad, patty];

console.log("\n1) Keserasian ke belakang — nilai lama mesti kekal sama\n");
check("nombor legacy 1 → nominal", usageBaseQty(patty, 1), 1);
check("nombor legacy 1 → min", usageBaseQtyMin(patty, 1), 1);
check("nombor legacy 1 → max", usageBaseQtyMax(patty, 1), 1);
check("objek tetap { guna: 20 } → nominal", usageBaseQty(sosCili, { guna: 20, gunaUnit: "ml" }), 20);
check(
  "objek tetap min = max",
  usageBaseQtyMax(sosCili, { guna: 20, gunaUnit: "ml" }) -
    usageBaseQtyMin(sosCili, { guna: 20, gunaUnit: "ml" }),
  0
);

console.log("\n2) Julat — nominal berbias ke arah max\n");
var range = { gunaMin: 20, gunaMax: 30, gunaUnit: "ml" };
check("min", usageBaseQtyMin(sosCili, range), 20);
check("max", usageBaseQtyMax(sosCili, range), 30);
check("nominal (bias " + USAGE_NOMINAL_BIAS + ")", usageBaseQty(sosCili, range), 20 + 10 * USAGE_NOMINAL_BIAS);
check("nominal antara min dan max", usageBaseQty(sosCili, range) > 20 && usageBaseQty(sosCili, range) < 30, true);
check("ringkasan paparan", formatUsageSummary(sosCili, range), "Sos Cili (20–30 ml)");

console.log("\n3) Penukaran unit resipi → unit stok (g dalam bahan kg)\n");
var saladRange = { gunaMin: 18, gunaMax: 29, gunaUnit: "g" };
check("min dalam kg", usageBaseQtyMin(salad, saladRange), 0.018);
check("max dalam kg", usageBaseQtyMax(salad, saladRange), 0.029);

console.log("\n4) Kos produk tunggal — min ≤ nominal ≤ max\n");
var burger = { id: "b1", name: "Burger", sellingPrice: 6, usage: { patty: 1, sos: range, salad: saladRange } };
var cr = productCostRange(ings, burger);
check("kos min", cr.min, 1.1 + 20 * 0.013 + 0.018 * 8);
check("kos max", cr.max, 1.1 + 30 * 0.013 + 0.029 * 8);
check("min ≤ nominal", cr.min <= cr.nominal, true);
check("nominal ≤ max", cr.nominal <= cr.max, true);
check("productCost() lalai = nominal", productCost(ings, burger), cr.nominal);
check("hasRange dikesan", cr.max > cr.min, true);

console.log("\n5) Pakej — julat mesti dikekalkan selepas agregat\n");
var fries = { id: "f1", name: "Fries", menuKind: "single", usage: { salad: saladRange } };
var combo = {
  id: "c1",
  name: "Combo",
  menuKind: "package",
  sellingPrice: 10,
  packageLines: [
    { modifierId: "b1", qty: 1 },
    { modifierId: "f1", qty: 2 }
  ],
  usage: {}
};
var enriched = enrichProductsWithResolvedUsage([burger, fries, combo], ings);
var comboOut = enriched.filter(function (p) {
  return p.id === "c1";
})[0];
var comboRange = productCostRange(ings, comboOut);
var expectedMin = cr.min + 2 * (0.018 * 8);
var expectedMax = cr.max + 2 * (0.029 * 8);
check("kos pakej min", comboRange.min, expectedMin);
check("kos pakej max", comboRange.max, expectedMax);
check("pakej masih berjulat (bukan diratakan)", comboRange.max > comboRange.min, true);
check(
  "nominal pakej = jumlah nominal komponen",
  comboRange.nominal,
  cr.nominal + 2 * usageBaseQty(salad, saladRange) * 8
);

console.log("\n6) Produk tunggal tidak diubah oleh enrichment\n");
var burgerOut = enriched.filter(function (p) {
  return p.id === "b1";
})[0];
check("julat sos kekal", JSON.stringify(burgerOut.usage.sos), JSON.stringify(range));
check("kos tunggal tidak berubah", productCostRange(ings, burgerOut).max, cr.max);

console.log("\n7) Kapasiti stok guna max (elak jual lebih)\n");
var stockMl = 300;
var unitsByMax = Math.floor(stockMl / usageBaseQtyMax(sosCili, range));
var unitsByNominal = Math.floor(stockMl / usageBaseQty(sosCili, range));
check("unit ikut max lebih konservatif", unitsByMax <= unitsByNominal, true);
check("unit ikut max", unitsByMax, 10);

console.log("\n8) Julat rosak / terbalik dikendalikan\n");
check("max < min ditukar ganti", usageBaseQtyMin(sosCili, { gunaMin: 30, gunaMax: 20, gunaUnit: "ml" }), 20);
check("min = max dianggap tetap", parseUsageBounds({ gunaMin: 20, gunaMax: 20, gunaUnit: "ml" }, sosCili).isRange, false);
check("usage null → 0", usageBaseQty(sosCili, null), 0);
check("nominal eksplisit dihormati", usageBaseQty(sosCili, { gunaMin: 20, gunaMax: 30, guna: 22, gunaUnit: "ml" }), 22);

console.log("\n" + (fail === 0 ? "✓ SEMUA LULUS" : "✗ GAGAL") + " — lulus: " + pass + ", gagal: " + fail + "\n");
process.exit(fail === 0 ? 0 : 1);
