/**
 * Format teks tunggal pangkalan pengetahuan ↔ item untuk AI.
 * Setiap bahagian bermula dengan baris `## Tajuk`.
 */

export const KB_DEFAULT_BODY =
  "## Contoh: Harga burger\n" +
  "Burger biasa RM5.\n\n" +
  "## Cara tambah maklumat\n" +
  "Tulis tajuk pada baris ## (contoh: ## Polisi refund).\n" +
  "Di bawahnya tulis jawapan penuh. Perubahan disimpan automatik.";

/**
 * @param {string} body
 * @returns {Array<{id:string,title:string,content:string,category:string,tags:string[],status:string,updatedAt:string}>}
 */
export function parseKnowledgeBody(body) {
  var text = String(body || "").trim();
  if (!text) return [];

  var chunks = text.split(/\n(?=##\s+)/);
  var items = [];

  chunks.forEach(function (block, i) {
    block = block.trim();
    if (!block) return;
    var lines = block.split("\n");
    var firstLine = lines[0] || "";
    var title = firstLine.replace(/^#+\s*/, "").trim();
    var content = lines.slice(1).join("\n").trim();
    if (!title && !content) return;
    if (!title) title = "Maklumat " + (i + 1);
    if (!content) content = block.replace(/^#+\s*[^\n]*\n?/, "").trim() || block;
    items.push({
      id: "sec-" + i,
      title: title,
      content: content,
      category: "Other",
      tags: [],
      status: "Active",
      updatedAt: ""
    });
  });

  if (!items.length && text) {
    items.push({
      id: "sec-0",
      title: "Pangkalan data",
      content: text,
      category: "Other",
      tags: [],
      status: "Active",
      updatedAt: ""
    });
  }

  return items;
}

/**
 * @param {Array<{title:string,content:string}>} items
 */
export function itemsToKnowledgeBody(items) {
  return (items || [])
    .map(function (it) {
      var title = String(it.title || "").trim() || "Tanpa tajuk";
      var content = String(it.content || "").trim();
      return "## " + title + (content ? "\n" + content : "");
    })
    .filter(Boolean)
    .join("\n\n");
}
