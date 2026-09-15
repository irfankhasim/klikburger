/**
 * Ganti native <select> dengan dropdown seragam (senarai ke bawah).
 * Nilai & peristiwa `change` kekal pada elemen <select> asal.
 */
var CSS_HREF = new URL("../../css/kb-dropdown.css", import.meta.url).href;
var SKIP = "data-kb-dd-off";
var READY = "data-kb-dd-ready";
var LIST_Z = "2147483646";
var listSeq = 0;

function ensureCss() {
  if (document.querySelector('link[data-kb-dd-css]')) return;
  var link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = CSS_HREF;
  link.setAttribute("data-kb-dd-css", "1");
  document.head.appendChild(link);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function findList(dd) {
  if (dd.__kbDdList) return dd.__kbDdList;
  var btn = dd.querySelector(".kb-dd__btn");
  var id = btn && btn.getAttribute("aria-controls");
  if (id) {
    var el = document.getElementById(id);
    if (el) return el;
  }
  return dd.querySelector(".kb-dd__list");
}

function parkList(dd, list) {
  if (!list) return;
  list.hidden = true;
  list.style.position = "";
  list.style.left = "";
  list.style.top = "";
  list.style.width = "";
  list.style.right = "";
  list.style.bottom = "";
  list.style.maxHeight = "";
  list.style.zIndex = "";
  if (list.parentNode !== dd) dd.appendChild(list);
}

function closeAll(except) {
  document.querySelectorAll(".kb-dd.is-open").forEach(function (dd) {
    if (dd === except) return;
    dd.classList.remove("is-open");
    parkList(dd, findList(dd));
    var btn = dd.querySelector(".kb-dd__btn");
    if (btn) btn.setAttribute("aria-expanded", "false");
  });
}

function placeList(btn, list) {
  var r = btn.getBoundingClientRect();
  var gap = 2;
  var spaceBelow = window.innerHeight - r.bottom - 8;
  var maxH = Math.min(256, Math.max(96, spaceBelow));
  var left = Math.max(8, Math.min(r.left, window.innerWidth - r.width - 8));
  list.style.position = "fixed";
  list.style.left = left + "px";
  list.style.top = r.bottom + gap + "px";
  list.style.width = Math.max(r.width, 8) + "px";
  list.style.right = "auto";
  list.style.bottom = "auto";
  list.style.maxHeight = maxH + "px";
  list.style.zIndex = LIST_Z;
}

function repositionOpen() {
  document.querySelectorAll(".kb-dd.is-open").forEach(function (dd) {
    var btn = dd.querySelector(".kb-dd__btn");
    var list = findList(dd);
    if (btn && list && !list.hidden) placeList(btn, list);
  });
}

function optionLabel(opt) {
  var t = String(opt.textContent || "").replace(/\s+/g, " ").trim();
  return t || opt.value || "";
}

function syncFromSelect(sel, ui) {
  if (!sel || !ui) return;
  var html = "";
  var label = "";
  var selected = sel.selectedIndex;
  for (var i = 0; i < sel.options.length; i++) {
    var opt = sel.options[i];
    var active = i === selected && !opt.disabled;
    if (active) label = optionLabel(opt);
    html +=
      '<li class="kb-dd__opt' +
      (active ? " is-active" : "") +
      (opt.disabled ? " is-disabled" : "") +
      '" role="option" data-index="' +
      i +
      '"' +
      (opt.disabled ? ' aria-disabled="true"' : "") +
      ">" +
      escapeHtml(optionLabel(opt) || "\u2014") +
      "</li>";
  }
  ui.list.innerHTML = html;
  if (!label && sel.options.length) {
    var first = sel.options[sel.selectedIndex >= 0 ? sel.selectedIndex : 0];
    label = first ? optionLabel(first) : "";
  }
  ui.label.textContent = label || "\u2014";
  ui.btn.disabled = !!sel.disabled;
}

function hookValue(sel, onSet) {
  var valueDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
  var indexDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "selectedIndex");
  if (valueDesc && valueDesc.set) {
    Object.defineProperty(sel, "value", {
      configurable: true,
      enumerable: true,
      get: function () {
        return valueDesc.get.call(this);
      },
      set: function (v) {
        valueDesc.set.call(this, v);
        onSet();
      }
    });
  }
  if (indexDesc && indexDesc.set) {
    Object.defineProperty(sel, "selectedIndex", {
      configurable: true,
      enumerable: true,
      get: function () {
        return indexDesc.get.call(this);
      },
      set: function (v) {
        indexDesc.set.call(this, v);
        onSet();
      }
    });
  }
}

