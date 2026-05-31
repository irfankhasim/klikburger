#!/usr/bin/env node
/**
 * Backfill penggunaan stok — tolak ingredient_batches (FIFO) berdasarkan
 * pos_receipts Apr & Mei 2026, dan tulis ringkasan ke ingredient_ledger.
 *
 * Jalankan: node scripts/seed-backfill-stock-usage.mjs
 */
import { pathToFileURL } from "url";
import { Timestamp, FieldValue } from "firebase-admin/firestore";
import { ensureAdminInitialized, getAdminFirestore } from "./lib/admin-init.mjs";
import { getIngredientCatalog, getProductTemplates } from "../js/cost-calculator/burger-startup-seed-data.js";
import { usageBaseQty } from "../js/cost-calculator/core.js";
import {
  COL_INGREDIENTS,
  COL_INGREDIENT_BATCHES,
  COL_INGREDIENT_LEDGER,
  COL_POS_RECEIPTS
} from "../js/firebase/collections.js";

var BATCH_LIMIT = 500;
var PAGE = 400;

/** Resipi tambahan (tiada dalam getProductTemplates). */
var EXTRA_RECIPE = {
  "Set kentang + air": {
    kentang_goreng: { guna: 150, gunaUnit: "g" },
    minyak_masak: { guna: 30, gunaUnit: "ml" }
  }
};

var NAME_TO_SLUG = {
  "Patty Ayam": "patty_ayam",
  "Patty Daging": "patty_daging",
  "Filet ayam rangup": "crispy_fillet",
  "Ayam Crispy": "crispy_fillet",
  "Ayam rangup": "crispy_fillet",
  "Crispy Fillet": "crispy_fillet",
  "Roti Burger": "roti_burger",
  "Roti Obolong": "roti_obolong",
  "Hirisan keju": "cheese_slice",
  "Cheese Slice": "cheese_slice",
  "Keju hirisan": "cheese_slice",
  "Lettuce": "lettuce",
  "Daun salad": "lettuce",
  "Timun": "timun",
  "Kobis": "kobis",
  "Bawang": "bawang",
  "Sos Cili": "sos_cili",
  "Sos tomat": "sos_tomato",
  "Sos Tomato": "sos_tomato",
  "Mayones": "mayonis",
  "Mayonis": "mayonis",
  "Mayonnaise": "mayonis",
  "Sos keju": "sos_cheese",
  "Sos Cheese": "sos_cheese",
  "Sos lada hitam": "sos_black_pepper",
  "Sos Black Pepper": "sos_black_pepper",
  "Kentang Goreng": "kentang_goreng",
  "Minyak Masak": "minyak_masak",
  "Marjerin": "margerin",
  "Margerin": "margerin",
  "Serbuk perasa BBQ": "serbuk_bbq",
  "Serbuk perasa pedas": "serbuk_spicy"
};

var MONTH_CONFIGS = [
  { year: 2026, month: 4, key: "2026-04", label: "April 2026" },
  { year: 2026, month: 5, key: "2026-05", label: "Mei 2026" }
];

function round4(n) {
  return Math.round(n * 10000) / 10000;
}

function roundMoney(n) {
  return Math.round(n * 100) / 100;
}

function batchOpenedMillis(b) {
  var t = b && b.openedAt;
  if (t && typeof t.toMillis === "function") return t.toMillis();
  if (t && typeof t.seconds === "number") return t.seconds * 1000;
  return 0;
}

function sortBatchesFifo(list) {
  return (list || []).slice().sort(function (a, b) {
    var ma = batchOpenedMillis(a) - batchOpenedMillis(b);
    if (ma !== 0) return ma;
    return String(a.id || "").localeCompare(String(b.id || ""));
  });
}

/** Langkah 1 — productName → { slug: qty | { guna, gunaUnit } } */
function buildRecipeMap() {
  var map = {};
  var templates = getProductTemplates();
  for (var i = 0; i < templates.length; i++) {
    var tpl = templates[i];
    var usage = {};
    var parts = tpl.usageParts || [];
    for (var p = 0; p < parts.length; p++) {
      usage[parts[p][0]] = parts[p][1];
    }
    map[tpl.name] = usage;
  }
  Object.keys(EXTRA_RECIPE).forEach(function (name) {
    map[name] = EXTRA_RECIPE[name];
  });
  return map;
}

