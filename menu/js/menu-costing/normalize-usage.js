/**
 * Normalisasi nilai usage (nombor legacy, { guna, gunaUnit }, atau { gunaMin, gunaMax, gunaUnit }).
 */
export function normalizeUsageValue(v) {
  if (v !== null && typeof v === "object" && !Array.isArray(v)) {
    var hasMin = typeof v.gunaMin !== "undefined" && v.gunaMin !== null && v.gunaMin !== "";
    var hasMax = typeof v.gunaMax !== "undefined" && v.gunaMax !== null && v.gunaMax !== "";
    if (hasMin || hasMax) {
      // Julat separa (hanya min atau hanya max) diisi kedua-duanya supaya bahan tidak jadi 0.
      var raw = hasMin ? v.gunaMin : v.gunaMax;
      var rawMax = hasMax ? v.gunaMax : v.gunaMin;
      var min = typeof raw === "number" ? raw : parseFloat(raw) || 0;
      var max = typeof rawMax === "number" ? rawMax : parseFloat(rawMax) || 0;
      if (max < min) {
        var tmp = min;
        min = max;
        max = tmp;
      }
      var out = {
        gunaMin: min,
        gunaMax: max,
        gunaUnit: v.gunaUnit != null && String(v.gunaUnit) !== "" ? String(v.gunaUnit) : null
      };
      if (typeof v.guna !== "undefined" && v.guna !== null && v.guna !== "") {
        out.guna = typeof v.guna === "number" ? v.guna : parseFloat(v.guna) || 0;
      }
      return out;
    }
    if (typeof v.guna !== "undefined") {
      return {
        guna: typeof v.guna === "number" ? v.guna : parseFloat(v.guna) || 0,
        gunaUnit: v.gunaUnit != null && String(v.gunaUnit) !== "" ? String(v.gunaUnit) : null
      };
    }
  }
  if (typeof v === "number") return v;
  return parseFloat(v) || 0;
}
