/**
 * Kalkulator kos POS — penyambungan UI, Firestore, dan navigasi hash.
 */
import { db, Timestamp } from "../firebase/init.js";
import { docToIngredient, docToProduct } from "./mappers.js";
import {
  subscribeIngredients,
  addIngredient,
  persistIngredient,
  deleteIngredientAndPruneModifiers
} from "./ingredients-repository.js";
import { subscribeIngredientLedger, addIngredientLedgerEntry } from "./ingredient-ledger-repository.js";
import {
  createPurchaseBatch,
  subscribeIngredientBatches,
  groupBatchesByIngredientId,
  getActiveFifoBatchFromList,
  sortBatchesFifo
} from "./ingredient-batch-repository.js";
import { subscribeModifiers, addModifier, persistModifier, deleteModifier } from "./modifiers-repository.js";
import { enrichProductsWithResolvedUsage } from "./package-resolved-usage.js";
import {
  formatRM,
  costPerUnit,
  productCost,
  escapeHtml,
  escapeAttr,
  getUsagePart,
  usageBaseQty,
  isMassVolumeUnit,
  normalizeUnit
} from "./core.js";

function setLineStatus(elementId, text, kind) {
  var el = document.getElementById(elementId);
  if (!el) return;
  if (!text) {
    el.textContent = "";
    el.hidden = true;
    el.className = "kb-status kb-status--hidden";
    return;
  }
  el.hidden = false;
  el.textContent = text;
  if (kind === "error") el.className = "kb-status kb-status--error";
  else if (kind === "ok") el.className = "kb-status kb-status--ok";
  else el.className = "kb-status";
}

/** Jangan padam mesej kejayaan ringkas pada setiap snapshot — hanya kosongkan banner ralat. */
function clearStatusIfError(elementId) {
  var el = document.getElementById(elementId);
  if (!el || el.hidden) return;
  if (el.classList.contains("kb-status--error")) {
    setLineStatus(elementId, "", null);
  }
}

function touchFocusIngredientRow(docId) {
  var tbody = document.getElementById("ing-tbody");
  if (!tbody || !docId) return false;
  var tr = tbody.querySelector(
    'tr.ing-row-main[data-id="' + String(docId).replace(/"/g, "") + '"]'
  );
  if (!tr) return false;
  var drawerBtn = tr.querySelector(".js-open-ing-drawer");
  if (drawerBtn) {
    try {
      drawerBtn.focus();
    } catch (e2) {
      /* ignore */
    }
  }
  try {
    tr.scrollIntoView({ block: "nearest", behavior: "smooth" });
  } catch (e) {
    tr.scrollIntoView(false);
  }
  return true;
}

function firestoreErrorMessage(err) {
  if (!err) return "Ralat tidak diketahui.";
  var c = err.code;
  if (c === "permission-denied") {
    return "Firestore menafikan baca/tulis. Kemas kini firestore.rules (contoh: benarkan baca/tulis untuk pembangunan) atau gunakan Emulator — lihat PANDUAN-FIREBASE.md.";
  }
  var msg = err.message || String(err);
  if (msg.indexOf("index") !== -1 && msg.indexOf("https://") !== -1) {
    return "Sejarah tidak dimuatkan: Firestore memerlukan indeks untuk koleksi ingredient_ledger. Buka konsol pelayar (F12) untuk pautan “create index”, atau jalankan firebase deploy --only firestore:indexes.";
  }
  if (msg.length > 360) {
    return msg.slice(0, 300).trim() + "…";
  }
  return msg;
}

function ingredientDisplayCostPerUnit(ing) {
  var active = getActiveFifoBatchFromList(batchesByIngredientId[ing.id] || []);
  if (active) return active.costPerUnit;
  return costPerUnit(ing);
}

/** Paparan nombor pakej (elakkan float berlebihan). */
function formatPackQtyForDisplay(n) {
  var x = typeof n === "number" ? n : parseFloat(n);
  if (isNaN(x)) x = 0;
  if (Math.abs(x - Math.round(x)) < 1e-9) return String(Math.round(x));
  var r = Math.round(x * 1000) / 1000;
  var s = String(r);
  if (s.indexOf(".") !== -1) s = s.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  return s;
}

/**
 * Teks kolum jumlah pakej: baki semasa / asal untuk lot FIFO aktif;
 * jika tiada baki pada mana-mana lot, jumlahkan semua lot;
 * jika tiada dokumen lot, tunjuk rujukan bahan.
 */
function formatIngredientBakiPackDisplay(ing) {
  var raw = batchesByIngredientId[ing.id] || batchesByIngredientId[String(ing.id)] || [];
  var list = sortBatchesFifo(raw);
  var active = getActiveFifoBatchFromList(list);
  if (active) {
    return (
      formatPackQtyForDisplay(active.qtyRemaining) +
      "/" +
      formatPackQtyForDisplay(active.qtyOriginal)
    );
  }
  if (list.length) {
    var sumRem = 0;
    var sumOrig = 0;
    list.forEach(function (b) {
      sumRem += typeof b.qtyRemaining === "number" ? b.qtyRemaining : parseFloat(b.qtyRemaining) || 0;
      sumOrig += typeof b.qtyOriginal === "number" ? b.qtyOriginal : parseFloat(b.qtyOriginal) || 0;
    });
    return formatPackQtyForDisplay(sumRem) + "/" + formatPackQtyForDisplay(sumOrig);
  }
  var pq = ing.purchaseQty;
  var pqN = typeof pq === "number" ? pq : parseFloat(pq);
  if (!isNaN(pqN) && pqN > 0) {
    return "—/" + formatPackQtyForDisplay(pqN);
  }
  return "—/—";
}

/**
 * Ambang stok rendah — nisbah baki lot FIFO aktif berbanding kuantiti asal pakej lot itu.
 * Contoh 0.25 = amaran "Rendah" apabila tinggal ≤25% daripada asal.
 * (Penggunaan harian / ambang mutlak perlu data atau medan tambahan — tidak digunakan buat masa ini.)
 */
var LOW_STOCK_ACTIVE_LOT_FRACTION = 0.25;

/**
 * @returns {{ key: string, label: string, title: string }}
 */
function getIngredientStockStatus(ing) {
  var raw = batchesByIngredientId[ing.id] || batchesByIngredientId[String(ing.id)] || [];
  var list = sortBatchesFifo(raw);
  if (!list.length) {
    return {
      key: "nolot",
      label: "Tiada lot",
      title: "Tiada rekod lot. Tambah belian untuk mula jejak stok."
    };
  }
  var sumRem = 0;
  list.forEach(function (b) {
    sumRem += typeof b.qtyRemaining === "number" ? b.qtyRemaining : parseFloat(b.qtyRemaining) || 0;
  });
  var active = getActiveFifoBatchFromList(list);
  if (sumRem <= 0 || !active) {
    return {
      key: "out",
      label: "Habis",
      title: "Tiada baki untuk jualan (semua lot kosong)."
    };
  }
  var orig = typeof active.qtyOriginal === "number" ? active.qtyOriginal : parseFloat(active.qtyOriginal) || 0;
  var rem = typeof active.qtyRemaining === "number" ? active.qtyRemaining : parseFloat(active.qtyRemaining) || 0;
  if (orig <= 0) {
    return {
      key: "ok",
      label: "OK",
      title: "Lot aktif ada baki; kuantiti asal tidak sah untuk nisbah."
    };
  }
  var ratio = rem / orig;
  if (ratio <= LOW_STOCK_ACTIVE_LOT_FRACTION) {
    return {
      key: "low",
      label: "Rendah",
      title:
        "Lot FIFO aktif tinggal " +
        Math.round(ratio * 100) +
        "% daripada asal (ambang rendah ≤ " +
        Math.round(LOW_STOCK_ACTIVE_LOT_FRACTION * 100) +
        "%)."
    };
  }
  return {
    key: "ok",
    label: "OK",
    title: "Lot FIFO aktif melebihi ambang stok rendah (" + Math.round(LOW_STOCK_ACTIVE_LOT_FRACTION * 100) + "%)."
  };
}

function ingredientStockStatusCellHtml(ing) {
  var st = getIngredientStockStatus(ing);
  return (
    '<td class="ing-col-status" title="' +
    escapeAttr(st.title) +
    '"><span class="ing-status ing-status--' +
    st.key +
    ' js-ing-status">' +
    escapeHtml(st.label) +
    "</span></td>"
  );
}

