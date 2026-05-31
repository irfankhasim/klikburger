/**
 * POS ??? menu jualan disegerakkan dengan Firestore `modifiers` (Produk & kos).
 */
import { redirectIfPosPageWithoutAuth } from "./pos-page-auth.js";
await redirectIfPosPageWithoutAuth();

import { docToProduct, docToIngredient } from "./cost-calculator/mappers.js";
import { enrichProductsWithResolvedUsage } from "./cost-calculator/package-resolved-usage.js";
import { subscribeModifiers } from "./cost-calculator/modifiers-repository.js";
import { subscribeIngredients } from "./cost-calculator/ingredients-repository.js";
import {
  subscribeIngredientBatches,
  groupBatchesByIngredientId,
  sortBatchesFifo,
  getActiveFifoBatchFromList
} from "./cost-calculator/ingredient-batch-repository.js";
import { finalizePosSaleFifo, aggregateCartConsumption } from "./pos-sale-fifo.js";
import { getPosHubState } from "./pos-operations-hub.js";
import { splitOrderAmounts } from "./pos-tax.js";
import { subscribeCustomerTaxPercent } from "./pos-tax-settings.js";
import {
  subscribeRbac,
  canBypassStaffRestrictions,
  canAccessOperationalModules,
  canUseFinancialControls,
  isReadOnlyMode,
  staffLockMessage,
  getActorForAudit
} from "./pos-rbac-session.js";

var menuItems = [];
/** Peratus cukai pelanggan — dari `staff_settings/default.customerTaxPercent`. */
var customerTaxPercent = 0;
/** Snapshot mentah modifier (sebelum agregat usage pakej). */
var posRawProducts = [];
/** Peta id modifier ??? objek docToProduct (untuk FIFO jualan). */
var modifiersById = {};
var posIngredients = [];
/** Lot stok ??? untuk semak ???menu tak boleh jual??? sebelum checkout. */
var batchesByIngredientId = {};
var batchesSnapshotReady = false;
var menuLoadError = null;
/** `"all"` atau id dokumen pakej ??? menapis grid jualan. */
var activeCat = "all";
var cart = [];

var posOrderFirestoreUnsubs = [];
var posOrderPagehideBound = false;

function teardownPosOrderFirestoreListeners() {
  posOrderFirestoreUnsubs.forEach(function (u) {
    try {
      if (typeof u === "function") u();
    } catch (e) {}
  });
  posOrderFirestoreUnsubs = [];
}

function bindPosOrderPagehideOnce() {
  if (posOrderPagehideBound) return;
  posOrderPagehideBound = true;
  window.addEventListener("pagehide", teardownPosOrderFirestoreListeners);
}

/** { id, label, memberIds: string[] | null } ??? null pada "Semua". */
var CATS = [];

/** Sama seperti kalkulator kos (`LOW_STOCK_ACTIVE_LOT_FRACTION`): lot aktif ??? nisbah ini = ???rendah???. */
var LOW_STOCK_LOT_FRACTION = 0.25;

function formatRM(n) {
  return "RM " + (Math.round(n * 100) / 100).toFixed(2);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, "&#39;");
}

function renderCats() {
  var el = document.getElementById("order-cats");
  if (!el) return;
  if (!CATS.length || CATS.length <= 1) {
    el.innerHTML = "";
    el.hidden = true;
    el.setAttribute("hidden", "");
    activeCat = "all";
    return;
  }
  el.hidden = false;
  el.removeAttribute("hidden");
  el.innerHTML = CATS.map(function (c) {
    return (
      '<button type="button" class="order-cat' +
      (c.id === activeCat ? " is-active" : "") +
      '" data-cat="' +
      escapeAttr(c.id) +
      '" role="tab" aria-selected="' +
      (c.id === activeCat ? "true" : "false") +
      '">' +
      escapeHtml(c.label) +
      "</button>"
    );
  }).join("");
  el.querySelectorAll(".order-cat").forEach(function (btn) {
    btn.addEventListener("click", function () {
      activeCat = btn.getAttribute("data-cat") || "all";
      renderCats();
      renderGrid();
    });
  });
}

function ingredientsByIdMap() {
  var m = {};
  posIngredients.forEach(function (ing) {
    m[ing.id] = ing;
  });
  return m;
}

function totalBatchQtyRemaining(ingId) {
  var list = batchesByIngredientId[String(ingId)] || [];
  return list.reduce(function (s, b) {
    var r = b.qtyRemaining;
    var n = typeof r === "number" ? r : parseFloat(r) || 0;
    return s + n;
  }, 0);
}

