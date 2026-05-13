/**
 * Firestore → domain untuk recipes, menu_items, sales, purchase_history.
 */
import { normalizeUsageValue } from "./normalize-usage.js";

function mapUsageObject(raw) {
  var usage = {};
  if (!raw || typeof raw !== "object") return usage;
  Object.keys(raw).forEach(function (k) {
    usage[k] = normalizeUsageValue(raw[k]);
  });
  return usage;
}

export function docToRecipe(d) {
  var data = d.data();
  return {
    id: d.id,
    name: data.name || "",
    usage: mapUsageObject(data.usage),
    sortIndex: typeof data.sortIndex === "number" ? data.sortIndex : parseFloat(data.sortIndex) || 0
  };
}

export function docToMenuItem(d) {
  var data = d.data();
  return {
    id: d.id,
    name: data.name || "",
    sellingPrice: typeof data.sellingPrice === "number" ? data.sellingPrice : parseFloat(data.sellingPrice) || 0,
    recipeId: data.recipeId ? String(data.recipeId) : "",
    sortIndex: typeof data.sortIndex === "number" ? data.sortIndex : parseFloat(data.sortIndex) || 0
  };
}

export function docToSale(d) {
  var data = d.data();
  return {
    id: d.id,
    createdAt: data.createdAt,
    lines: Array.isArray(data.lines) ? data.lines : [],
    subtotal: typeof data.subtotal === "number" ? data.subtotal : parseFloat(data.subtotal) || 0,
    notes: data.notes || ""
  };
}

export function docToPurchase(d) {
  var data = d.data();
  return {
    id: d.id,
    createdAt: data.createdAt,
    totalAmount: typeof data.totalAmount === "number" ? data.totalAmount : parseFloat(data.totalAmount) || 0,
    supplier: data.supplier || "",
    lines: Array.isArray(data.lines) ? data.lines : [],
    notes: data.notes || ""
  };
}
