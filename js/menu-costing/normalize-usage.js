/**
 * Normalisasi nilai usage (nombor legacy atau { guna, gunaUnit }) — sama konsep dengan cost-calculator/mappers.
 */
export function normalizeUsageValue(v) {
  if (v !== null && typeof v === "object" && !Array.isArray(v) && typeof v.guna !== "undefined") {
    return {
      guna: typeof v.guna === "number" ? v.guna : parseFloat(v.guna) || 0,
      gunaUnit: v.gunaUnit != null && String(v.gunaUnit) !== "" ? String(v.gunaUnit) : null
    };
  }
  if (typeof v === "number") return v;
  return parseFloat(v) || 0;
}