/** Keperluan bahan (unit asas) jika satu lagi unit menu `menuId` ditambah pada troli semasa. */
function ingredientNeedIfAddOne(menuId) {
  var byIng = ingredientsByIdMap();
  var sid = String(menuId);
  var sim = cart.map(function (l) {
    return { id: l.id, qty: l.qty };
  });
  var found = false;
  for (var i = 0; i < sim.length; i++) {
    if (String(sim[i].id) === sid) {
      sim[i].qty += 1;
      found = true;
      break;
    }
  }
  if (!found) sim.push({ id: sid, qty: 1 });
  return aggregateCartConsumption(byIng, sim, modifiersById);
}

function menuItemCanAddOne(menuId) {
  if (!batchesSnapshotReady) return true;
  var p = modifiersById[menuId];
  if (!p || !p.usage) return true;
  var keys = Object.keys(p.usage);
  if (!keys.length) return true;
  var need = ingredientNeedIfAddOne(menuId);
  for (var ingId in need) {
    if (totalBatchQtyRemaining(ingId) + 1e-9 < need[ingId]) return false;
  }
  return true;
}

/** `lines`: `{ id, qty }[]` ??? sama seperti troli untuk `aggregateCartConsumption`. */
function cartLinesWithinStock(lines) {
  if (!batchesSnapshotReady) return true;
  var byIng = ingredientsByIdMap();
  var need = aggregateCartConsumption(byIng, lines, modifiersById);
  for (var ingId in need) {
    if (totalBatchQtyRemaining(ingId) + 1e-9 < need[ingId]) return false;
  }
  return true;
}

function isIngredientFifoLotLow(ingId) {
  var raw = batchesByIngredientId[String(ingId)] || [];
  var list = sortBatchesFifo(raw);
  var active = getActiveFifoBatchFromList(list);
  if (!active) return false;
  var rem = typeof active.qtyRemaining === "number" ? active.qtyRemaining : parseFloat(active.qtyRemaining) || 0;
  if (rem <= 0) return false;
  var orig = typeof active.qtyOriginal === "number" ? active.qtyOriginal : parseFloat(active.qtyOriginal) || 0;
  if (orig <= 0) return false;
  return rem / orig <= LOW_STOCK_LOT_FRACTION;
}

/** Nama bahan yang digunakan oleh `lines` dan berada di bawah ambang stok rendah (lot FIFO aktif). */
function lowStockIngredientNamesForCart(lines) {
  var byIng = ingredientsByIdMap();
  var need = aggregateCartConsumption(byIng, lines, modifiersById);
  var names = [];
  var seen = {};
  Object.keys(need).forEach(function (ingId) {
    if (!isIngredientFifoLotLow(ingId)) return;
    var ing = byIng[ingId];
    var label = (ing && ing.name) || ingId;
    if (seen[label]) return;
    seen[label] = true;
    names.push(label);
  });
  return names;
}

function updateOrderStockAlert() {
  var el = document.getElementById("order-stock-alert");
  if (!el) return;
  if (!batchesSnapshotReady || !cart.length) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  var lines = cart.map(function (l) {
    return { id: l.id, qty: l.qty };
  });
  var names = lowStockIngredientNamesForCart(lines);
  if (!names.length) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.hidden = false;
  el.textContent =
    "Amaran stok rendah bagi bahan dalam pesanan ini: " +
    names.join(", ") +
    ". (Lot semasa ? " +
    Math.round(LOW_STOCK_LOT_FRACTION * 100) +
    "% daripada asal ? tambah belian jika perlu.)";
}

function renderGrid() {
  var grid = document.getElementById("order-grid");
  if (!grid) return;
  if (menuLoadError) {
    grid.innerHTML =
      '<p class="order-cart__empty" style="text-align:left">' +
      escapeHtml(menuLoadError) +
      "</p>";
    return;
  }
  if (!menuItems.length) {
    grid.innerHTML =
      '<p class="order-cart__empty" style="text-align:left">Tiada produk. Tambah di <strong>Produk &amp; kos</strong> atau semak sambungan.</p>';
    return;
  }
  var items = menuItems;
  if (activeCat !== "all") {
    var tab = CATS.find(function (c) {
      return c.id === activeCat;
    });
    var mids = tab && tab.memberIds;
    if (mids && mids.length) {
      var allow = {};
      mids.forEach(function (id) {
        allow[String(id)] = true;
      });
      items = menuItems.filter(function (m) {
        return allow[String(m.id)];
      });
    } else {
      items = [];
    }
  }
  if (!items.length && menuItems.length) {
    grid.innerHTML =
      '<p class="order-cart__empty" style="text-align:left">' +
      "Pakej kosong ? ubah di Menu Produk atau pilih <strong>Semua menu</strong>." +
      "</p>";
    return;
  }
  grid.innerHTML = items
    .map(function (m) {
      var can = menuItemCanAddOne(m.id) && posCatalogAllowed();
      var dis = can ? "" : " disabled";
      var title = can ? "" : ' title="Bahan tidak mencukupi untuk satu lagi unit (semak inventori / lot FIFO)."';
      if (!posCatalogAllowed()) title = ' title="' + escapeAttr(staffLockMessage()) + '"';
      return (
        '<button type="button" class="order-card' +
        (can ? "" : " is-unavailable") +
        '"' +
        dis +
        title +
        ' data-id="' +
        escapeAttr(String(m.id)) +
        '">' +
        '<span class="order-card__name">' +
        escapeHtml(m.name) +
        "</span>" +
        '<span class="order-card__meta"><span class="order-card__price">' +
        formatRM(m.price) +
        "</span></span></button>"
      );
    })
    .join("");
  grid.querySelectorAll(".order-card").forEach(function (btn) {
    btn.addEventListener("click", function () {
      if (btn.disabled) return;
      addToCart(String(btn.getAttribute("data-id")));
    });
  });
}

