/**
 * Firestore data fetching — AI tools untuk OpenRouter tool calling.
 */
import {
  db,
  collection,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  Timestamp
} from "../firebase/init.js";
import {
  COL_INGREDIENTS,
  COL_INGREDIENT_BATCHES,
  COL_INGREDIENT_LEDGER,
  COL_MENU_ITEMS,
  COL_RECIPES,
  COL_SALES
} from "../firebase/collections.js";
import { sortBatchesFifo } from "../cost-calculator/ingredient-batch-repository.js";

function num(v) {
  return typeof v === "number" ? v : parseFloat(v) || 0;
}

function str(v) {
  return String(v || "").trim();
}

function nameMatches(name, filter) {
  var f = str(filter).toLowerCase();
  if (!f) return true;
  return str(name).toLowerCase().indexOf(f) >= 0;
}

/** @returns {Promise<Record<string, object>>} */
async function loadIngredientsById() {
  var snap = await getDocs(collection(db, COL_INGREDIENTS));
  var map = {};
  snap.docs.forEach(function (d) {
    map[d.id] = Object.assign({ id: d.id }, d.data());
  });
  return map;
}

/** @returns {Promise<Record<string, object[]>>} */
async function loadPositiveBatchesByIngredientId() {
  var snap = await getDocs(query(collection(db, COL_INGREDIENT_BATCHES), where("qtyRemaining", ">", 0)));
  var map = {};
  snap.docs.forEach(function (d) {
    var data = d.data();
    var ingId = str(data.ingredientId);
    if (!ingId) return;
    if (!map[ingId]) map[ingId] = [];
    map[ingId].push(Object.assign({ id: d.id }, data));
  });
  Object.keys(map).forEach(function (id) {
    map[id] = sortBatchesFifo(map[id]);
  });
  return map;
}

function stockStatusFromQty(qty) {
  if (qty <= 0) return "habis";
  if (qty <= 5) return "rendah";
  return "ok";
}

/**
 * Tool 1: Dapatkan harga modal bahan terkini (FIFO — batch terawal yang masih ada stok).
 * @param {string} [ingredientName]
 */
export async function getIngredientPrices(ingredientName) {
  var ingById = await loadIngredientsById();
  var batchesByIng = await loadPositiveBatchesByIngredientId();
  var out = [];

  Object.keys(ingById).forEach(function (id) {
    var ing = ingById[id];
    var name = str(ing.name) || id;
    if (!nameMatches(name, ingredientName)) return;

    var batches = batchesByIng[id] || [];
    var active = batches[0] || null;
    var qtyRemaining = active ? num(active.qtyRemaining) : 0;
    var costPerUnit = active ? num(active.costPerUnit) : 0;

    out.push({
      name: name,
      unit: str(ing.unit),
      purchasePrice: num(ing.purchasePrice),
      costPerUnit: Math.round(costPerUnit * 10000) / 10000,
      qtyRemaining: qtyRemaining,
      stockStatus: stockStatusFromQty(qtyRemaining)
    });
  });

  out.sort(function (a, b) {
    return a.name.localeCompare(b.name);
  });
  return out;
}

/**
 * Tool 2: Dapatkan senarai menu dan harga jual.
 * @param {string} [menuName]
 */
export async function getMenuItems(menuName) {
  var snap = await getDocs(collection(db, COL_MENU_ITEMS));
  var out = [];

  snap.docs.forEach(function (d) {
    var x = d.data();
    var name = str(x.name) || d.id;
    if (!nameMatches(name, menuName)) return;
    out.push({
      name: name,
      sellingPrice: num(x.sellingPrice),
      recipeId: str(x.recipeId) || null
    });
  });

  out.sort(function (a, b) {
    return a.name.localeCompare(b.name);
  });
  return out;
}

/**
 * Tool 3: Dapatkan stok yang hampir habis (qtyRemaining rendah).
 * @param {number} [threshold]
 */
