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
  COL_MODIFIERS,
  COL_POS_RECEIPTS,
  COL_STAFF_ACTIVITY
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
  var snap = await getDocs(collection(db, COL_MODIFIERS));
  var out = [];

  snap.docs.forEach(function (d) {
    var x = d.data();
    var name = str(x.name) || d.id;
    if (!nameMatches(name, menuName)) return;
    var usage = x.usage && typeof x.usage === "object" ? x.usage : {};
    out.push({
      name: name,
      sellingPrice: num(x.sellingPrice),
      usage: usage,
      modifierId: d.id
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
function aggregatePosReceipts(docs, rangeStart, rangeEnd) {
  var totalRevenue = 0;
  var totalOrders = 0;
  var itemCounts = {};
  var byPaymentMethod = { cash: 0, qr: 0 };

  docs.forEach(function (d) {
    var x = d.data();
    if (x.voided) return;
    var createdAt = x.createdAt;
    if (createdAt && typeof createdAt.toDate === "function") {
      var at = createdAt.toDate();
      if (rangeStart && at < rangeStart) return;
      if (rangeEnd && at >= rangeEnd) return;
    }
    totalOrders += 1;
    var sub = num(x.subtotal);
    totalRevenue += sub;
    var pm = str(x.paymentMethod).toLowerCase();
    if (pm === "cash" || pm === "tunai") byPaymentMethod.cash += sub;
    else byPaymentMethod.qr += sub;
    var lines = Array.isArray(x.lines) ? x.lines : [];
    lines.forEach(function (ln) {
      var label = str(ln.name) || "Item";
      var qty = num(ln.qty);
      if (qty <= 0) qty = 1;
      itemCounts[label] = (itemCounts[label] || 0) + qty;
    });
  });

  totalRevenue = Math.round(totalRevenue * 100) / 100;
  byPaymentMethod.cash = Math.round(byPaymentMethod.cash * 100) / 100;
  byPaymentMethod.qr = Math.round(byPaymentMethod.qr * 100) / 100;

  var topItems = Object.keys(itemCounts)
    .map(function (name) {
      return { name: name, qty: itemCounts[name] };
    })
    .sort(function (a, b) {
      return b.qty - a.qty;
    })
    .slice(0, 10);

  return {
    totalRevenue: totalRevenue,
    totalOrders: totalOrders,
    topItems: topItems,
    byPaymentMethod: byPaymentMethod
  };
}

export async function getSalesSummary(days) {
  var nDays = typeof days === "number" && days > 0 ? Math.floor(days) : 1;
  var now = new Date();
  var start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (nDays - 1), 0, 0, 0, 0);
  var end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  var tsStart = Timestamp.fromDate(start);

  var snap = await getDocs(
    query(collection(db, COL_POS_RECEIPTS), where("createdAt", ">=", tsStart), orderBy("createdAt", "desc"), limit(500))
  );

  var agg = aggregatePosReceipts(snap.docs, start, end);

  var period =
    nDays === 1
      ? start.toLocaleDateString("ms-MY", { day: "numeric", month: "short", year: "numeric" })
      : start.toLocaleDateString("ms-MY") + " – " + now.toLocaleDateString("ms-MY");

  return Object.assign({ period: period, days: nDays }, agg);
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

function stockTotalByIngredientId(batchesByIng) {
  var totals = {};
  Object.keys(batchesByIng || {}).forEach(function (ingId) {
    totals[ingId] = (batchesByIng[ingId] || []).reduce(function (sum, b) {
      return sum + num(b.qtyRemaining);
    }, 0);
  });
  return totals;
}

/**
 * Tool 6: Semak kecukupan stok bahan untuk bilangan order menu tertentu.
 * @param {string} menuName
 * @param {number} orderQty
 */
export async function checkIngredientSufficiency(menuName, orderQty) {
  var qty = typeof orderQty === "number" && orderQty > 0 ? Math.floor(orderQty) : 1;
  var menuFilter = str(menuName);
  if (!menuFilter) {
    return { error: "menuName diperlukan.", summary: { allSufficient: false, menuName: "", orderQty: qty } };
  }

  var modSnap = await getDocs(collection(db, COL_MODIFIERS));
  var modifier = null;
  modSnap.docs.forEach(function (d) {
    if (modifier) return;
    var x = d.data();
    var name = str(x.name) || d.id;
    if (nameMatches(name, menuFilter)) {
      modifier = { id: d.id, name: name, usage: x.usage && typeof x.usage === "object" ? x.usage : {} };
    }
  });

  if (!modifier) {
    return {
      error: 'Menu "' + menuFilter + '" tidak dijumpai dalam modifiers.',
      summary: { allSufficient: false, menuName: menuFilter, orderQty: qty }
    };
  }

  var ingById = await loadIngredientsById();
  var batchesByIng = await loadPositiveBatchesByIngredientId();
  var stockTotals = stockTotalByIngredientId(batchesByIng);
  var results = [];
  var usageKeys = Object.keys(modifier.usage);

  if (!usageKeys.length) {
    return {
      error: "Menu dijumpai tetapi tiada usage bahan direkodkan.",
      summary: { allSufficient: false, menuName: modifier.name, orderQty: qty },
      items: []
    };
  }

  usageKeys.forEach(function (ingId) {
    var perUnit = num(modifier.usage[ingId]);
    if (perUnit <= 0) return;
    var required = Math.round(perUnit * qty * 10000) / 10000;
    var available = Math.round(num(stockTotals[ingId]) * 10000) / 10000;
    var ing = ingById[ingId] || {};
    var sufficient = available >= required;
    results.push({
      ingredientName: str(ing.name) || ingId,
      unit: str(ing.unit),
      usagePerOrder: perUnit,
      required: required,
      available: available,
      sufficient: sufficient,
      shortage: sufficient ? 0 : Math.round((required - available) * 10000) / 10000,
      working: "Keperluan: " + perUnit + " " + str(ing.unit) + " × " + qty + " order = " + required + " " + str(ing.unit)
    });
  });

  var allSufficient = results.length > 0 && results.every(function (r) {
    return r.sufficient;
  });

  return {
    items: results,
    summary: {
      allSufficient: allSufficient,
      menuName: modifier.name,
      orderQty: qty,
      message: allSufficient
        ? "Stok mencukupi untuk " + qty + " order " + modifier.name + "."
        : "Stok TIDAK mencukupi untuk " + qty + " order " + modifier.name + "."
    }
  };
}

function isoWeekRange(year, week) {
  var y = typeof year === "number" ? year : new Date().getFullYear();
  var w = typeof week === "number" && week >= 1 && week <= 53 ? Math.floor(week) : 1;
  var jan4 = new Date(y, 0, 4, 0, 0, 0, 0);
  var dow = jan4.getDay() || 7;
  var mondayWeek1 = new Date(jan4);
  mondayWeek1.setDate(jan4.getDate() - dow + 1);
  var start = new Date(mondayWeek1);
  start.setDate(mondayWeek1.getDate() + (w - 1) * 7);
  var end = new Date(start);
  end.setDate(start.getDate() + 7);
  return { start: start, end: end, year: y, week: w };
}

/**
 * Tool 7: Rekod clock in/out kakitangan.
 * @param {string} [staffName]
 * @param {number} [days]
 */
export async function getStaffAttendance(staffName, days) {
  var nDays = typeof days === "number" && days > 0 ? Math.floor(days) : 1;
  var now = new Date();
  var start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (nDays - 1), 0, 0, 0, 0);
  var tsStart = Timestamp.fromDate(start);
  var nameFilter = str(staffName).toLowerCase();

  var snap = await getDocs(
    query(collection(db, COL_STAFF_ACTIVITY), where("createdAt", ">=", tsStart), orderBy("createdAt", "desc"), limit(200))
  );

  var records = [];
  snap.docs.forEach(function (d) {
    var x = d.data();
    var kind = str(x.kind);
    if (kind !== "clock_in" && kind !== "clock_out") return;
    var sName = str(x.staffName) || "—";
    if (nameFilter && sName.toLowerCase().indexOf(nameFilter) < 0) return;
    var at = x.createdAt && typeof x.createdAt.toDate === "function" ? x.createdAt.toDate() : null;
    records.push({
      staffId: str(x.staffId),
      staffName: sName,
      kind: kind,
      date: at ? at.toLocaleDateString("ms-MY") : "",
      time: at ? at.toLocaleTimeString("ms-MY", { hour: "2-digit", minute: "2-digit", hour12: true }) : "",
      timestamp: at ? at.toISOString() : ""
    });
  });

  records.sort(function (a, b) {
    return String(b.timestamp).localeCompare(String(a.timestamp));
  });

  var hoursByStaff = {};
  var byStaffDay = {};
  records.forEach(function (r) {
    var key = r.staffId + "|" + r.date;
    if (!byStaffDay[key]) byStaffDay[key] = { staffName: r.staffName, events: [] };
    byStaffDay[key].events.push(r);
  });

  Object.keys(byStaffDay).forEach(function (key) {
    var bucket = byStaffDay[key];
    var events = bucket.events.slice().sort(function (a, b) {
      return String(a.timestamp).localeCompare(String(b.timestamp));
    });
    var openIn = null;
    var totalMs = 0;
    events.forEach(function (ev) {
      if (ev.kind === "clock_in") {
        openIn = ev.timestamp ? new Date(ev.timestamp).getTime() : null;
      } else if (ev.kind === "clock_out" && openIn) {
        var outMs = ev.timestamp ? new Date(ev.timestamp).getTime() : 0;
        if (outMs > openIn) totalMs += outMs - openIn;
        openIn = null;
      }
    });
    var staffKey = bucket.staffName;
    if (!hoursByStaff[staffKey]) hoursByStaff[staffKey] = 0;
    hoursByStaff[staffKey] += totalMs;
  });

  var hoursSummary = Object.keys(hoursByStaff).map(function (name) {
    var hrs = Math.round((hoursByStaff[name] / 3600000) * 100) / 100;
    return { staffName: name, hoursWorked: hrs };
  });

  return {
    period:
      nDays === 1
        ? start.toLocaleDateString("ms-MY", { day: "numeric", month: "short", year: "numeric" })
        : start.toLocaleDateString("ms-MY") + " – " + now.toLocaleDateString("ms-MY"),
    days: nDays,
    records: records,
    hoursSummary: hoursSummary,
    totalRecords: records.length
  };
}

/**
 * Tool 8: Jualan mengikut bulan atau minggu dengan breakdown harian.
 * @param {number} [year]
 * @param {number} [month]
 * @param {number} [week]
 */
export async function getSalesByPeriod(year, month, week) {
  var rangeStart;
  var rangeEnd;
  var label;

  if (typeof week === "number" && week >= 1) {
    var wr = isoWeekRange(typeof year === "number" ? year : new Date().getFullYear(), week);
    rangeStart = wr.start;
    rangeEnd = wr.end;
    label = "Minggu " + wr.week + " " + wr.year;
  } else if (typeof year === "number" && typeof month === "number" && month >= 1 && month <= 12) {
    rangeStart = new Date(year, month - 1, 1, 0, 0, 0, 0);
    rangeEnd = new Date(year, month, 1, 0, 0, 0, 0);
    label = rangeStart.toLocaleDateString("ms-MY", { month: "long", year: "numeric" });
  } else {
    var now = new Date();
    rangeStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    rangeEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);
    label = rangeStart.toLocaleDateString("ms-MY", { month: "long", year: "numeric" });
  }

  var tsStart = Timestamp.fromDate(rangeStart);
  var snap = await getDocs(
    query(collection(db, COL_POS_RECEIPTS), where("createdAt", ">=", tsStart), orderBy("createdAt", "asc"), limit(1000))
  );

  var dailyMap = {};
  var docsInRange = snap.docs.filter(function (d) {
    var x = d.data();
    if (x.voided) return false;
    var at = x.createdAt && typeof x.createdAt.toDate === "function" ? x.createdAt.toDate() : null;
    return at && at >= rangeStart && at < rangeEnd;
  });

  docsInRange.forEach(function (d) {
    var x = d.data();
    var at = x.createdAt.toDate();
    var dateKey = at.toLocaleDateString("ms-MY");
    if (!dailyMap[dateKey]) dailyMap[dateKey] = { date: dateKey, revenue: 0, orders: 0 };
    dailyMap[dateKey].revenue += num(x.subtotal);
    dailyMap[dateKey].orders += 1;
  });

  var dailyBreakdown = Object.keys(dailyMap)
    .map(function (k) {
      return {
        date: dailyMap[k].date,
        revenue: Math.round(dailyMap[k].revenue * 100) / 100,
        orders: dailyMap[k].orders
      };
    })
    .sort(function (a, b) {
      return String(a.date).localeCompare(String(b.date));
    });

  var agg = aggregatePosReceipts(docsInRange, rangeStart, rangeEnd);

  return {
    period: label,
    year: rangeStart.getFullYear(),
    month: rangeStart.getMonth() + 1,
    week: typeof week === "number" ? week : null,
    totalRevenue: agg.totalRevenue,
    totalOrders: agg.totalOrders,
    dailyBreakdown: dailyBreakdown,
    topItems: agg.topItems,
    byPaymentMethod: agg.byPaymentMethod
  };
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
        "Dapatkan senarai menu/produk, harga jual, dan usage bahan dari koleksi modifiers. Guna apabila ditanya tentang harga jualan menu atau senarai produk.",
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
        "Dapatkan ringkasan jualan dari pos_receipts untuk tempoh tertentu. Guna apabila ditanya tentang jualan hari ini, semalam, pendapatan, atau menu paling laris.",
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
  },
  {
    type: "function",
    function: {
      name: "checkIngredientSufficiency",
      description:
        "Semak sama ada stok bahan mentah mencukupi untuk bilangan order tertentu. Guna apabila ditanya 'boleh buat berapa', 'stok cukup ke untuk X order', 'bahan cukup tak untuk Y burger'.",
      parameters: {
        type: "object",
        properties: {
          menuName: {
            type: "string",
            description: "Nama menu/produk. Contoh: 'Burger Ayam Biasa'"
          },
          orderQty: {
            type: "number",
            description: "Bilangan order yang hendak dibuat. Contoh: 50"
          }
        },
        required: ["menuName", "orderQty"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "getStaffAttendance",
      description:
        "Dapatkan rekod kehadiran dan clock in/out kakitangan. Guna apabila ditanya tentang kehadiran staff, jam bekerja, siapa yang hadir hari ini, atau rekod shift kakitangan.",
      parameters: {
        type: "object",
        properties: {
          staffName: {
            type: "string",
            description: "Nama kakitangan. Kosongkan untuk semua staff."
          },
          days: {
            type: "number",
            description: "Bilangan hari kebelakang. Default 1 (hari ini)."
          }
        },
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "getSalesByPeriod",
      description:
        "Dapatkan analisis jualan untuk bulan atau minggu tertentu dengan breakdown harian dan produk terlaris. Guna apabila ditanya jualan bulan April, bulan lepas, minggu ini, atau perbandingan jualan.",
      parameters: {
        type: "object",
        properties: {
          year: {
            type: "number",
            description: "Tahun. Contoh: 2026"
          },
          month: {
            type: "number",
            description: "Bulan (1-12). Contoh: 4 untuk April."
          },
          week: {
            type: "number",
            description: "Minggu dalam tahun (1-52). Opsional."
          }
        },
        required: []
      }
    }
  }
];