function findMenuItem(id) {
  return menuItems.find(function (m) {
    return String(m.id) === String(id);
  });
}

function addToCart(id) {
  if (!posCatalogAllowed()) {
    showToast(staffLockMessage());
    return;
  }
  var m = findMenuItem(id);
  if (!m) return;
  var sid = String(m.id);
  var sim = cart.map(function (l) {
    return { id: l.id, qty: l.qty };
  });
  var found = false;
  for (var i = 0; i < sim.length; i++) {
    if (String(sim[i].id) === sid) {
      sim[i].qty += 1;
      found = true;
      break;
    }
  }
  if (!found) sim.push({ id: sid, qty: 1 });
  if (!cartLinesWithinStock(sim)) {
    showToast("Bahan tidak mencukupi untuk tambah item ini.");
    return;
  }
  var line = cart.find(function (x) {
    return String(x.id) === sid;
  });
  if (line) line.qty += 1;
  else cart.push({ id: sid, name: m.name, price: m.price, qty: 1 });
  renderCart();
}

function setQty(id, qty) {
  var sid = String(id);
  var line = cart.find(function (x) {
    return String(x.id) === sid;
  });
  if (!line) return;
  if (!posCatalogAllowed() && qty > line.qty) {
    showToast(staffLockMessage());
    return;
  }
  line.qty = Math.max(0, qty);
  cart = cart.filter(function (x) {
    return x.qty > 0;
  });
  renderCart();
}

function cartTotal() {
  return cart.reduce(function (s, x) {
    return s + x.price * x.qty;
  }, 0);
}

function orderAmountsFromSub(sub) {
  return splitOrderAmounts(sub, customerTaxPercent);
}

function formatOrderTotalsHtml(amt) {
  if (amt.taxPercent > 0 && amt.taxAmount > 0) {
    return (
      '<div class="order-total-row"><span>Subjumlah</span><strong>' +
      formatRM(amt.subtotal) +
      "</strong></div>" +
      '<div class="order-total-row"><span>Cukai (' +
      escapeHtml(String(amt.taxPercent)) +
      '%)</span><strong>' +
      formatRM(amt.taxAmount) +
      "</strong></div>" +
      '<div class="order-total-row"><span>Jumlah</span><strong>' +
      formatRM(amt.total) +
      "</strong></div>"
    );
  }
  return (
    '<div class="order-total-row"><span>Jumlah</span><strong>' + formatRM(amt.total) + "</strong></div>"
  );
}

function renderCartTotals(sub) {
  var summary = document.getElementById("order-total-summary");
  if (!summary) return;
  summary.innerHTML = formatOrderTotalsHtml(orderAmountsFromSub(sub));
}

function renderCart() {
  var list = document.getElementById("order-cart-list");
  if (!list) return;
  if (!cart.length) {
    list.innerHTML = '<p class="order-cart__empty">Klik menu untuk tambah.</p>';
    renderCartTotals(0);
    updateOrderStockAlert();
    renderGrid();
    updatePosRbacChrome();
    return;
  }
  list.innerHTML = cart
    .map(function (line) {
      var sub = line.price * line.qty;
      return (
        '<div class="order-line" data-id="' +
        escapeAttr(String(line.id)) +
        '">' +
        '<div class="order-line__title">' +
        escapeHtml(line.name) +
        "</div>" +
        '<div class="order-line__price">' +
        formatRM(sub) +
        "</div>" +
        '<div class="order-line__ctrl">' +
        '<span class="order-line__qty">' +
        '<button type="button" class="js-qty-minus" aria-label="Kurang">\u2212</button>' +
        "<span>" +
        line.qty +
        "</span>" +
        '<button type="button" class="js-qty-plus" aria-label="Tambah">+</button>' +
        "</span>" +
        '<button type="button" class="order-line__remove js-remove">Buang</button>' +
        "</div></div>"
      );
    })
    .join("");
  list.querySelectorAll(".order-line").forEach(function (row) {
    var id = row.getAttribute("data-id");
    row.querySelector(".js-qty-minus").addEventListener("click", function () {
      var line = cart.find(function (x) {
        return String(x.id) === String(id);
      });
      if (line) setQty(id, line.qty - 1);
    });
    row.querySelector(".js-qty-plus").addEventListener("click", function () {
      var line = cart.find(function (x) {
        return String(x.id) === String(id);
      });
      if (!line) return;
      var nextQty = line.qty + 1;
      var sim = cart.map(function (l) {
        return { id: l.id, qty: String(l.id) === String(id) ? nextQty : l.qty };
      });
      if (!cartLinesWithinStock(sim)) {
        showToast("Bahan tidak mencukupi untuk tambah kuantiti.");
        return;
      }
      setQty(id, nextQty);
    });
    row.querySelector(".js-remove").addEventListener("click", function () {
      if (!posCatalogAllowed()) {
        showToast(staffLockMessage());
        return;
      }
      cart = cart.filter(function (x) {
        return String(x.id) !== String(id);
      });
      renderCart();
    });
  });
  renderCartTotals(cartTotal());
  updateOrderStockAlert();
  renderGrid();
  updatePosRbacChrome();
}