/** Ayat tarikh stok lot FIFO aktif (bawah nama pada jadual utama). */
function formatIngredientStockLineHtml(ing) {
  var raw = batchesByIngredientId[ing.id] || [];
  var list = sortBatchesFifo(raw);
  var active = getActiveFifoBatchFromList(list);
  if (active) {
    var when = active.purchaseOccurredAt || active.openedAt;
    return (
      '<p class="ing-stock-line js-ing-stock-line">Stok ini dibeli pada <strong>' +
      escapeHtml(formatFsDate(when)) +
      "</strong>.</p>"
    );
  }
  if (list.length) {
    return (
      '<p class="ing-stock-line js-ing-stock-line ing-stock-line--muted">Tiada baki. <strong>Tambah belian</strong>.</p>'
    );
  }
  return '<p class="ing-stock-line js-ing-stock-line ing-stock-line--muted">Tiada lot — <strong>Tambah belian</strong>.</p>';
}

function getActiveLedgerEntryIdForIngredient(ingId) {
  var list = batchesByIngredientId[String(ingId)] || [];
  var active = getActiveFifoBatchFromList(list);
  if (!active || !active.ledgerEntryId) return null;
  return String(active.ledgerEntryId);
}

function patchIngredientBatchDisplays() {
  var tbody = document.getElementById("ing-tbody");
  if (!tbody || !ingredients.length) return;
  ingredients.forEach(function (ing) {
    var tr = tbody.querySelector('tr.ing-row-main[data-id="' + String(ing.id).replace(/"/g, "") + '"]');
    if (!tr) return;
    var lineEl = tr.querySelector(".js-ing-stock-line");
    if (lineEl) lineEl.outerHTML = formatIngredientStockLineHtml(ing);
    var bakiEl = tr.querySelector(".js-ing-baki-pack");
    if (bakiEl) bakiEl.textContent = formatIngredientBakiPackDisplay(ing);
    var cpuCell = tr.querySelector("td.ing-col-cpu");
    if (cpuCell) cpuCell.textContent = formatRM(ingredientDisplayCostPerUnit(ing));
    var statusTd = tr.querySelector("td.ing-col-status");
    if (statusTd) {
      var st = getIngredientStockStatus(ing);
      statusTd.title = st.title;
      statusTd.innerHTML =
        '<span class="ing-status ing-status--' +
        st.key +
        ' js-ing-status">' +
        escapeHtml(st.label) +
        "</span>";
    }
  });
}

function setIngAddDraftError(text) {
  var el = document.getElementById("ing-add-draft-err");
  if (!el) return;
  if (!text) {
    el.textContent = "";
    el.hidden = true;
    el.className = "kb-status kb-status--hidden ing-add-draft__err";
    return;
  }
  el.hidden = false;
  el.textContent = text;
  el.className = "kb-status kb-status--error ing-add-draft__err";
}

function resetIngAddDraftForm() {
  var nameEl = document.getElementById("ing-draft-name");
  var priceEl = document.getElementById("ing-draft-price");
  var qtyEl = document.getElementById("ing-draft-qty");
  if (nameEl) nameEl.value = "";
  if (priceEl) priceEl.value = "0";
  if (qtyEl) qtyEl.value = "1";
  var unitEl = document.getElementById("ing-draft-unit");
  if (unitEl) fillUnitSelectElement(unitEl, "g");
  setIngAddDraftError("");
}

function isIngAddDraftVisible() {
  var panel = document.getElementById("ing-add-draft");
  return !!(panel && !panel.hidden);
}

function showIngAddDraftPanel() {
  var panel = document.getElementById("ing-add-draft");
  if (!panel) return;
  resetIngAddDraftForm();
  panel.hidden = false;
  panel.removeAttribute("hidden");
  var nameEl = document.getElementById("ing-draft-name");
  if (nameEl) {
    try {
      nameEl.focus();
    } catch (e) {
      /* ignore */
    }
  }
}

function hideIngAddDraftPanel() {
  var panel = document.getElementById("ing-add-draft");
  if (!panel) return;
  panel.hidden = true;
  panel.setAttribute("hidden", "");
  resetIngAddDraftForm();
}

/** Paparan langsung: Jumlah (RM) ÷ jumlah total bahan dibeli = modal seunit lot (borang Tambah belian). */
function updateIngDrawerCpuPreview() {
  var qtyEl = document.getElementById("ing-log-qty");
  var priceEl = document.getElementById("ing-log-price");
  var unitEl = document.getElementById("ing-log-unit");
  var out = document.getElementById("ing-log-cpu-preview");
  if (!qtyEl || !priceEl || !out) return;
  var qty = parseFloat(qtyEl.value) || 0;
  var price = parseFloat(priceEl.value) || 0;
  var unit = unitEl && unitEl.value ? String(unitEl.value) : "";
  if (qty <= 0) {
    out.textContent = "—";
    return;
  }
  var cpu = price / qty;
  out.textContent = formatRM(cpu) + (unit ? " / " + unit : "");
}

function formatFsDate(v) {
  if (!v) return "—";
  try {
    var d = typeof v.toDate === "function" ? v.toDate() : null;
    if (!d || isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("ms-MY", { day: "numeric", month: "short", year: "numeric" });
  } catch (e) {
    return "—";
  }
}

function ledgerKindLabel(k) {
  if (k === "initial") return "Daftar";
  if (k === "purchase") return "Beli";
  if (k === "price_adjust") return "Harga";
  return k ? String(k) : "—";
}

function docToLedgerEntry(d) {
  var x = d.data();
  return {
    id: d.id,
    kind: x.kind || "",
    occurredAt: x.occurredAt,
    purchasePrice: typeof x.purchasePrice === "number" ? x.purchasePrice : parseFloat(x.purchasePrice) || 0,
    purchaseQty: typeof x.purchaseQty === "number" ? x.purchaseQty : parseFloat(x.purchaseQty) || 0,
    unit: x.unit || "",
    costPerUnit: typeof x.costPerUnit === "number" ? x.costPerUnit : parseFloat(x.costPerUnit) || 0,
    notes: x.notes || ""
  };
}

function fillUnitSelectElement(el, current) {
  if (!el) return;
  var cur = current || "g";
  el.innerHTML = ["g", "kg", "ml", "L", "biji", "keping", "paket"]
    .map(function (unit) {
      return "<option" + (unit === cur ? " selected" : "") + ">" + escapeHtml(unit) + "</option>";
    })
    .join("");
}

function cloneUsageDeep(u) {
  var o = {};
  Object.keys(u).forEach(function (k) {
    var v = u[k];
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      o[k] = {
        guna: typeof v.guna === "number" ? v.guna : parseFloat(v.guna) || 0,
        gunaUnit: v.gunaUnit != null && v.gunaUnit !== "" ? String(v.gunaUnit) : null
      };
    } else {
      o[k] = v;
    }
  });
  return o;
}

function clonePackageLines(lines) {
  return (lines || []).map(function (r) {
    return {
      modifierId: String(r.modifierId || "").trim(),
      qty: typeof r.qty === "number" ? r.qty : parseFloat(r.qty) || 1
    };
  });
}

function cloneMemberIds(ids) {
  return (ids || [])
    .map(function (id) {
      return String(id || "").trim();
    })
    .filter(Boolean);
}

function nextProductSortIndex() {
  return (
    products.reduce(function (m, x) {
      return Math.max(m, typeof x.sortIndex === "number" ? x.sortIndex : parseFloat(x.sortIndex) || 0);
    }, 0) + 1
  );
}

function setModalPanelsVisibility(mode) {
  var single = document.getElementById("modal-panel-single");
  var pkg = document.getElementById("modal-panel-package");
  var priceInp = document.getElementById("modal-price");
  var priceField = priceInp ? priceInp.closest(".field") : null;
  var statsEl = document.getElementById("modal-stats");
  if (single) {
    single.hidden = mode !== "single";
    single.style.display = mode === "single" ? "" : "none";
  }
  if (pkg) {
    pkg.hidden = mode !== "package";
    pkg.style.display = mode === "package" ? "" : "none";
  }
  if (priceField) priceField.hidden = mode === "package";
  if (statsEl) {
    statsEl.hidden = mode === "package";
    if (mode === "package") statsEl.innerHTML = "";
  }
}

var isPackageCatalogMode = false;
var MODIFIERS_UI_FULL = {
  titleText: "Produk & kos",
  descHtml: "<strong>Produk</strong> — resipi &amp; harga. Pakej: <strong>Menu Produk</strong> (pejabat belakang)."
};
var MODIFIERS_UI_CATALOG = {
  titleText: "Pakej",
  descHtml: "Produk tunggal: <strong>Inventori → Produk &amp; kos</strong>."
};

function syncPackageCatalogChrome() {
  document.documentElement.classList.toggle("kb-package-catalog", isPackageCatalogMode);
  var navIng = document.getElementById("nav-ingredients");
  if (navIng) navIng.hidden = isPackageCatalogMode;
  var h = document.getElementById("h-mod");
  var desc = document.querySelector("#page-modifiers .page-desc");
  var src = isPackageCatalogMode ? MODIFIERS_UI_CATALOG : MODIFIERS_UI_FULL;
  if (h) h.textContent = src.titleText;
  if (desc) desc.innerHTML = src.descHtml;
}

function uomSelectHtml(ing, selectedUnit) {
  var opts = [
    { v: "ml", l: "ml" },
    { v: "g", l: "g" },
    { v: "kg", l: "kg" },
    { v: "L", l: "liter" }
  ];
  var sel = normalizeUnit(selectedUnit);
  return (
    '<select class="js-modal-uom" aria-label="Unit ' +
    escapeAttr(ing.name) +
    '">' +
    opts
      .map(function (o) {
        return (
          '<option value="' +
          escapeAttr(o.v) +
          '"' +
          (normalizeUnit(o.v) === sel ? " selected" : "") +
          ">" +
          escapeHtml(o.l) +
          "</option>"
        );
      })
      .join("") +
    "</select>"
  );
}

function uomPlaceholderHtml() {
  return '<span class="ing-check-row__uom-na" aria-hidden="true">—</span>';
}

var ingredients = [];
var rawProducts = [];
var products = [];
var pendingFocusIngredientId = null;
var ingSuccessMsgTimer = null;
var appLoadingEl = document.getElementById("app-loading");
var streamsReady = { ingredients: false, modifiers: false };

var modalState = { open: false, productId: null, snapshot: null, draftProduct: null, mode: "single" };

var selectedLedgerIngredientId = null;
var ledgerUnsubscribe = null;
/** Langganan koleksi inventori utama — dibuang pada `pagehide` untuk elak pendua (HMR/tab). */
var coreInventoryUnsubs = [];
var coreInventoryPagehideBound = false;

function teardownCoreInventoryListeners() {
  coreInventoryUnsubs.forEach(function (u) {
    try {
      if (typeof u === "function") u();
    } catch (e) {}
  });
  coreInventoryUnsubs = [];
}

function bindCoreInventoryPagehideOnce() {
  if (coreInventoryPagehideBound) return;
  coreInventoryPagehideBound = true;
  window.addEventListener("pagehide", teardownCoreInventoryListeners);
}

/** Snapshot lejar terakhir (pop-up) — untuk render semula highlight batch selepas kemas kini lot. */
var lastLedgerSnapForDrawer = null;
/** @type {Record<string, Array<object>>} */
var batchesByIngredientId = {};

function tryHideAppLoading() {
  if (streamsReady.ingredients && streamsReady.modifiers && appLoadingEl) {
    appLoadingEl.hidden = true;
  }
}

function recomputeProductsFromRaw() {
  products = enrichProductsWithResolvedUsage(rawProducts, ingredients);
}

function unitOptions(current) {
  var units = ["g", "kg", "ml", "L", "biji", "keping", "paket"];
  return units
    .map(function (u) {
      return "<option" + (u === current ? " selected" : "") + ">" + escapeHtml(u) + "</option>";
    })
    .join("");
}

function renderIngTable() {
  var tbody = document.getElementById("ing-tbody");
  tbody.innerHTML = "";
  ingredients.forEach(function (ing) {
    var cpu = ingredientDisplayCostPerUnit(ing);
    var tr = document.createElement("tr");
    tr.className = "ing-row-main";
    tr.dataset.id = String(ing.id);
    tr.innerHTML =
      '<td class="ing-cell-name">' +
      '<span class="ing-name-display">' +
      escapeHtml(ing.name && String(ing.name).trim() ? ing.name.trim() : "Tanpa nama") +
      "</span>" +
      formatIngredientStockLineHtml(ing) +
      "</td>" +
      '<td class="ing-col-pack ing-col-num ing-col--readonly" title="Baca sahaja">' +
      '<span class="ing-ref-pack" aria-label="Harga pakej (RM)">' +
      escapeHtml(String(ing.purchasePrice)) +
      "</span></td>" +
      '<td class="ing-col-pack ing-col-num ing-col-baki ing-col--readonly" title="Baki / asal (ikut giliran lot)">' +
      '<span class="ing-ref-pack ing-ref-pack--baki js-ing-baki-pack" aria-label="Baki berbanding asal">' +
      escapeHtml(formatIngredientBakiPackDisplay(ing)) +
      "</span></td>" +
      '<td class="ing-col-pack ing-col--readonly" title="Baca sahaja">' +
      '<span class="ing-ref-pack" aria-label="Unit pakej rujukan">' +
      escapeHtml(ing.unit || "—") +
      "</span></td>" +
      '<td class="num ing-col-cpu" data-label="Kos / unit" title="Kos seunit">' +
      formatRM(cpu) +
      "</td>" +
      ingredientStockStatusCellHtml(ing) +
      '<td class="ing-col-actions">' +
      '<div class="ing-actions">' +
      '<button type="button" class="btn btn--outline btn--sm js-open-ing-drawer" data-id="' +
      escapeAttr(String(ing.id)) +
      '" title="Tambah belian">Tambah belian</button>' +
      '<button type="button" class="btn btn--danger btn--sm js-remove-ing" data-id="' +
      escapeAttr(String(ing.id)) +
      '">Buang</button>' +
      "</div></td>";
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll(".js-remove-ing").forEach(function (btn) {
    btn.addEventListener("click", onRemoveIng);
  });

  renderProductGrid();
}

async function onRemoveIng(e) {
  var id = String(e.target.getAttribute("data-id") || "");
  if (!id) return;
  try {
    if (selectedLedgerIngredientId && String(selectedLedgerIngredientId) === id) {
      closeIngredientDrawer();
    }
    await deleteIngredientAndPruneModifiers(id);
  } catch (err) {
    console.error(err);
  }
}

function setDrawerLogStatus(text, kind) {
  setLineStatus("ing-drawer-log-status", text, kind);
}

function closeIngredientDrawer() {
  selectedLedgerIngredientId = null;
  lastLedgerSnapForDrawer = null;
  if (ledgerUnsubscribe) {
    ledgerUnsubscribe();
    ledgerUnsubscribe = null;
  }
  var bd = document.getElementById("ing-drawer-backdrop");
  if (bd) {
    bd.hidden = true;
    bd.setAttribute("hidden", "");
    bd.setAttribute("aria-hidden", "true");
  }
  var errEl = document.getElementById("ing-drawer-ledger-err");
  if (errEl) {
    errEl.textContent = "";
    errEl.hidden = true;
    errEl.className = "kb-status kb-status--hidden";
  }
  setDrawerLogStatus("", null);
}

function renderLedgerRows(snap) {
  var tbody = document.getElementById("ing-ledger-tbody");
  if (!tbody) return;
  if (!snap || snap.empty) {
    tbody.innerHTML =
      '<tr><td colspan="5" class="ing-ledger-empty">Tiada sejarah. Simpan rekod pertama di atas.</td></tr>';
    return;
  }
  var activeLedgerId = selectedLedgerIngredientId
    ? getActiveLedgerEntryIdForIngredient(selectedLedgerIngredientId)
    : null;
  tbody.innerHTML = snap.docs
    .map(function (d) {
      var row = docToLedgerEntry(d);
      var isActive = activeLedgerId && String(row.id) === String(activeLedgerId);
      var pack =
        escapeHtml(String(row.purchasePrice)) +
        " RM · " +
        escapeHtml(String(row.purchaseQty)) +
        " " +
        escapeHtml(row.unit || "");
      return (
        "<tr" +
        (isActive ? ' class="ing-ledger-row ing-ledger-row--active"' : "") +
        "><td class=\"ing-ledger-date\">" +
        escapeHtml(formatFsDate(row.occurredAt)) +
        "</td><td class=\"ing-ledger-kind\">" +
        escapeHtml(ledgerKindLabel(row.kind)) +
        "</td><td class=\"ing-ledger-pack\">" +
        pack +
        "</td><td class=\"num ing-ledger-cpu\">" +
        escapeHtml(formatRM(row.costPerUnit)) +
        "</td><td class=\"ing-ledger-note\">" +
        escapeHtml(row.notes || "—") +
        "</td></tr>"
      );
    })
    .join("");
}

function openIngredientDrawer(ingredientId) {
  var id = String(ingredientId || "");
  var ing = ingredients.find(function (x) {
    return String(x.id) === id;
  });
  if (!ing) return;

  closeIngredientDrawer();
  selectedLedgerIngredientId = id;

  var tbody = document.getElementById("ing-tbody");
  var bd = document.getElementById("ing-drawer-backdrop");
  var title = document.getElementById("ing-drawer-title");
  var sub = document.getElementById("ing-drawer-sub");
  if (title) title.textContent = ing.name || "Bahan";
  if (sub) {
    var u = ing.unit || "";
    var cpu = formatRM(ingredientDisplayCostPerUnit(ing));
    sub.textContent = cpu + (u ? " / " + u : "");
  }

  var nameField = document.getElementById("ing-log-name");
  if (nameField) nameField.value = ing.name && String(ing.name).trim() ? ing.name.trim() : "";
  document.getElementById("ing-log-qty").value = String(ing.purchaseQty > 0 ? ing.purchaseQty : 1);
  document.getElementById("ing-log-price").value = String(ing.purchasePrice ?? 0);
  fillUnitSelectElement(document.getElementById("ing-log-unit"), ing.unit || "g");
  document.getElementById("ing-log-notes").value = "";
  updateIngDrawerCpuPreview();

  if (bd) {
    bd.removeAttribute("hidden");
    bd.hidden = false;
    bd.setAttribute("aria-hidden", "false");
  }

  ledgerUnsubscribe = subscribeIngredientLedger(
    id,
    function (snap) {
      var errEl = document.getElementById("ing-drawer-ledger-err");
      if (errEl) {
        errEl.textContent = "";
        errEl.hidden = true;
        errEl.className = "kb-status kb-status--hidden";
      }
      lastLedgerSnapForDrawer = snap;
      renderLedgerRows(snap);
    },
    function (err) {
      console.error(err);
      var errEl = document.getElementById("ing-drawer-ledger-err");
      if (errEl) {
        errEl.hidden = false;
        errEl.className = "kb-status kb-status--error";
        errEl.textContent = firestoreErrorMessage(err);
      }
    }
  );
}

function ingSummaryLine(ing, usageVal) {
  var part = getUsagePart(ing, usageVal);
  if (!part.guna) return "";
  var uShow = normalizeUnit(part.gunaUnit) === "L" ? "liter" : part.gunaUnit;
  return ing.name + " (" + part.guna + " " + uShow + ")";
}

/** Produk dalam modal edit, atau draf tambah baharu (belum wujud di Firestore). */
function getModalProduct() {
  if (modalState.draftProduct) return modalState.draftProduct;
  if (!modalState.productId) return null;
  return (
    products.find(function (x) {
      return String(x.id) === String(modalState.productId);
    }) || null
  );
}

function renderPackageMemberCheckboxes() {
  var wrap = document.getElementById("modal-package-lines");
  var p = getModalProduct();
  if (!wrap || !p) return;
  if (!p.packageMemberIds) p.packageMemberIds = [];
  var selected = {};
  p.packageMemberIds.forEach(function (id) {
    selected[String(id)] = true;
  });
  var singles = products.filter(function (x) {
    return x.menuKind !== "package" && String(x.id) !== String(modalState.productId || "");
  });
  if (!singles.length) {
    wrap.innerHTML =
      '<p class="modal-package-empty">Tiada produk tunggal — tambah di <strong>Produk &amp; kos</strong>.</p>';
    return;
  }
  wrap.innerHTML = singles
    .map(function (x) {
      var id = String(x.id);
      var chk = selected[id] ? " checked" : "";
      return (
        '<label class="pkg-member-row"><input type="checkbox" class="js-pkg-member" value="' +
        escapeAttr(id) +
        '"' +
        chk +
        ' /> <span>' +
        escapeHtml(x.name || id) +
        "</span></label>"
      );
    })
    .join("");
  wrap.querySelectorAll(".js-pkg-member").forEach(function (cb) {
    cb.addEventListener("change", function () {
      var pr = getModalProduct();
      if (!pr) return;
      var ids = [];
      wrap.querySelectorAll(".js-pkg-member:checked").forEach(function (c) {
        ids.push(c.value);
      });
      pr.packageMemberIds = ids;
      updateModalStats();
    });
  });
}

function productTileHtml(p) {
  if (p.menuKind === "package") {
    var mids = p.packageMemberIds && p.packageMemberIds.length ? p.packageMemberIds : [];
    var ingText =
      mids.length === 0
        ? escapeHtml("Tiada produk dipilih")
        : mids
            .map(function (mid) {
              var comp = products.find(function (x) {
                return String(x.id) === String(mid);
              });
              return escapeHtml(comp ? comp.name : mid);
            })
            .join(" · ");
    return (
      '<article class="product-tile product-tile--pkg-filter">' +
      '<div class="product-tile__head">' +
      '<h3 class="product-tile__name">' +
      escapeHtml(p.name) +
      '</h3><span class="product-tile__tag product-tile__tag--pkg">Pakej</span></div>' +
      '<div class="product-tile__ings">' +
      ingText +
      '</div><div class="product-tile__footer">' +
      '<div class="product-tile__footer-actions">' +
      '<button type="button" class="btn btn--ghost btn--sm js-edit-product" data-id="' +
      escapeAttr(String(p.id)) +
      '">Sunting</button>' +
      '<button type="button" class="btn btn--danger btn--sm js-delete-product" data-id="' +
      escapeAttr(String(p.id)) +
      '">Padam</button></div></div></article>'
    );
  }
  var cost = productCost(ingredients, p);
  var profit = p.sellingPrice - cost;
  var lines = ingredients
    .map(function (ing) {
      var uv = p.usage[ing.id];
      if (uv == null) return null;
      return usageBaseQty(ing, uv) > 0 ? ingSummaryLine(ing, uv) : null;
    })
    .filter(Boolean);
  var ingText = lines.length ? lines.join(" · ") : "Tiada bahan";
  return (
    '<article class="product-tile">' +
    '<div class="product-tile__head">' +
    '<h3 class="product-tile__name">' +
    escapeHtml(p.name) +
    "</h3></div>" +
    '<div class="product-tile__ings">' +
    escapeHtml(ingText) +
    "</div>" +
    '<div class="product-tile__row"><span>Harga modal</span><strong>' +
    formatRM(cost) +
    "</strong></div>" +
    '<div class="product-tile__row"><span>Harga jual</span><strong>' +
    formatRM(p.sellingPrice) +
    "</strong></div>" +
    '<div class="product-tile__footer">' +
    '<div class="product-tile__footer-profit"><span>Untung</span><strong style="color:' +
    (profit >= 0 ? "var(--success)" : "var(--danger)") +
    '">' +
    formatRM(profit) +
    "</strong></div>" +
    '<div class="product-tile__footer-actions">' +
    '<button type="button" class="btn btn--ghost btn--sm js-edit-product" data-id="' +
    escapeAttr(String(p.id)) +
    '">Sunting</button>' +
    '<button type="button" class="btn btn--danger btn--sm js-delete-product" data-id="' +
    escapeAttr(String(p.id)) +
    '">Padam</button></div></div></article>'
  );
}

function renderProductGrid() {
  var grid = document.getElementById("product-grid");
  var html = "";
  if (isPackageCatalogMode) {
    var pkgs = products.filter(function (x) {
      return x.menuKind === "package";
    });
    html = pkgs.map(productTileHtml).join("");
    html +=
      '<div class="product-grid__add-row">' +
      '<button type="button" class="product-tile tile-add tile-add--pkg" id="btn-add-package"><span>+</span>Pakej</button>' +
      "</div>";
  } else {
    var singlesForGrid = products.filter(function (x) {
      return x.menuKind !== "package";
    });
    html = singlesForGrid.map(productTileHtml).join("");
    html +=
      '<div class="product-grid__add-row">' +
      '<button type="button" class="product-tile tile-add" id="btn-add-product"><span>+</span>Produk</button>' +
      "</div>";
  }
  grid.innerHTML = html;

  grid.querySelectorAll(".js-edit-product").forEach(function (btn) {
    btn.addEventListener("click", function () {
      openModal(String(btn.getAttribute("data-id")));
    });
  });
  grid.querySelectorAll(".js-delete-product").forEach(function (btn) {
    btn.addEventListener("click", function () {
      onDeleteProduct(String(btn.getAttribute("data-id")));
    });
  });
  var addBtn = document.getElementById("btn-add-product");
  if (addBtn) addBtn.addEventListener("click", openCreateProductModal);
  var addPkg = document.getElementById("btn-add-package");
  if (addPkg) addPkg.addEventListener("click", openCreatePackageModal);
}

function openCreateProductModal() {
  modalState.mode = "single";
  modalState.open = true;
  modalState.productId = null;
  modalState.snapshot = null;
  var si = nextProductSortIndex();
  modalState.draftProduct = {
    name: "",
    sellingPrice: 0,
    usage: {},
    menuKind: "single",
    menuCategory: "other",
    sortIndex: si,
    packageLines: [],
    packageMemberIds: []
  };
  document.getElementById("modal-name").value = "";
  document.getElementById("modal-price").value = "0";
  document.getElementById("modal-title").textContent = "Tambah item (resipi)";
  var delBtn = document.getElementById("modal-delete");
  if (delBtn) delBtn.hidden = true;
  var qa = document.getElementById("ing-quick-add");
  if (qa) qa.hidden = true;
  setModalPanelsVisibility("single");
  renderModalBody();
  updateModalStats();
  var bd = document.getElementById("product-modal-backdrop");
  bd.classList.add("is-open");
  bd.setAttribute("aria-hidden", "false");
  document.getElementById("modal-name").focus();
}

function openCreatePackageModal() {
  var singles = products.filter(function (x) {
    return x.menuKind !== "package";
  });
  if (!singles.length) {
    setLineStatus(
      "mod-firestore-status",
      "Tambah produk tunggal di Produk & kos dahulu.",
      "error"
    );
    return;
  }
  modalState.mode = "package";
  modalState.open = true;
  modalState.productId = null;
  modalState.snapshot = null;
  var si = nextProductSortIndex();
  modalState.draftProduct = {
    name: "",
    sellingPrice: 0,
    usage: {},
    menuKind: "package",
    menuCategory: "other",
    sortIndex: si,
    packageLines: [],
    packageMemberIds: [String(singles[0].id)]
  };
  document.getElementById("modal-name").value = "";
  document.getElementById("modal-price").value = "0";
  document.getElementById("modal-title").textContent = "Tambah pakej";
  var delBtn = document.getElementById("modal-delete");
  if (delBtn) delBtn.hidden = true;
  var qa = document.getElementById("ing-quick-add");
  if (qa) qa.hidden = true;
  setModalPanelsVisibility("package");
  renderModalBody();
  updateModalStats();
  var bd = document.getElementById("product-modal-backdrop");
  bd.classList.add("is-open");
  bd.setAttribute("aria-hidden", "false");
  document.getElementById("modal-name").focus();
}

function openModal(productId) {
  var pid = String(productId);
  var p = products.find(function (x) {
    return String(x.id) === pid;
  });
  if (!p) return;
  modalState.draftProduct = null;
  modalState.open = true;
  modalState.productId = pid;
  var isPkg = p.menuKind === "package";
  modalState.mode = isPkg ? "package" : "single";
  if (isPkg) {
    modalState.snapshot = {
      name: p.name,
      sellingPrice: 0,
      menuCategory: p.menuCategory || "other",
      sortIndex: typeof p.sortIndex === "number" ? p.sortIndex : parseFloat(p.sortIndex) || 0,
      packageMemberIds: cloneMemberIds(p.packageMemberIds || [])
    };
  } else {
    modalState.snapshot = {
      name: p.name,
      sellingPrice: p.sellingPrice,
      menuCategory: p.menuCategory || "other",
      sortIndex: typeof p.sortIndex === "number" ? p.sortIndex : parseFloat(p.sortIndex) || 0,
      usage: cloneUsageDeep(p.usage)
    };
  }
  document.getElementById("modal-name").value = p.name;
  document.getElementById("modal-price").value = String(isPkg ? 0 : p.sellingPrice);
  document.getElementById("modal-title").textContent = isPkg ? "Sunting pakej" : "Sunting item (resipi)";
  var delBtn = document.getElementById("modal-delete");
  if (delBtn) delBtn.hidden = false;
  var qa = document.getElementById("ing-quick-add");
  if (qa) qa.hidden = true;
  setModalPanelsVisibility(modalState.mode);
  renderModalBody();
  updateModalStats();
  var bd = document.getElementById("product-modal-backdrop");
  bd.classList.add("is-open");
  bd.setAttribute("aria-hidden", "false");
  document.getElementById("modal-name").focus();
}

function restoreModalSnapshot() {
  if (modalState.draftProduct) return;
  if (!modalState.snapshot || !modalState.productId) return;
  var p = products.find(function (x) {
    return String(x.id) === String(modalState.productId);
  });
  if (!p) return;
  p.name = modalState.snapshot.name;
  p.sellingPrice = modalState.snapshot.sellingPrice;
  p.menuCategory = modalState.snapshot.menuCategory;
  p.sortIndex = modalState.snapshot.sortIndex;
  if (modalState.mode === "package") {
    p.packageMemberIds = cloneMemberIds(modalState.snapshot.packageMemberIds);
  } else {
    p.usage = cloneUsageDeep(modalState.snapshot.usage);
  }
}

function closeModal() {
  if (modalState.open) restoreModalSnapshot();
  closeModalWithoutRestore();
}

function closeModalWithoutRestore() {
  modalState.open = false;
  modalState.productId = null;
  modalState.snapshot = null;
  modalState.draftProduct = null;
  modalState.mode = "single";
  var bd = document.getElementById("product-modal-backdrop");
  if (bd) {
    bd.classList.remove("is-open");
    bd.setAttribute("aria-hidden", "true");
  }
}

async function onDeleteProduct(productId) {
  var id = String(productId || "");
  if (!id) return;
  var p = products.find(function (x) {
    return String(x.id) === id;
  });
  if (!p) return;
  var label = p.name && p.name.trim() ? p.name : "produk ini";
  if (
    !confirm(
      'Padam "' + label + '" dari Produk & kos?\n\nDokumen akan dibuang dari Firestore (modifiers). Tindakan ini tidak boleh dibuat asal.'
    )
  ) {
    return;
  }
  try {
    await deleteModifier(id);
    if (modalState.open && String(modalState.productId) === id) {
      closeModalWithoutRestore();
    }
    setLineStatus("mod-firestore-status", "", null);
  } catch (e) {
    console.error(e);
    setLineStatus("mod-firestore-status", firestoreErrorMessage(e), "error");
  }
}

function renderModalBody() {
  var list = document.getElementById("modal-ing-list");
  var p = getModalProduct();
  if (!p) return;
  setModalPanelsVisibility(modalState.mode);
  if (modalState.mode === "package") {
    renderPackageMemberCheckboxes();
    return;
  }
  list.innerHTML = ingredients
    .map(function (ing) {
      var uv = p.usage[ing.id];
      var part = getUsagePart(ing, uv);
      var checked = usageBaseQty(ing, uv) > 0;
      var lineCost = costPerUnit(ing) * (checked ? usageBaseQty(ing, uv) : 0);
      var safeId = String(ing.id).replace(/[^a-zA-Z0-9_-]/g, "_");
      var uomCell = isMassVolumeUnit(ing.unit)
        ? uomSelectHtml(ing, part.gunaUnit)
        : uomPlaceholderHtml();
      return (
        '<div class="ing-check-row' +
        (checked ? "" : " is-disabled") +
        '" data-ing-id="' +
        escapeAttr(String(ing.id)) +
        '">' +
        '<input type="checkbox" class="js-modal-check" id="chk-' +
        safeId +
        '"' +
        (checked ? " checked" : "") +
        " />" +
        '<label for="chk-' +
        safeId +
        '">' +
        escapeHtml(ing.name) +
        " <small style=\"color:#888\">(" +
        formatRM(costPerUnit(ing)) +
        "/" +
        escapeHtml(ing.unit) +
        ")</small></label>" +
        '<input type="number" class="js-modal-qty" min="0" step="0.001" value="' +
        (checked ? part.guna : 0) +
        '" ' +
        (checked ? "" : "disabled") +
        " />" +
        uomCell +
        '<span class="line-cost">' +
        formatRM(lineCost) +
        "</span></div>"
      );
    })
    .join("");

  list.querySelectorAll(".js-modal-check").forEach(function (cb) {
    cb.addEventListener("change", onModalCheck);
  });
  list.querySelectorAll(".js-modal-qty").forEach(function (inp) {
    inp.addEventListener("input", onModalQty);
  });
  list.querySelectorAll(".js-modal-uom").forEach(function (sel) {
    sel.addEventListener("change", onModalUom);
  });
}

function syncModalUsageFromDom() {
  var p = getModalProduct();
  if (!p || modalState.mode !== "single") return;
  document.getElementById("modal-ing-list").querySelectorAll(".ing-check-row").forEach(function (row) {
    var id = row.dataset.ingId;
    var ing = ingredients.find(function (x) {
      return String(x.id) === String(id);
    });
    var cb = row.querySelector(".js-modal-check");
    var qtyInp = row.querySelector(".js-modal-qty");
    var uomSel = row.querySelector(".js-modal-uom");
    if (!ing) return;
    if (cb.checked) {
      var guna = parseFloat(qtyInp.value) || 0;
      if (isMassVolumeUnit(ing.unit)) {
        p.usage[id] = { guna: guna, gunaUnit: uomSel ? uomSel.value : ing.unit };
      } else {
        p.usage[id] = guna;
      }
    } else {
      delete p.usage[id];
    }
  });
}

function onModalCheck(e) {
  var row = e.target.closest(".ing-check-row");
  if (!row) return;
  var qtyInp = row.querySelector(".js-modal-qty");
  var uomSel = row.querySelector(".js-modal-uom");
  if (e.target.checked) {
    row.classList.remove("is-disabled");
    qtyInp.disabled = false;
    if (uomSel) uomSel.disabled = false;
    if (!parseFloat(qtyInp.value)) qtyInp.value = "1";
  } else {
    row.classList.add("is-disabled");
    qtyInp.disabled = true;
    if (uomSel) uomSel.disabled = true;
    qtyInp.value = "0";
  }
  syncModalLineCost(row);
  updateModalStats();
}

function onModalQty(e) {
  var row = e.target.closest(".ing-check-row");
  if (row) syncModalLineCost(row);
  updateModalStats();
}

function onModalUom(e) {
  var row = e.target.closest(".ing-check-row");
  if (row) syncModalLineCost(row);
  updateModalStats();
}

function syncModalLineCost(row) {
  var id = row.dataset.ingId;
  var ing = ingredients.find(function (x) {
    return String(x.id) === String(id);
  });
  var cb = row.querySelector(".js-modal-check");
  var qtyInp = row.querySelector(".js-modal-qty");
  var uomSel = row.querySelector(".js-modal-uom");
  var lineEl = row.querySelector(".line-cost");
  if (!ing || !lineEl) return;
  if (!cb.checked) {
    lineEl.textContent = formatRM(0);
    return;
  }
  var guna = parseFloat(qtyInp.value) || 0;
  var gunaUnit = uomSel ? uomSel.value : ing.unit;
  var baseQty = usageBaseQty(ing, isMassVolumeUnit(ing.unit) ? { guna: guna, gunaUnit: gunaUnit } : guna);
  lineEl.textContent = formatRM(costPerUnit(ing) * baseQty);
}

function updateModalStats() {
  var p = getModalProduct();
  if (!p) return;
  var price = parseFloat(document.getElementById("modal-price").value) || 0;

  if (modalState.mode === "package") {
    return;
  }

  var draftUsage = {};
  document.getElementById("modal-ing-list").querySelectorAll(".ing-check-row").forEach(function (row) {
    var id = row.dataset.ingId;
    var ing = ingredients.find(function (x) {
      return String(x.id) === String(id);
    });
    var cb = row.querySelector(".js-modal-check");
    var qtyInp = row.querySelector(".js-modal-qty");
    var uomSel = row.querySelector(".js-modal-uom");
    if (!cb || !cb.checked || !ing) return;
    var guna = parseFloat(qtyInp.value) || 0;
    if (isMassVolumeUnit(ing.unit)) {
      draftUsage[id] = { guna: guna, gunaUnit: uomSel ? uomSel.value : ing.unit };
    } else {
      draftUsage[id] = guna;
    }
  });

  var cost = 0;
  ingredients.forEach(function (ing) {
    var entry = draftUsage[ing.id];
    if (entry == null) return;
    var bq = usageBaseQty(ing, entry);
    if (bq > 0) cost += costPerUnit(ing) * bq;
  });
  var profit = price - cost;

  document.getElementById("modal-ing-list").querySelectorAll(".ing-check-row").forEach(syncModalLineCost);

  document.getElementById("modal-stats").innerHTML =
    '<div><span>Jumlah harga modal</span><strong>' +
    formatRM(cost) +
    '</strong></div><div class="stat-sell"><span>Harga jual</span><strong>' +
    formatRM(price) +
    '</strong></div><div class="stat-profit' +
    (profit < 0 ? " is-loss" : "") +
    '"><span>Untung</span><strong>' +
    formatRM(profit) +
    "</strong></div>";
}

function packageMembersValid(ids) {
  if (!ids || !ids.length) return false;
  for (var i = 0; i < ids.length; i++) {
    var mid = String(ids[i] || "").trim();
    if (!mid) return false;
    var comp = products.find(function (x) {
      return String(x.id) === mid;
    });
    if (!comp || comp.menuKind === "package") return false;
  }
  return true;
}

async function saveModal() {
  var p = getModalProduct();
  if (!p) return;
  var rawName = document.getElementById("modal-name").value.trim();
  if (modalState.draftProduct && !rawName) {
    setLineStatus("mod-firestore-status", "Isi nama.", "error");
    return;
  }
  p.name = rawName || "Tanpa nama";
  if (modalState.mode === "single") {
    p.sellingPrice = parseFloat(document.getElementById("modal-price").value) || 0;
  } else {
    p.sellingPrice = 0;
  }

  if (modalState.mode === "package") {
    var membersOut = cloneMemberIds(p.packageMemberIds || []);
    if (!packageMembersValid(membersOut)) {
      setLineStatus(
        "mod-firestore-status",
        "Tandakan sekurang-kurangnya satu produk.",
        "error"
      );
      return;
    }
    var sortVal =
      typeof p.sortIndex === "number" && !isNaN(p.sortIndex) ? p.sortIndex : nextProductSortIndex();
    try {
      if (modalState.draftProduct) {
        await addModifier({
          menuKind: "package",
          menuCategory: "other",
          sortIndex: sortVal,
          name: p.name,
          sellingPrice: 0,
          packageMemberIds: membersOut,
          packageLines: [],
          usage: {}
        });
        setLineStatus("mod-firestore-status", "Pakej disimpan.", "ok");
      } else {
        await persistModifier(p.id, {
          menuKind: "package",
          menuCategory: "other",
          sortIndex: sortVal,
          name: p.name,
          sellingPrice: 0,
          packageMemberIds: membersOut,
          packageLines: [],
          usage: {}
        });
        setLineStatus("mod-firestore-status", "Pakej dikemas kini.", "ok");
      }
    } catch (e) {
      console.error(e);
      setLineStatus("mod-firestore-status", firestoreErrorMessage(e), "error");
      return;
    }
  } else {
    syncModalUsageFromDom();
    var usageOut = cloneUsageDeep(p.usage);
    var sortSingle =
      typeof p.sortIndex === "number" && !isNaN(p.sortIndex) ? p.sortIndex : nextProductSortIndex();
    try {
      if (modalState.draftProduct) {
        await addModifier({
          menuKind: "single",
          menuCategory: p.menuCategory || "other",
          sortIndex: sortSingle,
          name: p.name,
          sellingPrice: p.sellingPrice,
          usage: usageOut,
          packageLines: [],
          packageMemberIds: []
        });
        setLineStatus("mod-firestore-status", "Produk ditambah.", "ok");
      } else {
        await persistModifier(p.id, {
          menuKind: "single",
          menuCategory: p.menuCategory || "other",
          sortIndex: sortSingle,
          name: p.name,
          sellingPrice: p.sellingPrice,
          usage: usageOut,
          packageLines: [],
          packageMemberIds: []
        });
      }
    } catch (e) {
      console.error(e);
      setLineStatus("mod-firestore-status", firestoreErrorMessage(e), "error");
      return;
    }
  }

  modalState.snapshot = null;
  modalState.draftProduct = null;
  modalState.open = false;
  modalState.productId = null;
  modalState.mode = "single";
  var bd = document.getElementById("product-modal-backdrop");
  bd.classList.remove("is-open");
  bd.setAttribute("aria-hidden", "true");
  renderProductGrid();
}

function applyPageUI(name) {
  document.querySelectorAll(".app-sidebar__btn").forEach(function (b) {
    b.classList.toggle("is-active", b.getAttribute("data-page") === name);
  });
  document.getElementById("page-ingredients").classList.toggle("is-visible", name === "ingredients");
  document.getElementById("page-ingredients").hidden = name !== "ingredients";
  document.getElementById("page-modifiers").classList.toggle("is-visible", name === "modifiers");
  document.getElementById("page-modifiers").hidden = name !== "modifiers";
}

function setPage(name) {
  if (name !== "ingredients" && selectedLedgerIngredientId) {
    closeIngredientDrawer();
  }
  applyPageUI(name);
  var hashKey = name;
  if (name === "modifiers" && isPackageCatalogMode) {
    hashKey = "packages";
  }
  var next = "#" + hashKey;
  var cur = (location.hash || "").replace(/^#/, "").toLowerCase();
  if (cur !== String(hashKey).toLowerCase()) {
    history.replaceState(null, "", next);
  }
}

function syncPageFromHash() {
  var h = (location.hash || "").replace(/^#/, "").toLowerCase();
  isPackageCatalogMode = h === "packages";
  syncPackageCatalogChrome();
  var page = h === "ingredients" ? "ingredients" : "modifiers";
  if (page !== "ingredients" && selectedLedgerIngredientId) {
    closeIngredientDrawer();
  }
  applyPageUI(page);
  renderProductGrid();
}

async function init() {
  if (appLoadingEl) appLoadingEl.hidden = false;

  coreInventoryUnsubs.push(
    subscribeIngredients(
    function (snap) {
      ingredients = snap.docs.map(docToIngredient);
      ingredients.sort(function (a, b) {
        return (a.sortIndex || 0) - (b.sortIndex || 0);
      });
      clearStatusIfError("ing-firestore-status");
      renderIngTable();
      if (pendingFocusIngredientId) {
        var focusId = pendingFocusIngredientId;
        if (
          ingredients.some(function (x) {
            return String(x.id) === String(focusId);
          }) &&
          touchFocusIngredientRow(focusId)
        ) {
          pendingFocusIngredientId = null;
        }
      }
      recomputeProductsFromRaw();
      renderProductGrid();
      if (modalState.open) {
        renderModalBody();
        updateModalStats();
      }
      if (!streamsReady.ingredients) {
        streamsReady.ingredients = true;
        tryHideAppLoading();
      }
    },
    function (err) {
      console.error(err);
      ingredients = [];
      renderIngTable();
      recomputeProductsFromRaw();
      renderProductGrid();
      streamsReady.ingredients = true;
      tryHideAppLoading();
      setLineStatus("ing-firestore-status", firestoreErrorMessage(err), "error");
    }
  )
  );

  coreInventoryUnsubs.push(
    subscribeIngredientBatches(
    function (snap) {
      batchesByIngredientId = groupBatchesByIngredientId(snap);
      patchIngredientBatchDisplays();
      if (selectedLedgerIngredientId && lastLedgerSnapForDrawer) {
        renderLedgerRows(lastLedgerSnapForDrawer);
      }
    },
    function (err) {
      console.error(err);
      batchesByIngredientId = {};
      patchIngredientBatchDisplays();
      if (selectedLedgerIngredientId && lastLedgerSnapForDrawer) {
        renderLedgerRows(lastLedgerSnapForDrawer);
      }
    }
  )
  );

  coreInventoryUnsubs.push(
    subscribeModifiers(
    function (snap) {
      rawProducts = snap.docs.map(docToProduct);
      rawProducts.sort(function (a, b) {
        return (a.sortIndex || 0) - (b.sortIndex || 0);
      });
      recomputeProductsFromRaw();
      clearStatusIfError("mod-firestore-status");
      renderProductGrid();
      if (modalState.open) {
        renderModalBody();
        updateModalStats();
      }
      if (!streamsReady.modifiers) {
        streamsReady.modifiers = true;
        tryHideAppLoading();
      }
    },
    function (err) {
      console.error(err);
      rawProducts = [];
      products = [];
      renderProductGrid();
      streamsReady.modifiers = true;
      tryHideAppLoading();
      setLineStatus("mod-firestore-status", firestoreErrorMessage(err), "error");
    }
  )
  );

  bindCoreInventoryPagehideOnce();

  document.getElementById("btn-add-ing").addEventListener("click", function () {
    if (isIngAddDraftVisible()) {
      var nameEl = document.getElementById("ing-draft-name");
      if (nameEl) nameEl.focus();
      return;
    }
    showIngAddDraftPanel();
  });

  var ingDraftCancel = document.getElementById("ing-draft-cancel");
  if (ingDraftCancel) {
    ingDraftCancel.addEventListener("click", function () {
      hideIngAddDraftPanel();
    });
  }

  var ingDraftForm = document.getElementById("ing-add-draft-form");
  if (ingDraftForm) {
    ingDraftForm.addEventListener("submit", async function (ev) {
      ev.preventDefault();
      setIngAddDraftError("");
      var name = (document.getElementById("ing-draft-name") && document.getElementById("ing-draft-name").value.trim()) || "";
      if (!name) {
        setIngAddDraftError("Isi nama bahan.");
        return;
      }
      var price = parseFloat(document.getElementById("ing-draft-price").value) || 0;
      if (price < 0) {
        setIngAddDraftError("Jumlah (RM) tidak boleh negatif.");
        return;
      }
      var qty = parseFloat(document.getElementById("ing-draft-qty").value) || 0;
      if (qty <= 0) {
        setIngAddDraftError("Kuantiti pakej mesti lebih daripada 0.");
        return;
      }
      var unit = document.getElementById("ing-draft-unit").value || "g";
      var nextSort =
        ingredients.reduce(function (m, x) {
          return Math.max(m, typeof x.sortIndex === "number" ? x.sortIndex : 0);
        }, 0) + 1;
      var draftIng = {
        id: "temp",
        name: name,
        purchasePrice: price,
        purchaseQty: qty,
        unit: unit,
        sortIndex: nextSort
      };
      var cpu = costPerUnit(draftIng);
      var purchaseAt = Timestamp.now();
      var submitBtn = document.getElementById("ing-draft-submit");
      if (submitBtn) submitBtn.disabled = true;
      try {
        var ref = await addIngredient({
          sortIndex: nextSort,
          name: name,
          purchasePrice: price,
          purchaseQty: qty,
          unit: unit
        });
        try {
          var ledgerRefNewIng = await addIngredientLedgerEntry({
            ingredientId: ref.id,
            kind: "initial",
            occurredAt: purchaseAt,
            purchasePrice: price,
            purchaseQty: qty,
            unit: unit,
            costPerUnit: cpu,
            nameSnapshot: name
          });
          await createPurchaseBatch({
            ingredientId: ref.id,
            qtyRemaining: qty,
            qtyOriginal: qty,
            costPerUnit: cpu,
            purchaseTotalRm: price,
            purchaseOccurredAt: purchaseAt,
            purchaseUnit: unit,
            ledgerEntryId: ledgerRefNewIng.id
          });
        } catch (le) {
          console.error(le);
        }
        hideIngAddDraftPanel();
        pendingFocusIngredientId = ref.id;
        var newId = ref.id;
        if (typeof queueMicrotask === "function") {
          queueMicrotask(function () {
            if (touchFocusIngredientRow(newId)) pendingFocusIngredientId = null;
          });
        }
        setLineStatus("ing-firestore-status", "Bahan ditambah.", "ok");
        if (ingSuccessMsgTimer) clearTimeout(ingSuccessMsgTimer);
        ingSuccessMsgTimer = setTimeout(function () {
          ingSuccessMsgTimer = null;
          var el = document.getElementById("ing-firestore-status");
          if (el && el.classList.contains("kb-status--ok")) {
            setLineStatus("ing-firestore-status", "", null);
          }
        }, 4500);
      } catch (e) {
        console.error(e);
        pendingFocusIngredientId = null;
        setIngAddDraftError(firestoreErrorMessage(e));
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }

  document.getElementById("nav-ingredients").addEventListener("click", function () {
    setPage("ingredients");
  });
  document.getElementById("nav-modifiers").addEventListener("click", function () {
    setPage("modifiers");
  });

  window.addEventListener("hashchange", syncPageFromHash);

  document.getElementById("modal-close").addEventListener("click", closeModal);
  document.getElementById("modal-cancel").addEventListener("click", closeModal);
  document.getElementById("modal-delete").addEventListener("click", function () {
    if (modalState.productId) onDeleteProduct(modalState.productId);
  });
  document.getElementById("modal-save").addEventListener("click", function () {
    saveModal();
  });
  document.getElementById("product-modal-backdrop").addEventListener("click", function (e) {
    if (e.target.id === "product-modal-backdrop") closeModal();
  });
  document.getElementById("modal-name").addEventListener("input", updateModalStats);
  document.getElementById("modal-price").addEventListener("input", updateModalStats);

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (selectedLedgerIngredientId) closeIngredientDrawer();
    else if (modalState.open) closeModal();
    else if (isIngAddDraftVisible()) hideIngAddDraftPanel();
  });

  syncPageFromHash();

  fillUnitSelectElement(document.getElementById("qa-ing-unit"), "g");
  fillUnitSelectElement(document.getElementById("ing-draft-unit"), "g");

  ["ing-log-qty", "ing-log-price", "ing-log-unit"].forEach(function (nid) {
    var n = document.getElementById(nid);
    if (n) {
      n.addEventListener("input", updateIngDrawerCpuPreview);
      n.addEventListener("change", updateIngDrawerCpuPreview);
    }
  });

  var ingTable = document.getElementById("ing-table");
  if (ingTable) {
    ingTable.addEventListener("click", function (e) {
      var b = e.target.closest(".js-open-ing-drawer");
      if (b) openIngredientDrawer(b.getAttribute("data-id"));
    });
  }

  var ingDrawerCloseBtn = document.getElementById("ing-drawer-close");
  if (ingDrawerCloseBtn) {
    ingDrawerCloseBtn.addEventListener(
      "click",
      function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        closeIngredientDrawer();
      },
      true
    );
  }
  var ingDrawerBackdrop = document.getElementById("ing-drawer-backdrop");
  if (ingDrawerBackdrop) {
    ingDrawerBackdrop.addEventListener("click", function (e) {
      if (e.target === ingDrawerBackdrop) {
        closeIngredientDrawer();
      }
    });
  }

  var nameOnlyBtn = document.getElementById("ing-drawer-save-name-only");
  if (nameOnlyBtn) {
    nameOnlyBtn.addEventListener("click", async function () {
      var id = selectedLedgerIngredientId;
      if (!id) return;
      var ing = ingredients.find(function (x) {
        return String(x.id) === String(id);
      });
      if (!ing) return;
      var nameEl = document.getElementById("ing-log-name");
      var newName = nameEl && nameEl.value.trim();
      if (!newName) {
        setDrawerLogStatus("Isi nama bahan.", "error");
        return;
      }
      var submitBtn = document.getElementById("ing-log-submit");
      nameOnlyBtn.disabled = true;
      if (submitBtn) submitBtn.disabled = true;
      setDrawerLogStatus("Menyimpan nama…", null);
      try {
        await persistIngredient(id, {
          name: newName,
          sortIndex: typeof ing.sortIndex === "number" ? ing.sortIndex : 0
        });
        var titleEl = document.getElementById("ing-drawer-title");
        if (titleEl) titleEl.textContent = newName;
        setDrawerLogStatus("Nama dikemas kini.", "ok");
      } catch (err) {
        console.error(err);
        setDrawerLogStatus(firestoreErrorMessage(err), "error");
      } finally {
        nameOnlyBtn.disabled = false;
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }

  document.getElementById("ing-drawer-log-form").addEventListener("submit", async function (ev) {
    ev.preventDefault();
    var id = selectedLedgerIngredientId;
    if (!id) return;
    var ing = ingredients.find(function (x) {
      return String(x.id) === String(id);
    });
    if (!ing) return;
    var nameEl = document.getElementById("ing-log-name");
    var newName = nameEl && nameEl.value.trim();
    if (!newName) {
      setDrawerLogStatus("Isi nama bahan.", "error");
      return;
    }
    var qty = parseFloat(document.getElementById("ing-log-qty").value) || 0;
    var price = parseFloat(document.getElementById("ing-log-price").value) || 0;
    if (qty <= 0) {
      setDrawerLogStatus("Jumlah dibeli mesti > 0.", "error");
      return;
    }
    var unit = document.getElementById("ing-log-unit").value;
    var notes = document.getElementById("ing-log-notes").value.trim();
    var purchaseAt = Timestamp.now();
    var sortIdx = typeof ing.sortIndex === "number" ? ing.sortIndex : 0;
    var draft = {
      id: ing.id,
      name: newName,
      purchasePrice: price,
      purchaseQty: qty,
      unit: unit,
      sortIndex: sortIdx
    };
    var cpu = costPerUnit(draft);
    var submitBtn = document.getElementById("ing-log-submit");
    if (submitBtn) submitBtn.disabled = true;
    if (nameOnlyBtn) nameOnlyBtn.disabled = true;
    setDrawerLogStatus("Menyimpan…", null);
    try {
      await persistIngredient(id, {
        name: newName,
        purchasePrice: price,
        purchaseQty: qty,
        unit: unit,
        sortIndex: sortIdx
      });
      var ledgerRefPurchase = await addIngredientLedgerEntry({
        ingredientId: id,
        kind: "purchase",
        occurredAt: purchaseAt,
        purchasePrice: price,
        purchaseQty: qty,
        unit: unit,
        costPerUnit: cpu,
        notes: notes,
        nameSnapshot: newName
      });
      await createPurchaseBatch({
        ingredientId: id,
        qtyRemaining: qty,
        qtyOriginal: qty,
        costPerUnit: cpu,
        purchaseTotalRm: price,
        purchaseOccurredAt: purchaseAt,
        purchaseUnit: unit,
        ledgerEntryId: ledgerRefPurchase.id
      });
      var titleEl = document.getElementById("ing-drawer-title");
      if (titleEl) titleEl.textContent = newName;
      setDrawerLogStatus("Disimpan.", "ok");
      patchIngredientBatchDisplays();
    } catch (err) {
      console.error(err);
      setDrawerLogStatus(firestoreErrorMessage(err), "error");
    } finally {
      if (submitBtn) submitBtn.disabled = false;
      if (nameOnlyBtn) nameOnlyBtn.disabled = false;
    }
  });

  document.getElementById("modal-btn-add-ingredient").addEventListener("click", function () {
    var qa = document.getElementById("ing-quick-add");
    if (!qa || !modalState.open) return;
    qa.hidden = !qa.hidden;
    if (!qa.hidden) {
      document.getElementById("qa-ing-name").value = "";
      document.getElementById("qa-ing-price").value = "0";
      document.getElementById("qa-ing-qty").value = "1";
      fillUnitSelectElement(document.getElementById("qa-ing-unit"), "g");
      document.getElementById("qa-ing-name").focus();
    }
  });

  document.getElementById("qa-ing-cancel").addEventListener("click", function () {
    var qa = document.getElementById("ing-quick-add");
    if (qa) qa.hidden = true;
  });

  document.getElementById("qa-ing-save").addEventListener("click", async function () {
    if (!modalState.open) return;
    var p = getModalProduct();
    if (!p) return;
    var name = document.getElementById("qa-ing-name").value.trim();
    if (!name) {
      setLineStatus("mod-firestore-status", "Isi nama bahan.", "error");
      return;
    }
    var unit = document.getElementById("qa-ing-unit").value;
    var price = parseFloat(document.getElementById("qa-ing-price").value) || 0;
    var qty = parseFloat(document.getElementById("qa-ing-qty").value) || 0;
    if (qty <= 0) {
      setLineStatus("mod-firestore-status", "Jumlah dibeli > 0.", "error");
      return;
    }
    var nextSort =
      ingredients.reduce(function (m, x) {
        return Math.max(m, typeof x.sortIndex === "number" ? x.sortIndex : 0);
      }, 0) + 1;
    var btn = document.getElementById("qa-ing-save");
    if (btn) btn.disabled = true;
    setLineStatus("mod-firestore-status", "Menambah bahan…", null);
    try {
      var ref = await addIngredient({
        sortIndex: nextSort,
        name: name,
        purchasePrice: price,
        purchaseQty: qty,
        unit: unit
      });
      var draftIng = {
        id: ref.id,
        name: name,
        purchasePrice: price,
        purchaseQty: qty,
        unit: unit,
        sortIndex: nextSort
      };
      var ledgerRefQa = await addIngredientLedgerEntry({
        ingredientId: ref.id,
        kind: "initial",
        occurredAt: Timestamp.now(),
        purchasePrice: price,
        purchaseQty: qty,
        unit: unit,
        costPerUnit: costPerUnit(draftIng),
        nameSnapshot: name
      });
      await createPurchaseBatch({
        ingredientId: ref.id,
        qtyRemaining: qty,
        qtyOriginal: qty,
        costPerUnit: costPerUnit(draftIng),
        purchaseTotalRm: price,
        purchaseOccurredAt: Timestamp.now(),
        purchaseUnit: unit,
        ledgerEntryId: ledgerRefQa.id
      });
      if (isMassVolumeUnit(unit)) {
        p.usage[ref.id] = { guna: unit === "kg" || unit === "L" ? 0.05 : 50, gunaUnit: unit };
      } else {
        p.usage[ref.id] = 1;
      }
      if (!modalState.draftProduct) {
        await persistModifier(p.id, {
          name: p.name,
          sellingPrice: p.sellingPrice,
          usage: cloneUsageDeep(p.usage)
        });
      }
      document.getElementById("ing-quick-add").hidden = true;
      setLineStatus("mod-firestore-status", "Bahan ditambah dan dipautkan ke menu ini.", "ok");
      renderModalBody();
      updateModalStats();
    } catch (err) {
      console.error(err);
      setLineStatus("mod-firestore-status", firestoreErrorMessage(err), "error");
    } finally {
      if (btn) btn.disabled = false;
    }
  });
}

init().catch(function (e) {
  console.error(e);
});
