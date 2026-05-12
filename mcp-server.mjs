/**
 * MCP server (stdio) — Firebase Admin read-only tools for POS data.
 * Run from repo root: node mcp-server.mjs
 * Requires credentials like other scripts (see scripts/lib/admin-init.mjs).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getAdminFirestore } from "./scripts/lib/admin-init.mjs";
import {
  COL_INGREDIENTS,
  COL_MENU_ITEMS,
  COL_POS_ORDERS,
  COL_SALES,
  COL_STAFF
} from "./js/firebase/collections.js";

const ORDERS_LIMIT = 50;
const SALES_FETCH_LIMIT = 200;
const SALES_RECENT_IN_RESPONSE = 15;

/** @param {unknown} value */
function toPlain(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(toPlain);
  if (value && typeof value === "object") {
    if (typeof value.toDate === "function") {
      try {
        return value.toDate().toISOString();
      } catch {
        /* fall through */
      }
    }
    if (value.constructor && value.constructor.name === "DocumentReference") {
      return { _ref: /** @type {{ path: string }} */ (value).path };
    }
    if (value.constructor && value.constructor.name === "GeoPoint") {
      return { _geo: { lat: value.latitude, lng: value.longitude } };
    }
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = toPlain(v);
    }
    return out;
  }
  return String(value);
}

function textResult(obj) {
  return {
    content: [{ type: "text", text: JSON.stringify(obj, null, 2) }]
  };
}

function toolError(message) {
  return {
    isError: true,
    content: [{ type: "text", text: message }]
  };
}

async function fetchCollectionDocs(colName, options) {
  const db = getAdminFirestore();
  var ref = db.collection(colName);
  if (options && options.orderBy) {
    ref = ref.orderBy(options.orderBy.field, options.orderBy.direction || "desc");
  }
  if (options && typeof options.limit === "number") {
    ref = ref.limit(options.limit);
  }
  const snap = await ref.get();
  return snap.docs.map(function (d) {
    return { id: d.id, ...toPlain(d.data()) };
  });
}

const mcp = new McpServer(
  { name: "fyp-pos-firestore", version: "1.0.0" },
  {
    capabilities: {},
    instructions:
      "Read-only Firestore tools for the Klik Burger POS project. Uses the same collections as js/firebase/collections.js."
  }
);

mcp.registerTool(
  "get_menu_items",
  { description: "Fetch all documents from the menu_items collection (name, sellingPrice, recipeId, sortIndex, …)." },
  async function () {
    try {
      const rows = await fetchCollectionDocs(COL_MENU_ITEMS, {
        orderBy: { field: "sortIndex", direction: "asc" }
      });
      return textResult({ collection: COL_MENU_ITEMS, count: rows.length, items: rows });
    } catch (e) {
      try {
        const rows = await fetchCollectionDocs(COL_MENU_ITEMS, {});
        return textResult({ collection: COL_MENU_ITEMS, count: rows.length, items: rows, note: "fallback without sortIndex order" });
      } catch (e2) {
        return toolError(String(e2 && e2.message ? e2.message : e2));
      }
    }
  }
);

mcp.registerTool(
  "get_orders",
  {
    description:
      "Fetch recent POS orders from pos_orders (newest first), including orderNo, lifecycle, lines summary, subtotal, createdAt."
  },
  async function () {
    try {
      const rows = await fetchCollectionDocs(COL_POS_ORDERS, {
        orderBy: { field: "createdAt", direction: "desc" },
        limit: ORDERS_LIMIT
      });
      return textResult({ collection: COL_POS_ORDERS, limit: ORDERS_LIMIT, count: rows.length, orders: rows });
    } catch (e) {
      return toolError(String(e && e.message ? e.message : e));
    }
  }
);

mcp.registerTool(
  "get_staff_list",
  { description: "Fetch all staff profiles from the staff collection." },
  async function () {
    try {
      const rows = await fetchCollectionDocs(COL_STAFF, {});
      return textResult({ collection: COL_STAFF, count: rows.length, staff: rows });
    } catch (e) {
      return toolError(String(e && e.message ? e.message : e));
    }
  }
);

mcp.registerTool(
  "get_sales_summary",
  {
    description:
      "Fetch recent sales documents and a numeric summary: count, sum of subtotal, sum of totalCogsFifo, plus a short list of recent sales."
  },
  async function () {
    try {
      const db = getAdminFirestore();
      const snap = await db
        .collection(COL_SALES)
        .orderBy("createdAt", "desc")
        .limit(SALES_FETCH_LIMIT)
        .get();
      var sumSub = 0;
      var sumCogs = 0;
      const recent = [];
      var i = 0;
      snap.forEach(function (d) {
        const plain = { id: d.id, ...toPlain(d.data()) };
        var sub = plain.subtotal;
        var cogs = plain.totalCogsFifo;
        if (typeof sub === "number" && !Number.isNaN(sub)) sumSub += sub;
        if (typeof cogs === "number" && !Number.isNaN(cogs)) sumCogs += cogs;
        if (i < SALES_RECENT_IN_RESPONSE) recent.push(plain);
        i++;
      });
      return textResult({
        collection: COL_SALES,
        window: { orderBy: "createdAt desc", limit: SALES_FETCH_LIMIT },
        summary: {
          documentCount: snap.size,
          sumSubtotal: sumSub,
          sumTotalCogsFifo: sumCogs
        },
        recentSales: recent
      });
    } catch (e) {
      return toolError(String(e && e.message ? e.message : e));
    }
  }
);

mcp.registerTool(
  "get_ingredients",
  { description: "Fetch all ingredients / inventory rows from the ingredients collection." },
  async function () {
    try {
      const rows = await fetchCollectionDocs(COL_INGREDIENTS, {
        orderBy: { field: "sortIndex", direction: "asc" }
      });
      return textResult({ collection: COL_INGREDIENTS, count: rows.length, ingredients: rows });
    } catch (e) {
      try {
        const rows = await fetchCollectionDocs(COL_INGREDIENTS, {});
        return textResult({
          collection: COL_INGREDIENTS,
          count: rows.length,
          ingredients: rows,
          note: "fallback without sortIndex order"
        });
      } catch (e2) {
        return toolError(String(e2 && e2.message ? e2.message : e2));
      }
    }
  }
);

const transport = new StdioServerTransport();
await mcp.connect(transport);
