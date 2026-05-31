/**
 * Enjin kos menu — fungsi tulen (tiada Firestore).
 * Guna bersama `recipes` + `menu_items` + `ingredients`.
 */
import { costPerUnit, productCost } from "../cost-calculator/core.js";

/**
 * Jumlah kos resipi dalam unit belian bahan (usage sama bentuk seperti `modifiers.usage`).
 * @param {Array} ingredients — senarai bahan normalisasi (id, unit, purchasePrice, …)
 * @param {Record<string, number|object>} usageMap
 */
export function recipeTotalCost(ingredients, usageMap) {
  return productCost(ingredients, { usage: usageMap || {} });
}

/**
 * Metrik satu item menu: harga modal, untung, margin %.
 * @param {object} menuItem — { sellingPrice, recipeId }
 * @param {object|null} recipe — { usage } atau null
 */
export function menuItemCostModel(ingredients, menuItem, recipe) {
  var sell = typeof menuItem.sellingPrice === "number" ? menuItem.sellingPrice : parseFloat(menuItem.sellingPrice) || 0;
  var usage = recipe && recipe.usage && typeof recipe.usage === "object" ? recipe.usage : {};
  var cost = recipeTotalCost(ingredients, usage);
  var profit = sell - cost;
  var marginPct = sell > 0 ? ((profit / sell) * 100) : 0;
  return {
    cost: cost,
    sellingPrice: sell,
    profit: profit,
    marginPct: Math.round(marginPct * 10) / 10
  };
}

/**
 * Denormal ringkas untuk rekod jualan (pilihan — simpan snapshot kos semasa).
 */
export function snapshotLineCost(ingredients, recipe, qtySold) {
  var q = typeof qtySold === "number" ? qtySold : parseFloat(qtySold) || 0;
  var unitCost = recipeTotalCost(ingredients, recipe && recipe.usage ? recipe.usage : {});
  return Math.round(unitCost * q * 100) / 100;
}

export { costPerUnit };
