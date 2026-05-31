/**
 * Pengelasan varians drawer (amaun sebenar − jangkaan).
 * Dikongsi antara POS (shiftClose) dan paparan BO / MCP.
 */

export function roundMoney(n) {
  var x = typeof n === "number" ? n : parseFloat(n);
  if (x == null || isNaN(x)) return 0;
  return Math.round(x * 100) / 100;
}

/**
 * @param {number|null|undefined} varianceRm — actualDrawer − expectedDrawer
 * @returns {"balanced"|"short"|"over"|"unknown"}
 */
export function varianceCategoryFromVariance(varianceRm) {
  if (varianceRm == null || typeof varianceRm !== "number" || isNaN(varianceRm)) return "unknown";
  if (Math.abs(varianceRm) < 0.005) return "balanced";
  return varianceRm > 0 ? "over" : "short";
}

export function varianceLabelMs(cat) {
  if (cat === "balanced") return "Seimbang (Balanced)";
  if (cat === "short") return "Kurang (Short)";
  if (cat === "over") return "Lebih (Over)";
  return "Tidak dikira";
}