/** Langkah 2 — slug → { id, name, unit, purchasePrice, purchaseQty } */
async function buildSlugMaps(db) {
  var catalog = getIngredientCatalog();
  var slugToName = {};
  catalog.forEach(function (spec) {
    slugToName[spec.slug] = spec.name;
  });

  var nameToSlug = Object.assign({}, NAME_TO_SLUG);
  catalog.forEach(function (spec) {
    nameToSlug[spec.name] = spec.slug;
  });

  var snap = await db.collection(COL_INGREDIENTS).get();
  var slugToIng = {};
  var missingSlugs = [];

  catalog.forEach(function (spec) {
    var docMatch = snap.docs.find(function (d) {
      var firestoreName = String(d.data().name || "").trim().toLowerCase();
      var catalogName = String(spec.name || "").trim().toLowerCase();
      // Try exact match first
      if (firestoreName === catalogName) return true;
      // Try NAME_TO_SLUG reverse lookup
      var slugFromFirestore = nameToSlug[String(d.data().name || "").trim()];
      if (slugFromFirestore === spec.slug) return true;
      // Try partial match — Firestore name contains catalog name or vice versa
      if (firestoreName.indexOf(catalogName) >= 0 || catalogName.indexOf(firestoreName) >= 0) return true;
      return false;
    });
    if (!docMatch) {
      missingSlugs.push(spec.slug + " (" + spec.name + ")");
      return;
    }
    var x = docMatch.data();
    slugToIng[spec.slug] = {
      id: docMatch.id,
      slug: spec.slug,
      name: String(x.name || spec.name).trim(),
      unit: String(x.unit || spec.unit || "unit"),
      purchasePrice: typeof x.purchasePrice === "number" ? x.purchasePrice : parseFloat(x.purchasePrice) || spec.listPurchasePrice || 0,
      purchaseQty: typeof x.purchaseQty === "number" ? x.purchaseQty : parseFloat(x.purchaseQty) || spec.listPurchaseQty || 1
    };
  });

  if (missingSlugs.length > 0) {
    console.warn("  ⚠ Bahan tidak dijumpai dalam Firestore:", missingSlugs.join(", "));
  }

  return { slugToIng: slugToIng, recipeMap: buildRecipeMap() };
}

function monthBounds(year, month) {
  return {
    start: Timestamp.fromDate(new Date(year, month - 1, 1, 0, 0, 0)),
    end: Timestamp.fromDate(new Date(year, month, 1, 0, 0, 0)),
    lastDay: Timestamp.fromDate(new Date(year, month, 0, 23, 59, 59))
  };
}

async function monthAlreadyProcessed(db, bounds, monthKey) {
  // Check by notes field only — no composite index needed
  var snap = await db
    .collection(COL_INGREDIENT_LEDGER)
    .where("kind", "==", "sale_consumption")
    .limit(100)
    .get();

  for (var i = 0; i < snap.docs.length; i++) {
    var notes = String(snap.docs[i].data().notes || "");
    if (notes.indexOf(monthKey) >= 0) return true;
  }
  return false;
}

async function fetchReceiptsInRange(db, tsStart, tsEnd) {
  var out = [];
  var lastDoc = null;
  while (true) {
    var q = db
      .collection(COL_POS_RECEIPTS)
      .where("createdAt", ">=", tsStart)
      .where("createdAt", "<", tsEnd)
      .orderBy("createdAt", "asc")
      .limit(PAGE);
    if (lastDoc) q = q.startAfter(lastDoc);
    var snap = await q.get();
    if (snap.empty) break;
    snap.docs.forEach(function (d) {
      var x = d.data();
      if (!x.voided) out.push({ id: d.id, data: x });
    });
    lastDoc = snap.docs[snap.docs.length - 1];
    if (snap.size < PAGE) break;
  }
  return out;
}

