/**
 * Agregat wastage dari ingredient_ledger — dikongsi laporan bulanan (pelayar + MCP).
 * Kos = purchasePrice pada rekod (harga lot belian yang dipilih semasa wastage).
 */

export function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function round4(n) {
  return Math.round((Number(n) || 0) * 10000) / 10000;
}

export function emptyWastageAgg() {
  return { totalRm: 0, count: 0, byIngredient: {} };
}

/**
 * @param {{ totalRm: number, count: number, byIngredient: object }} state
 * @param {object} data dokumen ledger
 * @param {Record<string, string>} [ingNameById]
 * @param {Record<string, string>} [ingUnitById]
 */
export function addWastageLedgerEntry(state, data, ingNameById, ingUnitById) {
  if (!data || String(data.kind || "") !== "wastage") return;
  var iid = String(data.ingredientId || "");
  var qty = typeof data.purchaseQty === "number" ? Math.abs(data.purchaseQty) : Math.abs(parseFloat(data.purchaseQty) || 0);
  var cost =
    typeof data.purchasePrice === "number" ? Math.abs(data.purchasePrice) : Math.abs(parseFloat(data.purchasePrice) || 0);
  var unit = String(data.unit || (ingUnitById && ingUnitById[iid]) || "unit");
  var name = (ingNameById && ingNameById[iid]) || String(data.nameSnapshot || iid || "—");
  state.totalRm += cost;
  state.count += 1;
  if (!iid) return;
  if (!state.byIngredient[iid]) {
    state.byIngredient[iid] = {
      ingredientId: iid,
      name: name,
      unit: unit,
      totalQty: 0,
      totalCostRm: 0,
      entryCount: 0
    };
  }
  var row = state.byIngredient[iid];
  row.totalQty += qty;
  row.totalCostRm += cost;
  row.entryCount += 1;
}

export function finalizeWastageAgg(state) {
  var by = Object.keys(state.byIngredient)
    .map(function (k) {
      var row = state.byIngredient[k];
      return {
        ingredientId: row.ingredientId,
        name: row.name,
        unit: row.unit,
        totalQty: round4(row.totalQty),
        totalCostRm: round2(row.totalCostRm),
        entryCount: row.entryCount
      };
    })
    .sort(function (a, b) {
      return b.totalCostRm - a.totalCostRm;
    });
  return {
    wastageTotalRm: round2(state.totalRm),
    wastageEntryCount: state.count,
    wastageByIngredient: by
  };
}
