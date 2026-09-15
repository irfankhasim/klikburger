/**
 * Logik kos tulen (tiada Firestore / DOM) — mudah diuji dan diguna semula.
 *
 * Usage bahan resepi:
 *   - Nombor / { guna, gunaUnit } — nilai tetap (legacy)
 *   - { gunaMin, gunaMax, gunaUnit } — julat (contoh sos 20–30 ml)
 *
 * Mod kuantiti asas (unit belian bahan):
 *   - nominal — operasi harian, COGS, tolakan stok (65% ke arah max)
 *   - min / max — kos julat & kapasiti stok
 */

/** Bias nominal ke arah max (0.5 = purata, 0.65 = lebih selamat untuk operasi). */
export var USAGE_NOMINAL_BIAS = 0.65;

export function formatRM(n) {
  return "RM " + (Math.round(n * 100) / 100).toFixed(2);
}

export function formatRMRange(min, max) {
  var a = Math.round(min * 100) / 100;
  var b = Math.round(max * 100) / 100;
  if (a === b) return formatRM(a);
  return formatRM(a) + " – " + formatRM(b);
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

function hasQty(v) {
  return typeof v !== "undefined" && v !== null && v !== "";
}

export function isUsageRange(usageVal) {
  if (usageVal == null || typeof usageVal !== "object" || Array.isArray(usageVal)) return false;
  if (!hasQty(usageVal.gunaMin) || !hasQty(usageVal.gunaMax)) return false;
  var min = parseFloat(usageVal.gunaMin) || 0;
  var max = parseFloat(usageVal.gunaMax) || 0;
  return Math.abs(max - min) > 1e-12;
}

/**
 * Parse usage kepada min, max, nominal, unit.
 * @returns {{ gunaMin: number, gunaMax: number, gunaNominal: number, gunaUnit: string, isRange: boolean }}
 */
export function parseUsageBounds(usageVal, ing) {
  var defaultUnit = ing && ing.unit ? ing.unit : "g";
  if (usageVal == null || usageVal === "") {
    return { gunaMin: 0, gunaMax: 0, gunaNominal: 0, gunaUnit: defaultUnit, isRange: false };
  }
  if (typeof usageVal === "number") {
    var n = usageVal;
    return { gunaMin: n, gunaMax: n, gunaNominal: n, gunaUnit: defaultUnit, isRange: false };
  }
  if (typeof usageVal === "object" && !Array.isArray(usageVal)) {
    var u =
      usageVal.gunaUnit != null && String(usageVal.gunaUnit) !== "" ? String(usageVal.gunaUnit) : defaultUnit;
    var hasMin = hasQty(usageVal.gunaMin);
    var hasMax = hasQty(usageVal.gunaMax);

    if (hasMin || hasMax) {
      // Julat separa atau terbalik masih perlu menghasilkan kuantiti yang sah — kalau tidak
      // bahan itu jadi 0 dan terlepas dari kos serta tolakan stok.
      var min = parseFloat(hasMin ? usageVal.gunaMin : usageVal.gunaMax) || 0;
      var max = parseFloat(hasMax ? usageVal.gunaMax : usageVal.gunaMin) || 0;
      if (max < min) {
        var tmp = min;
        min = max;
        max = tmp;
      }
      var spread = max > min + 1e-12;
      var nominal;
      if (hasQty(usageVal.guna)) {
        nominal = parseFloat(usageVal.guna) || 0;
        if (nominal < min) nominal = min;
        if (nominal > max) nominal = max;
      } else {
        nominal = spread ? min + (max - min) * USAGE_NOMINAL_BIAS : min;
      }
      return { gunaMin: min, gunaMax: max, gunaNominal: nominal, gunaUnit: u, isRange: spread };
    }

    var g = parseFloat(usageVal.guna) || 0;
    return { gunaMin: g, gunaMax: g, gunaNominal: g, gunaUnit: u, isRange: false };
  }
  var parsed = parseFloat(usageVal) || 0;
  return { gunaMin: parsed, gunaMax: parsed, gunaNominal: parsed, gunaUnit: defaultUnit, isRange: false };
}

/**
 * Bahagian usage untuk paparan — `guna` = nominal operasi.
 */
export function getUsagePart(ing, usageVal) {
  var b = parseUsageBounds(usageVal, ing);
  return {
    guna: b.gunaNominal,
    gunaMin: b.gunaMin,
    gunaMax: b.gunaMax,
    gunaUnit: b.gunaUnit,
    isRange: b.isRange
  };
}

/**
 * Kuantiti dalam unit belian bahan.
 * @param {"nominal"|"min"|"max"} [mode="nominal"]
 */
export function usageBaseQty(ing, usageVal, mode) {
  var b = parseUsageBounds(usageVal, ing);
  var qty =
    mode === "max" ? b.gunaMax : mode === "min" ? b.gunaMin : b.gunaNominal;
  if (!qty) return 0;
  return convertToBase(qty, b.gunaUnit, ing.unit);
}

export function usageBaseQtyMin(ing, usageVal) {
  return usageBaseQty(ing, usageVal, "min");
}

export function usageBaseQtyMax(ing, usageVal) {
  return usageBaseQty(ing, usageVal, "max");
}

export function usageBaseQtyNominal(ing, usageVal) {
  return usageBaseQty(ing, usageVal, "nominal");
}

/** Ringkasan manusia: "Sos cili (20–30 ml)" atau "Patty (1 pcs)". */
export function formatUsageSummary(ing, usageVal) {
  var b = parseUsageBounds(usageVal, ing);
  if (!b.gunaMin && !b.gunaMax && !b.gunaNominal) return "";
  var uShow = normalizeUnit(b.gunaUnit) === "L" ? "liter" : b.gunaUnit;
  var qtyText = b.isRange ? b.gunaMin + "–" + b.gunaMax : String(b.gunaMin);
  return (ing && ing.name ? ing.name : "") + " (" + qtyText + " " + uShow + ")";
}

export function costPerUnit(ing) {
  if (!ing.purchaseQty || ing.purchaseQty <= 0) return 0;
  return ing.purchasePrice / ing.purchaseQty;
}

/**
 * Jumlah kos produk.
 * @param {"nominal"|"min"|"max"} [mode="nominal"]
 */
export function productCost(ingredients, p, mode) {
  var total = 0;
  ingredients.forEach(function (ing) {
    var entry = p.usage[ing.id];
    if (entry == null) return;
    var bq = usageBaseQty(ing, entry, mode || "nominal");
    if (bq > 0) total += costPerUnit(ing) * bq;
  });
  return total;
}

/** Julat kos produk (min, max, nominal). */
export function productCostRange(ingredients, p) {
  var min = productCost(ingredients, p, "min");
  var max = productCost(ingredients, p, "max");
  var nominal = productCost(ingredients, p, "nominal");
  return {
    min: min,
    max: max,
    nominal: nominal,
    hasRange: Math.abs(max - min) > 1e-9
  };
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
