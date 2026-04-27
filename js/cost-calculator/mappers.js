/**
 * Tukar snapshot Firestore kepada objek domain digunakan UI kalkulator.
 */
import { normalizeUsageValue } from "../menu-costing/normalize-usage.js";
import {
  parseMenuKind,
  parseMenuCategory,
  parsePackageLines,
  parsePackageMemberIds
} from "./package-resolved-usage.js";

export function docToIngredient(d) {
  var data = d.data();
  return {
    id: d.id,
    name: data.name || "",
    purchasePrice: typeof data.purchasePrice === "number" ? data.purchasePrice : parseFloat(data.purchasePrice) || 0,
    purchaseQty: typeof data.purchaseQty === "number" ? data.purchaseQty : parseFloat(data.purchaseQty) || 0,
    unit: data.unit || "g",
    sortIndex: typeof data.sortIndex === "number" ? data.sortIndex : parseFloat(data.sortIndex) || 0,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt
  };
}

export function docToProduct(d) {
  var data = d.data();
  var rawUsage = data.usage && typeof data.usage === "object" ? data.usage : {};
  var usage = {};
  Object.keys(rawUsage).forEach(function (k) {
    usage[k] = normalizeUsageValue(rawUsage[k]);
  });
  return {
    id: d.id,
    name: data.name || "",
    sellingPrice: typeof data.sellingPrice === "number" ? data.sellingPrice : parseFloat(data.sellingPrice) || 0,
    usage: usage,
    sortIndex: typeof data.sortIndex === "number" ? data.sortIndex : parseFloat(data.sortIndex) || 0,
    menuKind: parseMenuKind(data),
    menuCategory: parseMenuCategory(data),
    packageLines: parsePackageLines(data),
    packageMemberIds: parsePackageMemberIds(data)
  };
}
