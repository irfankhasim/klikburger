/** Kira cukai pelanggan — peratus 0–100 ke atas subtotal (harga menu). */

export function clampTaxPercent(n) {
  var v = typeof n === "number" ? n : parseFloat(n);
  if (isNaN(v) || v < 0) return 0;
  if (v > 100) return 100;
  return Math.round(v * 100) / 100;
}

export function computeTaxAmount(subtotal, taxPercent) {
  var sub = typeof subtotal === "number" ? subtotal : parseFloat(subtotal) || 0;
  var pct = clampTaxPercent(taxPercent);
  if (pct <= 0 || sub <= 0) return 0;
  return Math.round(sub * (pct / 100) * 100) / 100;
}

export function computeOrderTotal(subtotal, taxPercent) {
  var sub = typeof subtotal === "number" ? subtotal : parseFloat(subtotal) || 0;
  var tax = computeTaxAmount(sub, taxPercent);
  return Math.round((sub + tax) * 100) / 100;
}

export function splitOrderAmounts(subtotal, taxPercent) {
  var sub = Math.round((typeof subtotal === "number" ? subtotal : parseFloat(subtotal) || 0) * 100) / 100;
  var pct = clampTaxPercent(taxPercent);
  var taxAmount = computeTaxAmount(sub, pct);
  var total = Math.round((sub + taxAmount) * 100) / 100;
  return { subtotal: sub, taxPercent: pct, taxAmount: taxAmount, total: total };
}
