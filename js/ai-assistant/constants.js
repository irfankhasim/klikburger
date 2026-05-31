/** Kategori & status — Knowledge Base (frontend sahaja). */

export const KNOWLEDGE_CATEGORIES = [
  "Product Information",
  "Promotions",
  "SOP",
  "Inventory",
  "Attendance",
  "Sales Process",
  "Refund Policy",
  "Exchange Policy",
  "FAQ",
  "Other"
];

export const KNOWLEDGE_STATUSES = ["Active", "Draft", "Archived"];

/** Label paparan BM — nilai Firestore kekal dalam Inggeris */
export const CATEGORY_LABELS_MS = {
  "Product Information": "Maklumat produk",
  Promotions: "Promosi",
  SOP: "SOP / Prosedur",
  Inventory: "Inventori / Stok",
  Attendance: "Kehadiran",
  "Sales Process": "Proses jualan",
  "Refund Policy": "Polisi bayaran balik",
  "Exchange Policy": "Polisi pertukaran",
  FAQ: "Soalan lazim",
  Other: "Lain-lain"
};

export const STATUS_LABELS_MS = {
  Active: "Aktif",
  Draft: "Draf",
  Archived: "Arkib"
};

export const SORT_OPTIONS = [
  { value: "updated-desc", label: "Terbaru dahulu" },
  { value: "updated-asc", label: "Terlama dahulu" },
  { value: "title-asc", label: "Tajuk (A–Z)" },
  { value: "title-desc", label: "Tajuk (Z–A)" },
  { value: "category-asc", label: "Kategori (A–Z)" }
];