/** Langkah 3 — agregat penggunaan per slug (unit asas bahan). */
function aggregateUsageFromReceipts(receipts, recipeMap, slugToIng) {
  var usageBySlug = {};
  var unknownProducts = {};

  receipts.forEach(function (rec) {
    var lines = Array.isArray(rec.data.lines) ? rec.data.lines : [];
    lines.forEach(function (line) {
      var productName = String(line.name || "").trim();
      var lineQty = typeof line.qty === "number" ? line.qty : parseFloat(line.qty) || 0;
      if (!productName || lineQty <= 0) return;

      var recipe = recipeMap[productName];
      if (!recipe) {
        unknownProducts[productName] = (unknownProducts[productName] || 0) + lineQty;
        return;
      }

      Object.keys(recipe).forEach(function (slug) {
        var ing = slugToIng[slug];
        if (!ing) {
          console.warn("  ⚠ Slug bahan tiada ID:", slug, "(produk:", productName + ")");
          return;
        }
        var perUnit = usageBaseQty(ing, recipe[slug]);
        if (perUnit <= 0) return;
        var total = perUnit * lineQty;
        usageBySlug[slug] = round4((usageBySlug[slug] || 0) + total);
      });
    });
  });

  Object.keys(unknownProducts).forEach(function (name) {
    console.warn("  ⚠ Produk tiada resipi:", name, "×", unknownProducts[name]);
  });

  return usageBySlug;
}

async function loadBatchesForIngredient(db, ingredientId) {
  var snap = await db.collection(COL_INGREDIENT_BATCHES).where("ingredientId", "==", ingredientId).get();
  var batches = [];
  snap.docs.forEach(function (d) {
    var x = d.data();
    var qty = typeof x.qtyRemaining === "number" ? x.qtyRemaining : parseFloat(x.qtyRemaining) || 0;
    if (qty <= 0) return;
    batches.push({
      id: d.id,
      ref: d.ref,
      ingredientId: String(x.ingredientId || ingredientId),
      qtyRemaining: qty,
      costPerUnit: typeof x.costPerUnit === "number" ? x.costPerUnit : parseFloat(x.costPerUnit) || 0,
      openedAt: x.openedAt
    });
  });
  return sortBatchesFifo(batches);
}

function sumBatchQty(batches) {
  return round4(
    batches.reduce(function (s, b) {
      return s + b.qtyRemaining;
    }, 0)
  );
}

function deductFifo(batches, needQty) {
  var remain = needQty;
  var updates = [];
  var costTotal = 0;
  var consumed = 0;

  for (var i = 0; i < batches.length && remain > 0.00001; i++) {
    var b = batches[i];
    var take = Math.min(b.qtyRemaining, remain);
    if (take <= 0) continue;
    var newQty = round4(b.qtyRemaining - take);
    if (newQty < 0.00001) newQty = 0;
    updates.push({ ref: b.ref, qtyRemaining: newQty });
    b.qtyRemaining = newQty;
    costTotal += take * b.costPerUnit;
    consumed += take;
    remain = round4(remain - take);
  }

  return {
    updates: updates,
    consumed: round4(consumed),
    shortfall: round4(Math.max(0, remain)),
    costTotal: roundMoney(costTotal)
  };
}

async function commitWriteBatch(db, ops) {
  if (ops.length === 0) return;
  for (var i = 0; i < ops.length; i += BATCH_LIMIT) {
    var chunk = ops.slice(i, i + BATCH_LIMIT);
    var batch = db.batch();
    chunk.forEach(function (op) {
      if (op.type === "update") {
        batch.update(op.ref, op.data);
      } else if (op.type === "set") {
        batch.set(op.ref, op.data);
      }
    });
    await batch.commit();
  }
}