export async function getLowStock(threshold) {
  var th = typeof threshold === "number" && !isNaN(threshold) ? threshold : 5;
  var ingById = await loadIngredientsById();
  var snap = await getDocs(
    query(collection(db, COL_INGREDIENT_BATCHES), where("qtyRemaining", ">", 0), orderBy("qtyRemaining", "asc"), limit(200))
  );

  var merged = {};
  snap.docs.forEach(function (d) {
    var x = d.data();
    var ingId = str(x.ingredientId);
    var qty = num(x.qtyRemaining);
    if (qty <= 0 || qty > th) return;
    if (merged[ingId] && merged[ingId].qtyRemaining <= qty) return;
    var ing = ingById[ingId] || {};
    merged[ingId] = {
      ingredientName: str(ing.name) || ingId || "Tidak diketahui",
      unit: str(ing.unit),
      qtyRemaining: qty,
      costPerUnit: Math.round(num(x.costPerUnit) * 10000) / 10000
    };
  });

  return Object.keys(merged)
    .map(function (k) {
      return merged[k];
    })
    .sort(function (a, b) {
      return a.qtyRemaining - b.qtyRemaining;
    });
}

/**
 * Tool 4: Dapatkan ringkasan jualan (hari ini atau N hari lepas).
 * @param {number} [days]
 */
export async function getSalesSummary(days) {
  var nDays = typeof days === "number" && days > 0 ? Math.floor(days) : 1;
  var now = new Date();
  var start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (nDays - 1), 0, 0, 0, 0);
  var end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  var tsStart = Timestamp.fromDate(start);

  var snap = await getDocs(
    query(collection(db, COL_SALES), where("createdAt", ">=", tsStart), orderBy("createdAt", "desc"), limit(500))
  );

  var totalRevenue = 0;
  var totalOrders = 0;
  var itemCounts = {};

  snap.docs.forEach(function (d) {
    var x = d.data();
    var createdAt = x.createdAt;
    if (createdAt && typeof createdAt.toDate === "function") {
      var at = createdAt.toDate();
      if (at >= end) return;
    }
    totalOrders += 1;
    totalRevenue += num(x.subtotal);
    var lines = Array.isArray(x.lines) ? x.lines : [];
    lines.forEach(function (ln) {
      var label = str(ln.name) || str(ln.modifierId) || "Item";
      var qty = num(ln.qty);
      if (qty <= 0) qty = 1;
      itemCounts[label] = (itemCounts[label] || 0) + qty;
    });
  });

  totalRevenue = Math.round(totalRevenue * 100) / 100;

  var topItems = Object.keys(itemCounts)
    .map(function (name) {
      return { name: name, qty: itemCounts[name] };
    })
    .sort(function (a, b) {
      return b.qty - a.qty;
    })
    .slice(0, 10);

  var period =
    nDays === 1
      ? start.toLocaleDateString("ms-MY", { day: "numeric", month: "short", year: "numeric" })
      : start.toLocaleDateString("ms-MY") + " – " + now.toLocaleDateString("ms-MY");

  return {
    totalRevenue: totalRevenue,
    totalOrders: totalOrders,
    topItems: topItems,
    period: period
  };
}

/**
 * Tool 5: Dapatkan sejarah belian/pembelian bahan dari ingredient_ledger.
 * @param {string} [ingredientName]
 * @param {number} [limitCount]
 */
