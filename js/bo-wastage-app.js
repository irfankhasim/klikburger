/**
 * Wastage — rekod buang stok dari lot belian tertentu + sejarah bulan.
 */
import { auth, db, collection, query, where, getDocs, Timestamp } from "./firebase/init.js";
import { waitForAuthUser } from "./pos-firebase-auth-bridge.js";
import { COL_INGREDIENT_LEDGER } from "./firebase/collections.js";
import { subscribeIngredients } from "./cost-calculator/ingredients-repository.js";
import {
  subscribeIngredientBatches,
  groupBatchesByIngredientId,
  sortBatchesFifo
} from "./cost-calculator/ingredient-batch-repository.js";
import { docToIngredient } from "./cost-calculator/mappers.js";
import { recordIngredientWastage } from "./cost-calculator/record-wastage.js";
import { formatRM } from "./cost-calculator/core.js";
import { t as tr, interpolate, onLocaleChange, applyI18n, getIntlLocale, initI18n } from "./i18n/locale.js";

var REASONS = ["burnt", "spoiled", "dropped", "other"];

var ingredients = [];
var batchesByIngredientId = {};
var historyRows = [];
var filterMonthStr = "";
var saving = false;
var unsubs = [];
var pagehideBound = false;

function $(id) {
  return document.getElementById(id);
}