async function processMonth(db, cfg, slugToIng, recipeMap) {
  var bounds = monthBounds(cfg.year, cfg.month);
  console.log("\n→ " + cfg.label + " (" + cfg.key + ")");

  var already = await monthAlreadyProcessed(db, bounds, cfg.key);
  if (already) {
    console.log("  ⏭  Sudah diproses (sale_consumption wujud), dilangkau.");
    return { skipped: true };
  }

  var receipts = await fetchReceiptsInRange(db, bounds.start, bounds.end);
  console.log("  Resit (bukan void):", receipts.length);
  if (receipts.length === 0) {
    console.log("  ⏭  Tiada resit — dilangkau.");
    return { skipped: true, reason: "no_receipts" };
  }

  var usageBySlug = aggregateUsageFromReceipts(receipts, recipeMap, slugToIng);
  var slugs = Object.keys(usageBySlug);
  console.log("  Bahan digunakan:", slugs.length);

  var writeOps = [];
  var ledgerSummaries = [];

  for (var si = 0; si < slugs.length; si++) {
    var slug = slugs[si];
    var needQty = usageBySlug[slug];
    var ing = slugToIng[slug];
    if (!ing) {
      console.warn("  ⚠ Langkau slug tanpa ID:", slug);
      continue;
    }

    var batches = await loadBatchesForIngredient(db, ing.id);
    var stockBefore = sumBatchQty(batches);
    var result = deductFifo(batches, needQty);
    var stockAfter = sumBatchQty(batches);

    result.updates.forEach(function (u) {
      writeOps.push({ type: "update", ref: u.ref, data: { qtyRemaining: u.qtyRemaining } });
    });

    var avgCpu =
      result.consumed > 0 ? roundMoney(result.costTotal / result.consumed) : roundMoney(ing.purchasePrice / ing.purchaseQty);

    console.log(
      "  " +
        ing.name +
        " — guna " +
        needQty +
        " " +
        ing.unit +
        ", stok " +
        stockBefore +
        " → " +
        stockAfter +
        " " +
        ing.unit +
        (result.shortfall > 0 ? " (⚠ kurang " + result.shortfall + ")" : "")
    );

    if (result.consumed > 0) {
      ledgerSummaries.push({
        ingredientId: ing.id,
        nameSnapshot: ing.name,
        unit: ing.unit,
        totalQtyConsumed: result.consumed,
        totalCostConsumed: result.costTotal,
        averageCostPerUnit: avgCpu
      });
    }

    if (result.shortfall > 0) {
      console.warn(
        "  ⚠ Stok tidak mencukupi untuk " +
          ing.name +
          ": perlukan " +
          needQty +
          ", hanya " +
          result.consumed +
          " ditolak"
      );
    }
  }

  for (var li = 0; li < ledgerSummaries.length; li++) {
    var row = ledgerSummaries[li];
    var ledgerRef = db.collection(COL_INGREDIENT_LEDGER).doc();
    writeOps.push({
      type: "set",
      ref: ledgerRef,
      data: {
        kind: "sale_consumption",
        occurredAt: bounds.lastDay,
        createdAt: FieldValue.serverTimestamp(),
        ingredientId: row.ingredientId,
        nameSnapshot: row.nameSnapshot,
        purchaseQty: -row.totalQtyConsumed,
        unit: row.unit,
        costPerUnit: row.averageCostPerUnit,
        purchasePrice: -row.totalCostConsumed,
        notes: "Penggunaan automatik berdasarkan jualan " + cfg.key
      }
    });
  }

  await commitWriteBatch(db, writeOps);

  console.log(
    "  ✓ " +
      cfg.label +
      ": " +
      ledgerSummaries.length +
      " entri lejar, " +
      writeOps.length +
      " operasi batch"
  );

  return {
    skipped: false,
    receipts: receipts.length,
    ingredients: ledgerSummaries.length,
    writes: writeOps.length
  };
}

/**
 * Backfill penggunaan stok FIFO dari pos_receipts Apr & Mei 2026.
 */
export async function seedBackfillStockUsage() {
  if (!ensureAdminInitialized()) {
    throw new Error("Admin SDK tidak sedia — credential atau emulator diperlukan.");
  }

  var db = getAdminFirestore();
  var maps = await buildSlugMaps(db);
  var slugToIng = maps.slugToIng;
  var recipeMap = maps.recipeMap;

  console.log("Resipi produk:", Object.keys(recipeMap).length);
  console.log("Bahan Firestore:", Object.keys(slugToIng).length);

  var totals = { monthsProcessed: 0, skipped: 0, writes: 0 };

  for (var m = 0; m < MONTH_CONFIGS.length; m++) {
    var result = await processMonth(db, MONTH_CONFIGS[m], slugToIng, recipeMap);
    if (result.skipped) {
      totals.skipped += 1;
    } else {
      totals.monthsProcessed += 1;
      totals.writes += result.writes || 0;
    }
  }

  console.log("\n✓ Backfill stok selesai.");
  console.log("  Bulan diproses:", totals.monthsProcessed);
  console.log("  Bulan dilangkau:", totals.skipped);
  console.log("  Jumlah operasi tulis:", totals.writes);

  return totals;
}

async function main() {
  console.log("Backfill penggunaan stok (Apr & Mei 2026) …");
  await seedBackfillStockUsage();
}

var isMain = false;
try {
  isMain = import.meta.url === pathToFileURL(process.argv[1]).href;
} catch (e) {}
if (isMain) {
  main().catch(function (err) {
    console.error(err);
    process.exit(1);
  });
}