function cleanupWrap(node) {
  if (!node || node.nodeType !== 1) return;
  var dds = [];
  if (node.classList && node.classList.contains("kb-dd")) dds.push(node);
  if (node.querySelectorAll) {
    node.querySelectorAll(".kb-dd").forEach(function (dd) {
      dds.push(dd);
    });
  }
  dds.forEach(function (dd) {
    var list = findList(dd);
    if (list && list.parentNode && list.parentNode !== dd) {
      list.parentNode.removeChild(list);
    }
  });
}

function enhanceSelect(sel) {
  if (!sel || sel.nodeName !== "SELECT") return;
  if (sel.hasAttribute(READY) || sel.hasAttribute(SKIP)) return;
  if (sel.multiple || (sel.size && sel.size > 1)) return;
  if (sel.closest(".kb-dd")) return;

  sel.setAttribute(READY, "1");
  sel.setAttribute("tabindex", "-1");
  var wrap = document.createElement("div");
  wrap.className = "kb-dd";
  sel.parentNode.insertBefore(wrap, sel);
  wrap.appendChild(sel);
  sel.classList.add("kb-dd__native");

  var btn = document.createElement("button");
  btn.type = "button";
  btn.className = "kb-dd__btn";
  btn.setAttribute("aria-haspopup", "listbox");
  btn.setAttribute("aria-expanded", "false");
  var listId = (sel.id || "kb-dd-" + ++listSeq) + "-list";
  btn.setAttribute("aria-controls", listId);
  var aria = sel.getAttribute("aria-label");
  if (aria) btn.setAttribute("aria-label", aria);
  if (sel.required) btn.setAttribute("aria-required", "true");

  var label = document.createElement("span");
  label.className = "kb-dd__label";
  var chev = document.createElement("span");
  chev.className = "kb-dd__chevron";
  chev.setAttribute("aria-hidden", "true");
  btn.appendChild(label);
  btn.appendChild(chev);

  var list = document.createElement("ul");
  list.className = "kb-dd__list";
  list.id = listId;
  list.setAttribute("role", "listbox");
  list.hidden = true;

  wrap.insertBefore(btn, sel);
  wrap.appendChild(list);
  wrap.__kbDdList = list;

  var ui = { wrap: wrap, btn: btn, label: label, list: list };
  function refresh() {
    syncFromSelect(sel, ui);
  }
  refresh();
  hookValue(sel, refresh);

  var mo = new MutationObserver(refresh);
  mo.observe(sel, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["disabled", "value"]
  });

  sel.addEventListener("change", function () {
    wrap.classList.remove("kb-dd--invalid");
    refresh();
  });
  sel.addEventListener("invalid", function () {
    wrap.classList.add("kb-dd--invalid");
  });

  btn.addEventListener("click", function (e) {
    e.preventDefault();
    e.stopPropagation();
    if (sel.disabled) return;
    var wasOpen = wrap.classList.contains("is-open");
    closeAll();
    if (!wasOpen) {
      wrap.classList.add("is-open");
      document.body.appendChild(list);
      list.hidden = false;
      btn.setAttribute("aria-expanded", "true");
      placeList(btn, list);
    }
  });

  list.addEventListener("mousedown", function (e) {
    e.stopPropagation();
  });
  list.addEventListener("click", function (e) {
    e.stopPropagation();
    var opt = e.target.closest(".kb-dd__opt");
    if (!opt || opt.classList.contains("is-disabled")) return;
    var idx = parseInt(opt.getAttribute("data-index"), 10);
    if (isNaN(idx)) return;
    sel.selectedIndex = idx;
    closeAll();
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    sel.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function enhanceAll(root) {
  var scope = root && root.querySelectorAll ? root : document;
  if (scope.nodeName === "SELECT") {
    enhanceSelect(scope);
    return;
  }
  scope.querySelectorAll("select").forEach(enhanceSelect);
}

function bindGlobals() {
  if (bindGlobals.done) return;
  bindGlobals.done = true;
  document.addEventListener("click", function (e) {
    if (e.target.closest(".kb-dd") || e.target.closest(".kb-dd__list")) return;
    closeAll();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeAll();
  });
  window.addEventListener("resize", repositionOpen);
  window.addEventListener("scroll", repositionOpen, true);
  if (typeof MutationObserver !== "undefined" && document.body) {
    var docMo = new MutationObserver(function (recs) {
      recs.forEach(function (rec) {
        rec.addedNodes.forEach(function (n) {
          if (n.nodeType !== 1) return;
          if (n.nodeName === "SELECT") enhanceSelect(n);
          else if (n.querySelectorAll) enhanceAll(n);
        });
        rec.removedNodes.forEach(cleanupWrap);
      });
    });
    docMo.observe(document.body, { childList: true, subtree: true });
  }
}

export function initKbDropdowns() {
  ensureCss();
  function go() {
    bindGlobals();
    enhanceAll(document);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", go);
  } else if (!document.body) {
    document.addEventListener("DOMContentLoaded", go);
  } else {
    go();
  }
}

initKbDropdowns();
