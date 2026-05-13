/**
 * Halaman ringkas: senarai menu_items + kos resipi (Firestore).
 */
import { db } from "../firebase/init.js";
import { docToIngredient } from "../cost-calculator/mappers.js";
import { docToRecipe, docToMenuItem } from "./mappers.js";
import { subscribeIngredients } from "../cost-calculator/ingredients-repository.js";
import { subscribeRecipes } from "./recipes-repository.js";
import { subscribeMenuItems, persistMenuItem } from "./menu-items-repository.js";
import { menuItemCostModel } from "./costing-engine.js";
import { formatRM } from "../cost-calculator/core.js";
import { seedMenuCostingIfEmpty } from "./seed-menu-demo.js";
import { serverTimestamp } from "../firebase/init.js";

var ingredients = [];
var recipes = [];
var menuItems = [];
var pending = { ingredients: false, recipes: false, menuItems: false };
var sellPriceHandlersBound = false;

var menuCostingUnsubs = [];
var menuCostingPagehideBound = false;

function teardownMenuCostingListeners() {
  menuCostingUnsubs.forEach(function (u) {
    try {
      if (typeof u === "function") u();
    } catch (e) {}
  });
  menuCostingUnsubs = [];
}

function bindMenuCostingPagehideOnce() {
  if (menuCostingPagehideBound) return;
  menuCostingPagehideBound = true;
  window.addEventListener("pagehide", teardownMenuCostingListeners);
}

function recipeById(id) {
  return recipes.find(function (r) {
    return r.id === id;
  });
}

function render() {
  var el = document.getElementById("menu-costing-tbody");
  if (!el) return;
  if (!pending.ingredients || !pending.recipes || !pending.menuItems) {
    el.innerHTML =
      '<tr><td colspan="6">Memuatkan… pastikan Firestore Rules membenarkan bacaan koleksi ini.</td></tr>';
    return;
  }

  var sorted = menuItems.slice().sort(function (a, b) {
    return (a.sortIndex || 0) - (b.sortIndex || 0);
  });

  if (!sorted.length) {
    el.innerHTML =
      '<tr><td colspan="6">Tiada <code>menu_items</code> lagi. Klik <strong>Seed demo</strong> (jika koleksi kosong) atau tambah dokumen dalam Firestore.</td></tr>';
    return;
  }

  el.innerHTML = sorted
    .map(function (mi) {
      var rec = recipeById(mi.recipeId);
      var m = menuItemCostModel(ingredients, mi, rec);
      var recName = rec ? escapeHtml(rec.name || "(tiada resipi)") : '<span style="color:#c0392b">recipeId tidak jumpa</span>';
      var sellVal = Number(m.sellingPrice);
      if (isNaN(sellVal)) sellVal = 0;
      return (
        '<tr data-menu-row="' +
        escapeHtml(mi.id) +
        '"><td>' +
        escapeHtml(mi.name) +
        "</td><td>" +
        recName +
        "</td><td class=\"num\">" +
        formatRM(m.cost) +
        '</td><td class="num">' +
        '<input type="number" class="sell-price-input" step="0.01" min="0" data-menu-id="' +
        escapeHtml(mi.id) +
        '" value="' +
        sellVal.toFixed(2) +
        '" aria-label="Harga jual untuk ' +
        escapeHtml(mi.name) +
        '" />' +
        '</td><td class="num js-cell-profit">' +
        formatRM(m.profit) +
        '</td><td class="num js-cell-margin">' +
        m.marginPct +
        "%</td></tr>"
      );
    })
    .join("");
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function bindSellPriceHandlersOnce() {
  var tbody = document.getElementById("menu-costing-tbody");
  if (!tbody || sellPriceHandlersBound) return;
  sellPriceHandlersBound = true;

  tbody.addEventListener("input", function (e) {
    var inp = e.target && e.target.closest ? e.target.closest(".sell-price-input") : null;
    if (!inp || !tbody.contains(inp)) return;
    var id = inp.getAttribute("data-menu-id");
    var v = parseFloat(inp.value);
    var mi = menuItems.find(function (x) {
      return x.id === id;
    });
    if (!mi || isNaN(v)) return;
    var rec = recipeById(mi.recipeId);
    var model = menuItemCostModel(ingredients, Object.assign({}, mi, { sellingPrice: v }), rec);
    var tr = inp.closest("tr");
    if (!tr) return;
    var p = tr.querySelector(".js-cell-profit");
    var mg = tr.querySelector(".js-cell-margin");
    if (p) p.textContent = formatRM(model.profit);
    if (mg) mg.textContent = model.marginPct + "%";
  });

  tbody.addEventListener("change", function (e) {
    var inp = e.target && e.target.closest ? e.target.closest(".sell-price-input") : null;
    if (!inp || !tbody.contains(inp)) return;
    persistSellingPrice(inp);
  });

  tbody.addEventListener("keydown", function (e) {
    if (e.key !== "Enter") return;
    var inp = e.target && e.target.closest ? e.target.closest(".sell-price-input") : null;
    if (!inp || !tbody.contains(inp)) return;
    e.preventDefault();
    inp.blur();
  });
}

async function persistSellingPrice(inp) {
  var id = inp.getAttribute("data-menu-id");
  var v = parseFloat(inp.value);
  if (!id) return;
  var prev = menuItems.find(function (x) {
    return x.id === id;
  });
  if (isNaN(v) || v < 0) {
    if (prev) inp.value = Number(prev.sellingPrice || 0).toFixed(2);
    return;
  }
  v = Math.round(v * 100) / 100;
  inp.value = v.toFixed(2);
  try {
    inp.disabled = true;
    await persistMenuItem(id, { sellingPrice: v, updatedAt: serverTimestamp() });
  } catch (err) {
    console.error(err);
    window.alert(err && err.message ? err.message : String(err));
    if (prev) inp.value = Number(prev.sellingPrice || 0).toFixed(2);
  } finally {
    inp.disabled = false;
  }
}

function markReady() {
  render();
}

bindMenuCostingPagehideOnce();

menuCostingUnsubs.push(
  subscribeIngredients(
  function (snap) {
    ingredients = snap.docs.map(docToIngredient);
    pending.ingredients = true;
    markReady();
  },
  function (e) {
    console.error(e);
    var el = document.getElementById("menu-costing-tbody");
    if (el) el.innerHTML = '<tr><td colspan="6" style="color:#c0392b">Ralat ingredients: ' + escapeHtml(e.message || String(e)) + "</td></tr>";
  }
)
);

menuCostingUnsubs.push(
  subscribeRecipes(
  function (snap) {
    recipes = snap.docs.map(docToRecipe);
    pending.recipes = true;
    markReady();
  },
  function (e) {
    console.error(e);
  }
)
);

menuCostingUnsubs.push(
  subscribeMenuItems(
  function (snap) {
    menuItems = snap.docs.map(docToMenuItem);
    pending.menuItems = true;
    markReady();
  },
  function (e) {
    console.error(e);
  }
)
);

bindSellPriceHandlersOnce();

document.getElementById("btn-seed-demo").addEventListener("click", async function () {
  var st = document.getElementById("seed-status");
  st.textContent = "Menyemak…";
  try {
    var r = await seedMenuCostingIfEmpty();
    st.textContent = r.seeded ? "Seed demo ditambah." : "Tidak diubah: " + (r.reason || "");
  } catch (e) {
    console.error(e);
    st.textContent = "Ralat: " + (e.message || String(e));
  }
});