function posSalesAllowed() {
  if (canBypassStaffRestrictions()) return true;
  return canUseFinancialControls() && !isReadOnlyMode();
}

function posCatalogAllowed() {
  if (canBypassStaffRestrictions()) return true;
  return canAccessOperationalModules() && !isReadOnlyMode();
}

function updatePosRbacChrome() {
  var ban = document.getElementById("order-rbac-banner");
  if (ban) {
    if (canBypassStaffRestrictions()) {
      ban.hidden = true;
      ban.setAttribute("hidden", "");
      ban.textContent = "";
    } else if (!canAccessOperationalModules()) {
      ban.hidden = false;
      ban.removeAttribute("hidden");
      ban.textContent = staffLockMessage();
    } else if (isReadOnlyMode()) {
      ban.hidden = false;
      ban.removeAttribute("hidden");
      ban.textContent =
        "Drawer ditutup ? mod baca sahaja. Bayaran baharu tidak dibenarkan sehingga drawer baharu dibuka atau anda clock out.";
    } else if (!canUseFinancialControls()) {
      ban.hidden = false;
      ban.removeAttribute("hidden");
      ban.textContent =
        "Drawer belum dibuka ? sila buka drawer untuk membolehkan checkout dan bayaran.";
    } else {
      ban.hidden = true;
      ban.setAttribute("hidden", "");
      ban.textContent = "";
    }
  }
  var sub = document.getElementById("order-submit");
  if (sub) sub.disabled = !posSalesAllowed();
}

