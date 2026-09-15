/**
 * Pengelasan varians drawer (amaun sebenar − jangkaan).
 * Dikongsi antara POS (shiftClose) dan paparan BO / MCP.
 */
import { t as tr } from "./i18n/locale.js";

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

/**
 * Label varians dalam bahasa aktif. Nama `varianceLabelMs` dikekalkan sebagai alias
 * kerana ia masih dipanggil dari modul lain (cth js/staff/staff-app.js).
 *
 * @param {"balanced"|"short"|"over"|"unknown"|string} cat
 */
export function varianceLabel(cat) {
  if (cat === "balanced") return tr("shift.variance.balanced");
  if (cat === "short") return tr("shift.variance.short");
  if (cat === "over") return tr("shift.variance.over");
  return tr("shift.variance.unknown");
}

export { varianceLabel as varianceLabelMs };
