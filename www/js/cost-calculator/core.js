/**
 * Logik kos tulen (tiada Firestore / DOM) — mudah diuji dan diguna semula.
 */

export function formatRM(n) {
  return "RM " + (Math.round(n * 100) / 100).toFixed(2);
}

export function normalizeUnit(u) {
  var s = String(u || "")
    .trim()
    .toLowerCase();
  if (s === "liter" || s === "l") return "L";
  if (s === "kg" || s === "g" || s === "ml") return s;
  return String(u || "").trim();
}

export function isMassVolumeUnit(u) {
  var n = normalizeUnit(u);
  return n === "kg" || n === "g" || n === "ml" || n === "L";
}

/**
 * Tukar kuantiti dari fromUnit ke baseUnit (unit belian bahan).
 * Peraturan: ml,g → kg (/1000); ml,g → L (/1000); kg ↔ L (1:1); sama unit → tiada tukar.
 */
export function convertToBase(qty, fromUnit, baseUnit) {
  var from = normalizeUnit(fromUnit);
  var base = normalizeUnit(baseUnit);
  if (from === base) return qty;
  if (!isMassVolumeUnit(from) || !isMassVolumeUnit(base)) return qty;

  function toKgEquiv(q, u) {
    if (u === "kg") return q;
    if (u === "g") return q / 1000;
    if (u === "ml") return q / 1000;
    if (u === "L") return q;
    return q;
  }
  function fromKgEquiv(m, u) {
    if (u === "kg") return m;
    if (u === "g") return m * 1000;
    if (u === "ml") return m * 1000;
    if (u === "L") return m;
    return m;
  }
  var m = toKgEquiv(qty, from);
  return fromKgEquiv(m, base);
}

/**
 * Legacy: usage[id] boleh nombor sahaja. Objek: { guna, gunaUnit }.
 */
export function getUsagePart(ing, usageVal) {
  if (usageVal == null || usageVal === "") return { guna: 0, gunaUnit: ing.unit };
  if (typeof usageVal === "number") return { guna: usageVal, gunaUnit: ing.unit };
  if (typeof usageVal === "object" && !Array.isArray(usageVal)) {
    var g = parseFloat(usageVal.guna) || 0;
    var u =
      usageVal.gunaUnit != null && String(usageVal.gunaUnit) !== ""
        ? String(usageVal.gunaUnit)
        : ing.unit;
    return { guna: g, gunaUnit: u };
  }
  return { guna: 0, gunaUnit: ing.unit };
}

export function usageBaseQty(ing, usageVal) {
  var part = getUsagePart(ing, usageVal);
  if (!part.guna) return 0;
  return convertToBase(part.guna, part.gunaUnit, ing.unit);
}

export function costPerUnit(ing) {
  if (!ing.purchaseQty || ing.purchaseQty <= 0) return 0;
  return ing.purchasePrice / ing.purchaseQty;
}

export function productCost(ingredients, p) {
  var total = 0;
  ingredients.forEach(function (ing) {
    var entry = p.usage[ing.id];
    if (entry == null) return;
    var bq = usageBaseQty(ing, entry);
    if (bq > 0) total += costPerUnit(ing) * bq;
  });
  return total;
}

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, "&quot;");
}