function showToast(msg) {
  var t = document.getElementById("order-toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("is-visible");
  clearTimeout(showToast._tm);
  showToast._tm = setTimeout(function () {
    t.classList.remove("is-visible");
  }, 2600);
}

function firestoreErrorMessage(err) {
  if (!err) return "Ralat tidak diketahui.";
  if (err.code === "permission-denied") {
    return "Akses baca menu ditolak. Semak peraturan pangkalan data atau buka halaman Produk & kos sekali untuk ujian.";
  }
  return err.message || String(err);
}

function rebuildPosMenuFromStreams() {
  try {
    menuLoadError = null;
    var singlesRaw = posRawProducts.filter(function (p) {
      return p.menuKind !== "package";
    });
    var enriched = enrichProductsWithResolvedUsage(singlesRaw, posIngredients);
    modifiersById = {};
    enriched.forEach(function (p) {
      modifiersById[p.id] = p;
    });

    var pkgRows = posRawProducts
      .filter(function (p) {
        return p.menuKind === "package";
      })
      .map(function (p) {
        var mids = p.packageMemberIds && p.packageMemberIds.length ? p.packageMemberIds : [];
        return {
          id: p.id,
          name: p.name || "Pakej",
          sortIndex: typeof p.sortIndex === "number" ? p.sortIndex : parseFloat(p.sortIndex) || 0,
          memberIds: mids
        };
      })
      .sort(function (a, b) {
        return a.sortIndex - b.sortIndex;
      });

    CATS = [{ id: "all", label: "Semua menu", memberIds: null }];
    pkgRows.forEach(function (row) {
      CATS.push({
        id: row.id,
        label: row.name,
        memberIds: row.memberIds
      });
    });

    if (!CATS.some(function (c) {
      return c.id === activeCat;
    })) {
      activeCat = "all";
    }

    var catOrder = { burger: 0, fries: 1, oblong: 2, benjo: 3, addon: 4, other: 5 };
    menuItems = enriched
      .map(function (p) {
        return {
          id: p.id,
          name: p.name || "Produk",
          price: typeof p.sellingPrice === "number" ? p.sellingPrice : parseFloat(p.sellingPrice) || 0,
          menuCategory: p.menuCategory || "other",
          sortIndex: typeof p.sortIndex === "number" ? p.sortIndex : parseFloat(p.sortIndex) || 0
        };
      })
      .sort(function (a, b) {
        var ca = catOrder[a.menuCategory] != null ? catOrder[a.menuCategory] : 99;
        var cb = catOrder[b.menuCategory] != null ? catOrder[b.menuCategory] : 99;
        if (ca !== cb) return ca - cb;
        if (a.sortIndex !== b.sortIndex) return a.sortIndex - b.sortIndex;
        return String(a.name).localeCompare(String(b.name));
      });
    renderCats();
  } catch (err) {
    console.error("rebuildPosMenuFromStreams:", err);
    menuLoadError = "Menu tidak dapat dibina. Semak data produk atau konsol.";
    menuItems = [];
    CATS = [{ id: "all", label: "Semua menu", memberIds: null }];
    activeCat = "all";
    renderCats();
  }
  renderGrid();
}

function onModifiersSnapshot(snap) {
  menuLoadError = null;
  var sorted = snap.docs.slice().sort(function (a, b) {
    var da = a.data();
    var db = b.data();
    var sa = typeof da.sortIndex === "number" ? da.sortIndex : parseFloat(da.sortIndex) || 0;
    var sb = typeof db.sortIndex === "number" ? db.sortIndex : parseFloat(db.sortIndex) || 0;
    return sa - sb;
  });
  posRawProducts = [];
  for (var i = 0; i < sorted.length; i++) {
    try {
      posRawProducts.push(docToProduct(sorted[i]));
    } catch (err) {
      console.warn("Modifier diabaikan:", sorted[i].id, err);
    }
  }
  rebuildPosMenuFromStreams();
}

function onModifiersError(err) {
  console.error(err);
  menuLoadError = firestoreErrorMessage(err);
  menuItems = [];
  posRawProducts = [];
  modifiersById = {};
  CATS = [];
  activeCat = "all";
  renderCats();
  renderGrid();
}

function onIngredientsSnapshot(snap) {
  posIngredients = snap.docs.map(docToIngredient);
  if (posRawProducts.length) rebuildPosMenuFromStreams();
}

function onIngredientsError(err) {
  console.error(err);
}

function onBatchesSnapshot(snap) {
  batchesByIngredientId = groupBatchesByIngredientId(snap);
  batchesSnapshotReady = true;
  renderGrid();
  updateOrderStockAlert();
}

function onBatchesError(err) {
  console.error(err);
  batchesSnapshotReady = true;
  renderGrid();
  updateOrderStockAlert();
}

/* ?????? Aliran: semakan ??? pembayaran ??? kejayaan (disambung ke hab resit / senarai pesanan) ?????? */
var checkoutLines = [];
var flowStep = "review";
var selectedPayment = "cash";
var tenderedInputVal = "";
var lastSaleMeta = null;
/** Nama pelanggan (wajib) — kekal semasa ulang-alik semakan ↔ pembayaran */
var flowCustomerName = "";

function flowEls() {
  return {
    overlay: document.getElementById("order-flow-overlay"),
    bd: document.getElementById("order-flow-bd"),
    title: document.getElementById("order-flow-title"),
    body: document.getElementById("order-flow-body"),
    foot: document.getElementById("order-flow-foot"),
    x: document.getElementById("order-flow-x")
  };
}

function openFlowOverlay() {
  var z = flowEls();
  if (!z.overlay) return;
  z.overlay.hidden = false;
  z.overlay.setAttribute("aria-hidden", "false");
}

function closeFlowOverlay() {
  var z = flowEls();
  if (!z.overlay) return;
  z.overlay.hidden = true;
  z.overlay.setAttribute("aria-hidden", "true");
  checkoutLines = [];
  flowStep = "review";
  flowCustomerName = "";
}

function cartSubtotalFromLines(lines) {
  return lines.reduce(function (s, l) {
    return s + l.price * l.qty;
  }, 0);
}

function renderFlowReview() {
  var z = flowEls();
  flowStep = "review";
  z.title.textContent = "Semakan pesanan";
  var amt = orderAmountsFromSub(cartSubtotalFromLines(checkoutLines));
  z.body.innerHTML =
    '<p class="ops-muted" style="margin:0 0 0.65rem">Semak item sebelum pembayaran. Status: <strong>Belum bayar</strong>.</p>' +
    '<div style="margin:0 0 0.75rem">' +
    '<label for="flow-customer-name" style="display:block;font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:var(--text-muted);margin-bottom:0.3rem">Nama pelanggan <span style="color:var(--danger)">*</span></label>' +
    '<input type="text" id="flow-customer-name" maxlength="120" autocomplete="name" placeholder="Contoh: Puan Aminah" style="width:100%;box-sizing:border-box;padding:0.5rem 0.55rem;border:1px solid var(--border);border-radius:var(--radius-md);font:inherit" value="' +
    escapeAttr(flowCustomerName) +
    '" /></div>' +
    "<ul class=\"order-flow__list\">" +
    checkoutLines
      .map(function (l) {
        return (
          "<li><span>" +
          escapeHtml(l.name) +
          " \u00d7 " +
          l.qty +
          "</span><strong>" +
          formatRM(l.price * l.qty) +
          "</strong></li>"
        );
      })
      .join("") +
    "</ul>" +
    '<div style="margin:0.75rem 0 0;text-align:right">' +
    formatOrderTotalsHtml(amt) +
    "</div>";
  z.foot.innerHTML =
    '<button type="button" class="btn btn--ghost" id="flow-back-dismiss">Kembali</button>' +
    '<button type="button" class="btn btn--primary" id="flow-to-pay">Teruskan ke pembayaran</button>';
  document.getElementById("flow-back-dismiss").onclick = closeFlowOverlay;
  document.getElementById("flow-to-pay").onclick = function () {
    var inp = document.getElementById("flow-customer-name");
    var raw = inp && inp.value != null ? String(inp.value) : "";
    var trimmed = raw.trim();
    if (!trimmed) {
      showToast("Sila masukkan nama pelanggan.");
      if (inp) inp.focus();
      return;
    }
    flowCustomerName = trimmed;
    renderFlowPayment();
  };
}

function syncPayOptionStyles() {
  document.querySelectorAll(".order-flow__pay-opt").forEach(function (lab) {
    var inp = lab.querySelector("input");
    lab.classList.toggle("is-active", inp && inp.checked);
  });
}

function renderFlowPayment() {
  var z = flowEls();
  flowStep = "pay";
  z.title.textContent = "Pembayaran";
  var amt = orderAmountsFromSub(cartSubtotalFromLines(checkoutLines));
  var totalDue = amt.total;
  z.body.innerHTML =
    '<div style="margin:0 0 0.65rem">' +
    formatOrderTotalsHtml(amt) +
    "</div>" +
    '<p class="ops-muted" style="margin:0 0 0.65rem;font-size:0.82rem">Pelanggan: <strong>' +
    escapeHtml(flowCustomerName) +
    "</strong></p>" +
    '<div class="order-flow__pay-grid" id="flow-pay-opts">' +
    '<label class="order-flow__pay-opt is-active"><input type="radio" name="flow-pay" value="cash" checked /> Tunai</label>' +
    '<label class="order-flow__pay-opt"><input type="radio" name="flow-pay" value="duitnow" /> QR</label>' +
    "</div>" +
    '<div id="flow-cash-panel" style="margin-top:0.5rem;padding:0.65rem;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--surface-muted)">' +
    "<strong style=\"font-size:0.82rem\">Tunai</strong>" +
    '<div style="margin-top:0.45rem;display:grid;gap:0.35rem">' +
    '<label style="font-size:0.78rem;font-weight:600">Diberi pelanggan (RM)</label>' +
    '<input type="number" id="flow-tendered" min="0" step="0.01" style="padding:0.45rem;border:1px solid var(--border);border-radius:6px;font:inherit" />' +
    '<p id="flow-balance" style="margin:0;font-size:0.85rem;font-weight:700"></p>' +
    "</div></div>";
  selectedPayment = "cash";

  function updatePaymentPanels() {
    var cash = selectedPayment === "cash";
    var pc = document.getElementById("flow-cash-panel");
    if (pc) pc.style.display = cash ? "block" : "none";
  }

  function updateBalance() {
    var el = document.getElementById("flow-balance");
    if (!el) return;
    var t = parseFloat(document.getElementById("flow-tendered") && document.getElementById("flow-tendered").value) || 0;
    var bal = Math.round((t - totalDue) * 100) / 100;
    if (!selectedPayment || selectedPayment !== "cash") {
      el.textContent = "";
      return;
    }
    if (t <= 0) {
      el.textContent = "Baki: ?";
      return;
    }
    el.textContent = "Baki untuk pelanggan: " + formatRM(bal);
    el.style.color = bal < 0 ? "var(--danger)" : "var(--success)";
  }

  z.foot.innerHTML =
    '<button type="button" class="btn btn--ghost" id="flow-back-review">Kembali</button>' +
    '<button type="button" class="btn btn--primary" id="flow-confirm-pay">Sahkan pembayaran</button>';
  document.getElementById("flow-back-review").onclick = renderFlowReview;

  document.querySelectorAll('input[name="flow-pay"]').forEach(function (r) {
    r.addEventListener("change", function () {
      selectedPayment = r.value;
      syncPayOptionStyles();
      updatePaymentPanels();
      updateBalance();
    });
  });
  syncPayOptionStyles();
  var tenderInp = document.getElementById("flow-tendered");
  tenderInp.value = tenderedInputVal || String(Math.ceil(totalDue));
  tenderInp.addEventListener("input", function () {
    tenderedInputVal = tenderInp.value;
    updateBalance();
  });
  updatePaymentPanels();
  updateBalance();

  document.getElementById("flow-confirm-pay").onclick = function () {
    onConfirmPayment(amt);
  };
}

function renderFlowSuccess(meta) {
  var z = flowEls();
  flowStep = "success";
  z.title.textContent = "Pembayaran berjaya";
  z.body.innerHTML =
    '<p style="margin:0 0 0.5rem;font-weight:700;color:var(--success)">Terima kasih ? pesanan <strong>' +
    escapeHtml(meta.orderNo || "") +
    "</strong> telah direkodkan.</p>" +
    "<ul class=\"order-flow__success-list\">" +
    "<li>Pelanggan: <strong>" + escapeHtml(meta.customerName || "") + "</strong></li>" +
    "<li>Bayaran diterima (" +
    escapeHtml(meta.payLabel) +
    ")</li>" +
    "<li>Resit " +
    escapeHtml(meta.receiptNo) +
    " dicipta</li>" +
    "<li>Tiket dapur " +
    escapeHtml(meta.ktId) +
    " dihantar</li>" +
    "<li>Stok dikemas kini (ikut resipi)</li>" +
    "<li>Pesanan " +
    escapeHtml(meta.orderNo) +
    " dalam <strong>Senarai pesanan</strong> (Menunggu)</li>" +
    "</ul>" +
    '<div class="ops-muted" style="margin:0.65rem 0 0;font-size:0.82rem;text-align:right">' +
    formatOrderTotalsHtml({
      subtotal: meta.subtotal,
      taxPercent: meta.taxPercent || 0,
      taxAmount: meta.taxAmount || 0,
      total: meta.total != null ? meta.total : meta.subtotal
    }) +
    "</div>" +
    (meta.totalCogsFifo != null
      ? '<p class="ops-muted" style="margin:0.35rem 0 0;font-size:0.82rem">COGS: ' +
        formatRM(meta.totalCogsFifo) +
        " · Untung kasar: " +
        formatRM(meta.grossProfit) +
        (meta.changeDue != null ? " · Baki tunai: " + formatRM(meta.changeDue) : "") +
        "</p>"
      : meta.changeDue != null
        ? '<p class="ops-muted" style="margin:0.35rem 0 0;font-size:0.82rem">Baki tunai: ' +
          formatRM(meta.changeDue) +
          "</p>"
        : "");
  z.foot.innerHTML =
    '<button type="button" class="btn btn--primary" id="flow-done">Pesanan baharu</button>';
  document.getElementById("flow-done").onclick = function () {
    closeFlowOverlay();
  };
}

async function onConfirmPayment(amt) {
  if (!posSalesAllowed()) {
    showToast("Bayaran tidak dibenarkan ? sila buka drawer atau semak status clock in / drawer.");
    return;
  }
  var totalDue = amt.total;
  var custTrim = String(flowCustomerName || "").trim();
  if (!custTrim) {
    showToast("Sila masukkan nama pelanggan — kembali ke semakan pesanan.");
    return;
  }
  selectedPayment =
    (document.querySelector('input[name="flow-pay"]:checked') && document.querySelector('input[name="flow-pay"]:checked').value) ||
    "cash";
  if (selectedPayment !== "cash" && selectedPayment !== "duitnow") {
    selectedPayment = "cash";
  }
  var tendered = parseFloat(document.getElementById("flow-tendered") && document.getElementById("flow-tendered").value) || 0;
  if (selectedPayment === "cash") {
    if (tendered + 1e-9 < totalDue) {
      showToast("Amaun diberi tidak mencukupi.");
      return;
    }
  }
  var cartLines = checkoutLines.map(function (l) {
    return { id: l.id, name: l.name, price: l.price, qty: l.qty };
  });
  if (!cartLinesWithinStock(checkoutLines.map(function (x) { return { id: x.id, qty: x.qty }; }))) {
    showToast("Stok tidak mencukupi ? tutup aliran dan semak troli.");
    return;
  }
  var btn = document.getElementById("flow-confirm-pay");
  if (btn) btn.disabled = true;
  try {
    var act = getActorForAudit();
    var changeDue = selectedPayment === "cash" ? Math.round((tendered - totalDue) * 100) / 100 : null;
    var hub = getPosHubState();
    var drawerOpen = !!(hub && hub.shift && hub.shift.isOpen);
    var result = await finalizePosSaleFifo({
      cart: checkoutLines.map(function (l) {
        return { id: l.id, name: l.name, price: l.price, qty: l.qty };
      }),
      modifiersById: modifiersById,
      ingredientsList: posIngredients,
      table: "",
      customerName: custTrim,
      notes: "",
      staffId: act.userId || "",
      staffName: act.userName || "",
      paymentMethod: selectedPayment,
      tendered: selectedPayment === "cash" ? tendered : null,
      changeDue: changeDue,
      drawerOpenedSimulated: drawerOpen,
      taxPercent: amt.taxPercent,
      taxAmount: amt.taxAmount,
      total: amt.total
    });
    var labels = { cash: "Tunai", duitnow: "QR" };
    if (!result.order || !result.receipt) {
      throw new Error("Transaksi jualan tidak lengkap (pesanan/resit).");
    }
    console.info("[Dapur]", result.order.kitchenTicketId, checkoutLines);
    lastSaleMeta = {
      receiptNo: result.receipt.receiptNo,
      orderNo: result.order.orderNo,
      ktId: result.order.kitchenTicketId,
      subtotal: result.subtotal,
      taxPercent: result.taxPercent || 0,
      taxAmount: result.taxAmount || 0,
      total: result.total != null ? result.total : result.subtotal,
      totalCogsFifo: result.totalCogsFifo,
      grossProfit: Math.round((result.subtotal - result.totalCogsFifo) * 100) / 100,
      changeDue: changeDue,
      payLabel: labels[selectedPayment] || selectedPayment,
      customerName: custTrim
    };
    cart = [];
    renderCart();
    renderFlowSuccess(lastSaleMeta);
  } catch (e) {
    console.error(e);
    showToast(e && e.message ? e.message : String(e));
  } finally {
    if (btn) btn.disabled = false;
  }
}

function startCheckoutFlowFromCart() {
  if (!posCatalogAllowed()) {
    showToast(staffLockMessage());
    return;
  }
  if (!posSalesAllowed()) {
    showToast("Buka drawer dahulu untuk menerima bayaran.");
    return;
  }
  if (!cart.length) {
    showToast("Troli kosong ? tambah item dahulu.");
    return;
  }
  if (!posIngredients.length) {
    showToast("Data bahan belum dimuatkan ? tunggu sebentar atau muat semula halaman.");
    return;
  }
  var cartLines = cart.map(function (l) {
    return { id: l.id, qty: l.qty };
  });
  if (!cartLinesWithinStock(cartLines)) {
    showToast("Stok bahan tidak mencukupi untuk jualan ini ? kurangkan kuantiti dalam troli.");
    return;
  }
  checkoutLines = cart.map(function (l) {
    return { id: l.id, name: l.name, price: l.price, qty: l.qty };
  });
  flowCustomerName = "";
  tenderedInputVal = "";
  selectedPayment = "cash";
  openFlowOverlay();
  renderFlowReview();
}

function wireOrderFlowChrome() {
  var z = flowEls();
  if (!z.x) return;
  z.x.onclick = closeFlowOverlay;
  z.bd.onclick = function () {
    if (flowStep === "success") closeFlowOverlay();
  };
}

async function init() {
  var grid = document.getElementById("order-grid");
  if (grid) {
    grid.innerHTML =
      '<p class="order-cart__empty" style="text-align:left">Memuatkan senarai menu\u2026</p>';
  }
  bindPosOrderPagehideOnce();
  posOrderFirestoreUnsubs.push(subscribeModifiers(onModifiersSnapshot, onModifiersError));
  posOrderFirestoreUnsubs.push(subscribeIngredients(onIngredientsSnapshot, onIngredientsError));
  posOrderFirestoreUnsubs.push(subscribeIngredientBatches(onBatchesSnapshot, onBatchesError));

  var btnClear = document.getElementById("order-clear");
  if (btnClear) {
    btnClear.addEventListener("click", function () {
      if (!cart.length) return;
      cart = [];
      renderCart();
    });
  }

  var submitBtn = document.getElementById("order-submit");
  if (!submitBtn) {
    console.error("order-submit tidak dijumpai.");
    renderCats();
    renderCart();
    renderGrid();
    return;
  }
  submitBtn.addEventListener("click", function () {
    startCheckoutFlowFromCart();
  });

  wireOrderFlowChrome();

  posOrderFirestoreUnsubs.push(
    subscribeRbac(function () {
      updatePosRbacChrome();
      renderGrid();
      renderCart();
    })
  );

  posOrderFirestoreUnsubs.push(
    subscribeCustomerTaxPercent(function (pct) {
      customerTaxPercent = pct;
      renderCart();
      if (flowStep === "review" && checkoutLines.length) renderFlowReview();
      else if (flowStep === "pay" && checkoutLines.length) renderFlowPayment();
    })
  );

  renderCats();
  renderCart();
  renderGrid();
  updatePosRbacChrome();
}

init().catch(function (e) {
  console.error(e);
  menuLoadError = e && e.message ? e.message : String(e);
  renderGrid();
});
