/** Data statik — akan diganti backend / OpenRouter pada fasa seterusnya. */

import { uid } from "./utils.js";

function daysAgo(n) {
  var d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

export var MOCK_KNOWLEDGE_ITEMS = [
  {
    id: "kb-001",
    title: "Zesty Double — ingredients & allergens",
    category: "Product Information",
    tags: ["menu", "allergen", "burger"],
    status: "Active",
    content:
      "Zesty Double contains beef patty ×2, cheddar, spicy mayo, pickles, sesame bun. Contains gluten, dairy, egg. Halal-certified supply chain.",
    updatedAt: daysAgo(1)
  },
  {
    id: "kb-002",
    title: "Weekend bundle — 15% off",
    category: "Promotions",
    tags: ["promo", "weekend"],
    status: "Active",
    content: "Every Sat–Sun until 30 Jun: Classic Set + drink at 15% off when ordered before 3pm. Not combinable with staff discount.",
    updatedAt: daysAgo(2)
  },
  {
    id: "kb-003",
    title: "Opening shift checklist",
    category: "SOP",
    tags: ["shift", "opening"],
    status: "Active",
    content:
      "1) Clock in with your name. 2) Count float. 3) Open drawer. 4) Verify printer & KDS. 5) Check low-stock alerts in Back Office.",
    updatedAt: daysAgo(3)
  },
  {
    id: "kb-004",
    title: "Low stock threshold — poultry",
    category: "Inventory",
    tags: ["stock", "chicken"],
    status: "Active",
    content: "Reorder when frozen chicken drops below 8 kg. Log adjustment in inventory module with reason code.",
    updatedAt: daysAgo(4)
  },
  {
    id: "kb-005",
    title: "Clock in / clock out rules",
    category: "Attendance",
    tags: ["attendance", "hr"],
    status: "Active",
    content:
      "Staff must select operational name at clock in. One active clock-in per terminal. Clock out before leaving unless shift lead approves handover.",
    updatedAt: daysAgo(5)
  },
  {
    id: "kb-006",
    title: "POS checkout flow",
    category: "Sales Process",
    tags: ["pos", "payment"],
    status: "Active",
    content: "Cart → Review → Payment (Cash / DuitNow) → Receipt prints → Order appears on kitchen board. Do not skip review on orders above RM 80.",
    updatedAt: daysAgo(6)
  },
  {
    id: "kb-007",
    title: "Refund policy (same day)",
    category: "Refund Policy",
    tags: ["refund", "customer"],
    status: "Active",
    content:
      "Same-day refunds require receipt, shift lead PIN, and reason. Cash refunds from drawer; DuitNow refunds logged for owner approval within 24h.",
    updatedAt: daysAgo(7)
  },
  {
    id: "kb-008",
    title: "Exchange policy",
    category: "Exchange Policy",
    tags: ["exchange"],
    status: "Draft",
    content: "Draft: exchanges allowed within 30 minutes for wrong item if kitchen has not started. Use void + new order workflow.",
    updatedAt: daysAgo(10)
  },
  {
    id: "kb-009",
    title: "Wi‑Fi printer troubleshooting",
    category: "FAQ",
    tags: ["printer", "faq"],
    status: "Active",
    content: "Restart printer, confirm IP 192.168.1.50, re-run test print from POS settings. Escalate to owner if offline > 10 minutes.",
    updatedAt: daysAgo(12)
  },
  {
    id: "kb-010",
    title: "Legacy combo pricing (archived)",
    category: "Other",
    tags: ["archive"],
    status: "Archived",
    content: "Superseded menu combos from 2024 — kept for reference only.",
    updatedAt: daysAgo(45)
  }
];

export var MOCK_OWNER_CONVERSATIONS = [
  {
    id: "conv-1",
    title: "Refund steps summary",
    updatedAt: daysAgo(0),
    messages: [
      { role: "user", text: "Summarise our same-day refund policy for staff briefing.", at: daysAgo(0) },
      {
        role: "assistant",
        text:
          "Same-day refunds need: (1) original receipt, (2) shift lead PIN, (3) documented reason. Cash from drawer; DuitNow refunds need owner approval within 24 hours.",
        at: daysAgo(0)
      }
    ]
  },
  {
    id: "conv-2",
    title: "Active promotions",
    updatedAt: daysAgo(1),
    messages: [
      { role: "user", text: "What weekend promotions are active?", at: daysAgo(1) },
      {
        role: "assistant",
        text: "Weekend bundle: Classic Set + drink at 15% off Sat–Sun before 3pm until 30 Jun. Not stackable with staff discount.",
        at: daysAgo(1)
      }
    ]
  },
  {
    id: "conv-3",
    title: "Opening SOP",
    updatedAt: daysAgo(3),
    messages: [
      { role: "user", text: "List opening shift checklist.", at: daysAgo(3) },
      {
        role: "assistant",
        text: "Clock in → count float → open drawer → verify printer & KDS → review low-stock alerts.",
        at: daysAgo(3)
      }
    ]
  }
];

export var STAFF_QUICK_SUGGESTIONS = [
  "Bagaimana cara proses bayaran balik?",
  "Bagaimana cara tambah stok?",
  "Promosi apa yang sedang aktif?",
  "Bagaimana cara clock in?",
  "Apakah polisi pertukaran?"
];

/** Balasan mock — carian ringkas dalam knowledge (tanpa API). */
export function mockAiReply(userText, knowledgeItems) {
  var q = String(userText || "").toLowerCase();
  var hits = knowledgeItems.filter(function (item) {
    if (item.status !== "Active") return false;
    var blob = (item.title + " " + item.content + " " + (item.tags || []).join(" ")).toLowerCase();
    return (
      q.split(/\s+/).some(function (w) {
        return w.length > 3 && blob.indexOf(w) >= 0;
      }) || blob.indexOf(q.slice(0, 12)) >= 0
    );
  });
  if (hits.length) {
    var top = hits[0];
    return (
      "Berdasarkan **" +
      top.title +
      "** (" +
      top.category +
      "):\n\n" +
      top.content +
      "\n\n_(Balasan mock — OpenRouter belum disambung.)_"
    );
  }
  return (
    "Tiada artikel pangkalan data yang sepadan. Cuba tanya tentang bayaran balik, promosi, clock in, atau inventori.\n\n_(Balasan mock — sambung API Pangkalan data kemudian.)_"
  );
}

export function createEmptyConversation() {
  return {
    id: uid("conv"),
    title: "Sembang baharu",
    updatedAt: new Date().toISOString(),
    messages: []
  };
}
