/**
 * Pakej jualan — agregat usage bahan untuk kos & FIFO POS.
 */
import { usageBaseQty } from "./core.js";

export var MENU_CATEGORY_ORDER = ["burger", "fries", "oblong", "benjo", "addon", "other"];

export var MENU_CATEGORY_LABELS_MS = {
  burger: "Burger",
  fries: "Kentang / fries",
  oblong: "Oblong",
  benjo: "Benjo",
  addon: "Tambah nilai",
  other: "Lain-lain"
};

function normalizeMenuCategory(raw) {
  var s = String(raw || "")
    .trim()
    .toLowerCase();
  if (MENU_CATEGORY_ORDER.indexOf(s) !== -1) return s;
  return "other";
}

export function parseMenuKind(data) {
  return data && data.menuKind === "package" ? "package" : "single";
}

export function parseMenuCategory(data) {
  return normalizeMenuCategory(data && data.menuCategory);
}

export function parsePackageLines(data) {
  var arr = data && data.packageLines;
  if (!Array.isArray(arr)) return [];
  return arr
    .map(function (row) {
      var id = String((row && (row.modifierId || row.componentId)) || "").trim();
      var q = typeof row.qty === "number" ? row.qty : parseFloat(row && row.qty) || 0;
      if (!id || q <= 0) return null;
      return { modifierId: id, qty: q };
    })
    .filter(Boolean);
}

/** ID produk tunggal dalam pakej (ringkas). Sokong legacy `packageLines`. */
export function parsePackageMemberIds(data) {
  if (data && Array.isArray(data.packageMemberIds)) {
    var seen = {};
    var out = [];
    data.packageMemberIds.forEach(function (id) {
      var s = String(id || "").trim();
      if (!s || seen[s]) return;
      seen[s] = true;
      out.push(s);
    });
    return out;
  }
  return parsePackageLines(data).map(function (row) {
    return row.modifierId;
  });
}

function mergeScaledUsageInto(totals, ingredientsById, usageObj, scale) {
  if (!usageObj || typeof usageObj !== "object" || scale <= 0) return;
  Object.keys(usageObj).forEach(function (ingId) {
    var ing = ingredientsById[ingId];
    if (!ing) return;
    var b = usageBaseQty(ing, usageObj[ingId]) * scale;
    if (b <= 1e-12) return;
    totals[ingId] = (totals[ingId] || 0) + b;
  });
}

export function resolveProductUsageRecursive(p, byId, ingredientsById, stack) {
  if (!p) return {};
  var pid = String(p.id || "");
  var memberIds = p.packageMemberIds && p.packageMemberIds.length ? p.packageMemberIds : null;
  if (p.menuKind === "package" && memberIds) {
    var totalsM = {};
    for (var mi = 0; mi < memberIds.length; mi++) {
      var mid = String(memberIds[mi] || "").trim();
      if (!mid) continue;
      var compM = byId[mid];
      if (!compM || compM.menuKind === "package") continue;
      mergeScaledUsageInto(totalsM, ingredientsById, compM.usage, 1);
    }
    var outM = {};
    Object.keys(totalsM).forEach(function (ingId) {
      var t = totalsM[ingId];
      if (t > 1e-12) outM[ingId] = t;
    });
    return outM;
  }
  if (p.menuKind !== "package" || !p.packageLines || !p.packageLines.length) {
    var u = p.usage && typeof p.usage === "object" ? p.usage : {};
    return Object.assign({}, u);
  }
  if (pid && stack.indexOf(pid) !== -1) return {};
  var nextStack = pid ? stack.concat(pid) : stack.slice();
  var totals = {};
  for (var i = 0; i < p.packageLines.length; i++) {
    var line = p.packageLines[i];
    var mid = String(line.modifierId || "").trim();
    var q = typeof line.qty === "number" ? line.qty : parseFloat(line.qty) || 0;
    if (!mid || q <= 0) continue;
    var comp = byId[mid];
    if (!comp) continue;
    if (comp.menuKind === "package") {
      var nested = resolveProductUsageRecursive(comp, byId, ingredientsById, nextStack);
      mergeScaledUsageInto(totals, ingredientsById, nested, q);
    } else {
      mergeScaledUsageInto(totals, ingredientsById, comp.usage, q);
    }
  }
  var out = {};
  Object.keys(totals).forEach(function (ingId) {
    var t = totals[ingId];
    if (t > 1e-12) out[ingId] = t;
  });
  return out;
}

function ingredientsByIdList(ingredients) {
  var m = {};
  (ingredients || []).forEach(function (ing) {
    m[ing.id] = ing;
    m[String(ing.id)] = ing;
  });
  return m;
}

function productsByIdMap(products) {
  var m = {};
  (products || []).forEach(function (p) {
    m[p.id] = p;
    m[String(p.id)] = p;
  });
  return m;
}

export function enrichProductsWithResolvedUsage(products, ingredients) {
  var ingById = ingredientsByIdList(ingredients);
  var byId = productsByIdMap(products);
  return (products || []).map(function (p) {
    var resolved = resolveProductUsageRecursive(p, byId, ingById, []);
    return Object.assign({}, p, { usage: resolved });
  });
}

export function resolveDraftPackageUsage(draftPackage, allProducts, ingredients) {
  var ingById = ingredientsByIdList(ingredients);
  var byId = productsByIdMap(allProducts);
  var mids = parsePackageMemberIds(draftPackage);
  if (mids.length) {
    return resolveProductUsageRecursive(
      {
        id: "__draft_pkg__",
        menuKind: "package",
        packageMemberIds: mids,
        usage: {}
      },
      byId,
      ingById,
      []
    );
  }
  var virtual = {
    id: "__draft_pkg__",
    menuKind: "package",
    packageLines: draftPackage.packageLines || [],
    usage: {}
  };
  return resolveProductUsageRecursive(virtual, byId, ingById, []);
}