export async function getPurchaseHistory(ingredientName, limitCount) {
  var lim = typeof limitCount === "number" && limitCount > 0 ? Math.floor(limitCount) : 50;
  var ingById = await loadIngredientsById();

  // Build reverse map: name → id (for name-based filtering)
  var nameToId = {};
  Object.keys(ingById).forEach(function (id) {
    var n = str(ingById[id].name).toLowerCase();
    if (n) nameToId[n] = id;
  });

  var q = query(
    collection(db, COL_INGREDIENT_LEDGER),
    orderBy("occurredAt", "desc"),
    limit(lim * 5) // fetch more to allow filtering by name
  );
  var snap = await getDocs(q);

  var out = [];
  snap.docs.forEach(function (d) {
    var x = d.data();
    var ingId = str(x.ingredientId);
    var ing = ingById[ingId] || {};
    var name = str(ing.name) || str(x.nameSnapshot) || ingId || "Tidak diketahui";

    if (!nameMatches(name, ingredientName)) return;

    var occurredAt = x.occurredAt;
    var dateStr = "";
    if (occurredAt && typeof occurredAt.toDate === "function") {
      dateStr = occurredAt.toDate().toLocaleDateString("ms-MY", {
        day: "numeric", month: "short", year: "numeric"
      });
    }

    out.push({
      ingredientName: name,
      kind: str(x.kind) || "purchase",
      purchaseQty: num(x.purchaseQty),
      unit: str(x.unit) || str(ing.unit),
      costPerUnit: Math.round(num(x.costPerUnit) * 10000) / 10000,
      purchasePrice: Math.round(num(x.purchasePrice) * 100) / 100,
      totalCost: Math.round(num(x.purchaseQty) * num(x.costPerUnit) * 100) / 100,
      notes: str(x.notes),
      date: dateStr
    });

    if (out.length >= lim) return;
  });

  return out.slice(0, lim);
}

/** Definisi alat untuk OpenRouter API `tools` parameter. */
export var AI_TOOLS_DEFINITION = [
  {
    type: "function",
    function: {
      name: "getIngredientPrices",
      description:
        "Dapatkan harga modal dan maklumat stok bahan mentah terkini dari sistem inventori. Guna apabila ditanya tentang harga modal, kos bahan, atau status stok sesuatu bahan.",
      parameters: {
        type: "object",
        properties: {
          ingredientName: {
            type: "string",
            description: "Nama bahan yang hendak dicari. Kosongkan untuk dapatkan semua bahan."
          }
        },
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "getMenuItems",
      description:
        "Dapatkan senarai menu, harga jual, dan maklumat resipi dari sistem POS. Guna apabila ditanya tentang harga jualan menu atau senarai produk.",
      parameters: {
        type: "object",
        properties: {
          menuName: {
            type: "string",
            description: "Nama menu yang hendak dicari. Kosongkan untuk dapatkan semua menu."
          }
        },
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "getLowStock",
      description:
        "Dapatkan senarai bahan yang stoknya hampir habis. Guna apabila ditanya tentang stok rendah, perlu reorder, atau bahan yang nak habis.",
      parameters: {
        type: "object",
        properties: {
          threshold: {
            type: "number",
            description: "Had minimum kuantiti stok. Default 5."
          }
        },
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "getSalesSummary",
      description:
        "Dapatkan ringkasan jualan untuk tempoh tertentu. Guna apabila ditanya tentang jualan hari ini, minggu ini, pendapatan, atau menu paling laris.",
      parameters: {
        type: "object",
        properties: {
          days: {
            type: "number",
            description: "Bilangan hari kebelakang. 1 = hari ini, 7 = seminggu. Default 1."
          }
        },
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "getPurchaseHistory",
      description:
        "Dapatkan sejarah belian dan pembelian bahan mentah dari rekod lejar inventori. Guna apabila ditanya tentang sejarah belian, berapa kali beli, harga belian lepas, atau rekod pembelian sesuatu bahan seperti bawang, ayam, daging dan lain-lain.",
      parameters: {
        type: "object",
        properties: {
          ingredientName: {
            type: "string",
            description: "Nama bahan yang hendak dicari sejarah beliannya. Kosongkan untuk semua bahan."
          },
          limitCount: {
            type: "number",
            description: "Bilangan rekod maksimum untuk dikembalikan. Default 20."
          }
        },
        required: []
      }
    }
  }
];

