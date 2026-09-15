/**
 * Enjin kos menu — fungsi tulen (tiada Firestore).
 * Guna bersama `recipes` + `menu_items` + `ingredients`.
 */
import { costPerUnit, productCost, productCostRange } from "../cost-calculator/core.js";

/**
 * Jumlah kos resipi dalam unit belian bahan (usage sama bentuk seperti `modifiers.usage`).
 * @param {Array} ingredients — senarai bahan normalisasi (id, unit, purchasePrice, …)
 * @param {Record<string, number|object>} usageMap
 * @param {"nominal"|"min"|"max"} [mode="nominal"]
 */
export function recipeTotalCost(ingredients, usageMap, mode) {
  return productCost(ingredients, { usage: usageMap || {} }, mode || "nominal");
}

/**
 * Metrik satu item menu: harga modal, untung, margin % (sokong julat kos).
 * @param {object} menuItem — { sellingPrice, recipeId }
 * @param {object|null} recipe — { usage } atau null
 */
export function menuItemCostModel(ingredients, menuItem, recipe) {
  var sell = typeof menuItem.sellingPrice === "number" ? menuItem.sellingPrice : parseFloat(menuItem.sellingPrice) || 0;
  var usage = recipe && recipe.usage && typeof recipe.usage === "object" ? recipe.usage : {};
  var range = productCostRange(ingredients, { usage: usage });
  var cost = range.nominal;
  var profit = sell - cost;
  var marginPct = sell > 0 ? (profit / sell) * 100 : 0;
  var profitMin = sell - range.max;
  var profitMax = sell - range.min;
  var marginPctMin = sell > 0 ? (profitMin / sell) * 100 : 0;
  var marginPctMax = sell > 0 ? (profitMax / sell) * 100 : 0;
  return {
    cost: cost,
    costMin: range.min,
    costMax: range.max,
    hasCostRange: range.hasRange,
    sellingPrice: sell,
    profit: profit,
    profitMin: profitMin,
    profitMax: profitMax,
    marginPct: Math.round(marginPct * 10) / 10,
    marginPctMin: Math.round(marginPctMin * 10) / 10,
    marginPctMax: Math.round(marginPctMax * 10) / 10
  };
}

/**
 * Denormal ringkas untuk rekod jualan (pilihan — simpan snapshot kos semasa, nominal).
 */
export function snapshotLineCost(ingredients, recipe, qtySold) {
  var q = typeof qtySold === "number" ? qtySold : parseFloat(qtySold) || 0;
  var unitCost = recipeTotalCost(ingredients, recipe && recipe.usage ? recipe.usage : {}, "nominal");
  return Math.round(unitCost * q * 100) / 100;
}

export { costPerUnit };