function pad2(n) {
  return (n < 10 ? "0" : "") + n;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatQty(n) {
  var x = typeof n === "number" ? n : parseFloat(n);
  if (isNaN(x)) x = 0;
  if (Math.abs(x - Math.round(x)) < 1e-9) return String(Math.round(x));
  var r = Math.round(x * 1000) / 1000;
  var s = String(r);
  if (s.indexOf(".") !== -1) s = s.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  return s;
}

function tsToMs(t) {
  if (!t) return 0;
  if (typeof t.toMillis === "function") return t.toMillis();
  if (typeof t.seconds === "number") return t.seconds * 1000;
  return 0;
}

function formatLotDate(t) {
  var ms = tsToMs(t);
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString(getIntlLocale(), {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

function remainingQty(ingredientId) {
  var list = batchesByIngredientId[ingredientId] || [];
  var sum = 0;
  for (var i = 0; i < list.length; i++) {
    var q = list[i].qtyRemaining;
    sum += typeof q === "number" ? q : parseFloat(q) || 0;
  }
  return sum;
}

function openLots(ingredientId) {
  var list = batchesByIngredientId[ingredientId] || [];
  return sortBatchesFifo(
    list.filter(function (b) {
      var q = typeof b.qtyRemaining === "number" ? b.qtyRemaining : parseFloat(b.qtyRemaining) || 0;
      return q > 1e-9;
    })
  );
}

function findIngredient(id) {
  for (var i = 0; i < ingredients.length; i++) {
    if (ingredients[i].id === id) return ingredients[i];
  }
  return null;
}

function findLot(ingredientId, batchId) {
  var list = batchesByIngredientId[ingredientId] || [];
  for (var i = 0; i < list.length; i++) {
    if (list[i].id === batchId) return list[i];
  }
  return null;
}

function reasonLabel(code) {
  var k = "wastage.reason." + code;
  var v = tr(k);
  return v === k ? code : v;
}

function formatSaveError(err) {
  var code = err && err.code;
  if (code === "need-ingredient") return tr("wastage.err.needIngredient");
  if (code === "need-lot") return tr("wastage.err.needLot");
  if (code === "bad-qty") return tr("wastage.err.qtyMust");
  if (code === "missing-batch") return tr("wastage.err.lotGone");
  if (code === "insufficient-batch") return tr("wastage.err.lotShort");
  if (code === "retry") return tr("wastage.err.retry");
  return tr("wastage.err.save");
}

function renderReasonSelect() {
  var el = $("wg-reason");
  if (!el) return;
  var prev = el.value || "burnt";
  el.innerHTML = REASONS.map(function (code) {
    return (
      '<option value="' +
      escapeHtml(code) +
      '"' +
      (code === prev ? " selected" : "") +
      ">" +
      escapeHtml(reasonLabel(code)) +
      "</option>"
    );
  }).join("");
  if (REASONS.indexOf(prev) >= 0) el.value = prev;
}

function setStatus(msg, kind) {
  var el = $("wg-status");
  if (!el) return;
  if (!msg) {
    el.textContent = "";
    el.classList.add("sd-status--hidden");
    el.classList.remove("sd-status--ok", "sd-status--err");
    return;
  }
  el.textContent = msg;
  el.classList.remove("sd-status--hidden", "sd-status--ok", "sd-status--err");
  el.classList.add(kind === "err" ? "sd-status--err" : "sd-status--ok");
}

function updateQtyUnit(ing) {
  var el = $("wg-qty-unit");
  if (!el) return;
  el.textContent = (ing && ing.unit) || "—";
}

function renderIngredientSelect() {
  var el = $("wg-ingredient");
  if (!el) return;
  var prev = el.value;
  var sorted = ingredients.slice().sort(function (a, b) {
    return String(a.name || "").localeCompare(String(b.name || ""), getIntlLocale());
  });
  var html = "<option value=\"\">" + escapeHtml(tr("wastage.ingredientPh")) + "</option>";
  if (!sorted.length) {
    html += "<option value=\"\" disabled>" + escapeHtml(tr("wastage.emptyIngredients")) + "</option>";
  }
  sorted.forEach(function (ing) {
    html +=
      "<option value=\"" +
      escapeHtml(ing.id) +
      "\"" +
      (ing.id === prev ? " selected" : "") +
      ">" +
      escapeHtml(ing.name || ing.id) +
      "</option>";
  });
  el.innerHTML = html;
  var ing = findIngredient(el.value);
  updateQtyUnit(ing);
  renderBatchSelect();
  updateStockHint();
  updateEstimate();
}

function renderBatchSelect() {
  var el = $("wg-batch");
  var ingSel = $("wg-ingredient");
  if (!el) return;
  var prev = el.value;
  var ingId = ingSel ? ingSel.value : "";
  var html = "<option value=\"\">" + escapeHtml(tr("wastage.batchPh")) + "</option>";
  if (!ingId) {
    el.innerHTML = html;
    return;
  }
  var ing = findIngredient(ingId);
  var unit = (ing && ing.unit) || "";
  var lots = openLots(ingId);
  if (!lots.length) {
    html += "<option value=\"\" disabled>" + escapeHtml(tr("wastage.batchNone")) + "</option>";
    el.innerHTML = html;
    return;
  }
  lots.forEach(function (lot) {
    var label = interpolate(tr("wastage.batchOption"), {
      date: formatLotDate(lot.purchaseOccurredAt || lot.openedAt),
      qty: formatQty(lot.qtyRemaining),
      unit: unit,
      cpu: formatRM(lot.costPerUnit)
    });
    html +=
      "<option value=\"" +
      escapeHtml(lot.id) +
      "\"" +
      (lot.id === prev ? " selected" : "") +
      ">" +
      escapeHtml(label) +
      "</option>";
  });
  el.innerHTML = html;
  if (prev && lots.some(function (l) { return l.id === prev; })) {
    el.value = prev;
  } else {
    el.value = lots[0].id;
  }
}

function updateStockHint() {
  var hint = $("wg-stock");
  var sel = $("wg-ingredient");
  if (!hint || !sel) return;
  var id = sel.value;
  hint.classList.remove("wg-stock--low");
  if (!id) {
    hint.textContent = tr("wastage.stockPick");
    return;
  }
  var ing = findIngredient(id);
  var unit = (ing && ing.unit) || "";
  var rem = remainingQty(id);
  if (rem <= 1e-9) {
    hint.textContent = tr("wastage.stockNone");
    hint.classList.add("wg-stock--low");
    return;
  }
  hint.textContent = interpolate(tr("wastage.stock"), { qty: formatQty(rem), unit: unit });
  if (rem <= 5) hint.classList.add("wg-stock--low");
}

function selectedQtyInStockUnit(ing) {
  var qtyEl = $("wg-qty");
  var qty = qtyEl ? parseFloat(qtyEl.value) : 0;
  if (!(qty > 0) || !ing) return 0;
  return qty;
}

function updateEstimate() {
  var hint = $("wg-estimate");
  if (!hint) return;
  hint.classList.remove("wg-stock--low");
  var ing = findIngredient(($("wg-ingredient") && $("wg-ingredient").value) || "");
  var batchEl = $("wg-batch");
  var lot = ing && batchEl && batchEl.value ? findLot(ing.id, batchEl.value) : null;
  if (!ing || !lot) {
    hint.textContent = tr("wastage.estimateNeed");
    return;
  }
  var qtyNeed = selectedQtyInStockUnit(ing);
  if (!(qtyNeed > 0)) {
    hint.textContent = tr("wastage.estimateNeed");
    return;
  }
  var rem = typeof lot.qtyRemaining === "number" ? lot.qtyRemaining : parseFloat(lot.qtyRemaining) || 0;
  var cost = qtyNeed * (lot.costPerUnit || 0);
  hint.textContent = interpolate(tr("wastage.estimate"), {
    cost: formatRM(cost),
    qty: formatQty(qtyNeed),
    unit: ing.unit || "",
    cpu: formatRM(lot.costPerUnit)
  });
  if (qtyNeed > rem + 1e-6) hint.classList.add("wg-stock--low");
}

function renderSummary() {
  var host = $("wg-summary");
  if (!host) return;
  var cost = 0;
  var ids = {};
  historyRows.forEach(function (r) {
    cost += r.costRm;
    if (r.ingredientId) ids[r.ingredientId] = true;
  });
  function card(labelKey, value, hintKey) {
    return (
      "<article class=\"sd-metric\">" +
      "<div class=\"sd-metric__label\">" +
      escapeHtml(tr(labelKey)) +
      "</div>" +
      "<div class=\"sd-metric__value\">" +
      escapeHtml(value) +
      "</div>" +
      "<div class=\"sd-metric__hint\">" +
      escapeHtml(tr(hintKey)) +
      "</div>" +
      "</article>"
    );
  }
  host.innerHTML =
    card("wastage.metric.records", String(historyRows.length), "wastage.metric.recordsHint") +
    card("wastage.metric.cost", formatRM(cost), "wastage.metric.costHint") +
    card("wastage.metric.items", String(Object.keys(ids).length), "wastage.metric.itemsHint");
}

function lotLabelFromRow(r) {
  if (r.lotDate || r.costPerUnit) {
    var bits = [];
    if (r.lotDate) bits.push(r.lotDate);
    if (r.costPerUnit) bits.push(formatRM(r.costPerUnit) + "/" + (r.unit || "unit"));
    return bits.join(" · ") || "—";
  }
  return "—";
}

function renderHistory() {
  var body = $("wg-history-body");
  if (!body) return;
  if (!historyRows.length) {
    body.innerHTML = "<tr><td colspan=\"7\">" + escapeHtml(tr("wastage.empty")) + "</td></tr>";
    return;
  }
  var loc = getIntlLocale();
  body.innerHTML = historyRows
    .map(function (r) {
      var when = r.whenMs
        ? new Date(r.whenMs).toLocaleString(loc, {
            day: "2-digit",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit"
          })
        : "—";
      return (
        "<tr>" +
        "<td>" +
        escapeHtml(when) +
        "</td>" +
        "<td>" +
        escapeHtml(r.name) +
        "</td>" +
        "<td>" +
        escapeHtml(formatQty(r.qty) + " " + (r.unit || "")) +
        "</td>" +
        "<td>" +
        escapeHtml(lotLabelFromRow(r)) +
        "</td>" +
        "<td>" +
        escapeHtml(reasonLabel(r.reason)) +
        "</td>" +
        "<td>" +
        escapeHtml(formatRM(r.costRm)) +
        "</td>" +
        "<td>" +
        escapeHtml(r.notes || "—") +
        "</td>" +
        "</tr>"
      );
    })
    .join("");
}

function refreshAll() {
  renderIngredientSelect();
  renderReasonSelect();
  renderSummary();
  renderHistory();
}

function parseMonthInput(s) {
  var m = String(s || "").match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  return { y: parseInt(m[1], 10), m0: parseInt(m[2], 10) - 1 };
}

async function fetchHistoryForMonth() {
  var ym = parseMonthInput(filterMonthStr);
  if (!ym) {
    historyRows = [];
    renderSummary();
    renderHistory();
    return;
  }
  var start = Timestamp.fromDate(new Date(ym.y, ym.m0, 1));
  var end = Timestamp.fromDate(new Date(ym.y, ym.m0 + 1, 1));
  try {
    var snap = await getDocs(
      query(collection(db, COL_INGREDIENT_LEDGER), where("occurredAt", ">=", start), where("occurredAt", "<", end))
    );
    var rows = [];
    snap.forEach(function (d) {
      var x = d.data();
      if (String(x.kind || "") !== "wastage") return;
      var iid = String(x.ingredientId || "");
      var ing = findIngredient(iid);
      var qty = typeof x.purchaseQty === "number" ? Math.abs(x.purchaseQty) : Math.abs(parseFloat(x.purchaseQty) || 0);
      var cost = typeof x.purchasePrice === "number" ? Math.abs(x.purchasePrice) : Math.abs(parseFloat(x.purchasePrice) || 0);
      var cpu = typeof x.costPerUnit === "number" ? x.costPerUnit : parseFloat(x.costPerUnit) || 0;
      var alloc = Array.isArray(x.batchAllocations) && x.batchAllocations[0] ? x.batchAllocations[0] : null;
      var lotTs = alloc ? alloc.purchaseOccurredAt || alloc.openedAt : null;
      rows.push({
        id: d.id,
        ingredientId: iid,
        name: (ing && ing.name) || String(x.nameSnapshot || iid || "—"),
        qty: qty,
        unit: String(x.unit || (ing && ing.unit) || ""),
        reason: String(x.reason || "other"),
        notes: String(x.notes || ""),
        costRm: Math.round(cost * 100) / 100,
        costPerUnit: cpu,
        lotDate: formatLotDate(lotTs),
        whenMs: tsToMs(x.occurredAt)
      });
    });
    rows.sort(function (a, b) {
      return b.whenMs - a.whenMs;
    });
    historyRows = rows;
  } catch (err) {
    console.error(err);
    historyRows = [];
    setStatus(tr("wastage.err.load"), "err");
  }
  renderSummary();
  renderHistory();
}

function onIngredientChange() {
  var ing = findIngredient(($("wg-ingredient") && $("wg-ingredient").value) || "");
  updateQtyUnit(ing);
  renderBatchSelect();
  updateStockHint();
  updateEstimate();
}

async function onSubmit(e) {
  e.preventDefault();
  if (saving) return;
  var sel = $("wg-ingredient");
  var batchEl = $("wg-batch");
  var qtyEl = $("wg-qty");
  var reasonEl = $("wg-reason");
  var notesEl = $("wg-notes");
  var id = sel && sel.value;
  var ing = findIngredient(id);
  if (!ing) {
    setStatus(tr("wastage.err.ingredient"), "err");
    return;
  }
  var batchId = batchEl && batchEl.value;
  var lot = batchId ? findLot(ing.id, batchId) : null;
  if (!lot) {
    setStatus(tr("wastage.err.batch"), "err");
    return;
  }
  var qty = qtyEl ? parseFloat(qtyEl.value) : 0;
  if (!(qty > 0)) {
    setStatus(tr("wastage.err.qty"), "err");
    return;
  }
  var unit = ing.unit || "";
  var qtyNeed = qty;
  var rem = typeof lot.qtyRemaining === "number" ? lot.qtyRemaining : parseFloat(lot.qtyRemaining) || 0;
  if (qtyNeed > rem + 1e-6) {
    setStatus(interpolate(tr("wastage.err.overLot"), { qty: formatQty(rem), unit: ing.unit || "" }), "err");
    return;
  }
  var reason = (reasonEl && reasonEl.value) || "other";
  if (REASONS.indexOf(reason) < 0) reason = "other";
  var notes = notesEl ? String(notesEl.value || "").trim() : "";
  var estCost = qtyNeed * (lot.costPerUnit || 0);
  var lotDate = formatLotDate(lot.purchaseOccurredAt || lot.openedAt);
  var ok = window.confirm(
    interpolate(tr("wastage.confirm"), {
      qty: formatQty(qtyNeed),
      unit: ing.unit || unit,
      name: ing.name,
      lot: lotDate,
      cpu: formatRM(lot.costPerUnit),
      cost: formatRM(estCost),
      reason: reasonLabel(reason)
    })
  );
  if (!ok) return;

  saving = true;
  var btn = $("wg-submit");
  if (btn) btn.disabled = true;
  var btnLabel = btn && btn.querySelector("[data-i18n]");
  if (btnLabel) btnLabel.textContent = tr("wastage.saving");
  setStatus("");
  try {
    var result = await recordIngredientWastage({
      ingredientId: ing.id,
      batchId: lot.id,
      qty: qty,
      unit: unit,
      stockUnit: unit,
      reason: reason,
      notes: notes,
      nameSnapshot: ing.name
    });
    if (qtyEl) qtyEl.value = "";
    if (notesEl) notesEl.value = "";
    setStatus(
      interpolate(tr("wastage.ok"), {
        qty: formatQty(result && result.qty != null ? result.qty : qtyNeed),
        unit: unit,
        name: ing.name,
        cost: formatRM(result && result.costRm != null ? result.costRm : estCost)
      }),
      "ok"
    );
    renderBatchSelect();
    updateStockHint();
    updateEstimate();
    await fetchHistoryForMonth();
  } catch (err) {
    console.error(err);
    setStatus(formatSaveError(err), "err");
  } finally {
    saving = false;
    if (btn) btn.disabled = false;
    if (btnLabel) btnLabel.textContent = tr("wastage.submit");
  }
}

function teardown() {
  unsubs.forEach(function (u) {
    try {
      if (typeof u === "function") u();
    } catch (e) {}
  });
  unsubs = [];
}

function bindPagehideOnce() {
  if (pagehideBound) return;
  pagehideBound = true;
  window.addEventListener("pagehide", teardown);
}

function refreshStaticI18n() {
  applyI18n(document);
}

async function main() {
  initI18n();
  refreshStaticI18n();
  bindPagehideOnce();

  var monthInp = $("wg-filter-month");
  var n = new Date();
  filterMonthStr = n.getFullYear() + "-" + pad2(n.getMonth() + 1);
  if (monthInp) {
    monthInp.value = filterMonthStr;
    monthInp.addEventListener("change", function () {
      filterMonthStr = monthInp.value || filterMonthStr;
      fetchHistoryForMonth();
    });
  }

  var form = $("wg-form");
  if (form) form.addEventListener("submit", onSubmit);
  var ingSel = $("wg-ingredient");
  if (ingSel) ingSel.addEventListener("change", onIngredientChange);
  var batchEl = $("wg-batch");
  if (batchEl) batchEl.addEventListener("change", updateEstimate);
  var qtyEl = $("wg-qty");
  if (qtyEl) qtyEl.addEventListener("input", updateEstimate);

  try {
    await waitForAuthUser();
    if (auth.currentUser) await auth.currentUser.getIdToken(false);
  } catch (e) {
    console.warn("[wastage] auth", e);
  }

  unsubs.push(
    subscribeIngredients(
      function (snap) {
        try {
          ingredients = snap.docs.map(docToIngredient);
        } catch (err) {
          console.error(err);
          ingredients = [];
        }
        renderIngredientSelect();
        fetchHistoryForMonth();
      },
      function (err) {
        console.error(err);
        ingredients = [];
        setStatus(err.message || String(err), "err");
        renderIngredientSelect();
      }
    )
  );

  unsubs.push(
    subscribeIngredientBatches(
      function (snap) {
        try {
          batchesByIngredientId = groupBatchesByIngredientId(snap);
        } catch (err) {
          console.error(err);
          batchesByIngredientId = {};
        }
        renderBatchSelect();
        updateStockHint();
        updateEstimate();
      },
      function (err) {
        console.error(err);
      }
    )
  );

  refreshAll();
  await fetchHistoryForMonth();
}

initI18n();

onLocaleChange(function () {
  refreshStaticI18n();
  refreshAll();
});

main().catch(function (e) {
  console.error(e);
  setStatus(e.message || String(e), "err");
});
