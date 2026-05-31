/** Utiliti UI — AI Assistant (frontend sahaja). */

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function formatDateTime(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("ms-MY", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch (e) {
    return "—";
  }
}

export function formatDateShort(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("ms-MY", {
      day: "numeric",
      month: "short",
      year: "numeric"
    });
  } catch (e) {
    return "—";
  }
}

export function normalizeSearch(s) {
  return String(s || "")
    .trim()
    .toLowerCase();
}

export function debounce(fn, ms) {
  var t;
  return function () {
    var args = arguments;
    var ctx = this;
    clearTimeout(t);
    t = setTimeout(function () {
      fn.apply(ctx, args);
    }, ms);
  };
}

export function uid(prefix) {
  return (prefix || "id") + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

export function statusClass(status) {
  var s = String(status || "").toLowerCase();
  if (s === "active") return "ai-pill ai-pill--active";
  if (s === "draft") return "ai-pill ai-pill--draft";
  if (s === "archived") return "ai-pill ai-pill--archived";
  return "ai-pill";
}
