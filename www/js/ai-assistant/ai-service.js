/**
 * Pembantu AI — Firestore knowledge_base + OpenRouter (Llama 3.1 8B).
 */
import { db, collection, getDocs, getDoc, setDoc, doc, query, where, orderBy, limit, serverTimestamp } from "../firebase/init.js";
import { COL_KNOWLEDGE_BASE, KB_MASTER_DOC_ID } from "../firebase/collections.js";
import { parseKnowledgeBody, itemsToKnowledgeBody, KB_DEFAULT_BODY } from "./knowledge-format.js";
import {
  AI_TOOLS_DEFINITION,
  getIngredientPrices,
  getMenuItems,
  getLowStock,
  getSalesSummary,
  getPurchaseHistory
} from "./ai-tools.js";

export const OPENROUTER_API_KEY = "";

var OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
var OPENROUTER_REFERER = "https://possystem-6907d.web.app";
var OPENROUTER_TITLE = "Klik Burger POS";

var MODEL_PRIMARY = "meta-llama/llama-3.1-8b-instruct";
var MODEL_FALLBACKS = ["google/gemini-flash-1.5", "mistralai/mistral-7b-instruct"];

var AI_CONFIG = {
  apiKey: OPENROUTER_API_KEY,
  apiUrl: OPENROUTER_URL,
  siteUrl: OPENROUTER_REFERER,
  siteName: OPENROUTER_TITLE,
  primaryModel: MODEL_PRIMARY,
  fallbackModels: MODEL_FALLBACKS,
  maxTokens: 600,
  temperature: 0.2
};

var NOT_FOUND_REPLY =
  "Maaf, maklumat tersebut tidak terdapat dalam sistem. Sila rujuk Owner atau pengurus.";

function toIsoUpdatedAt(value) {
  if (!value) return new Date().toISOString();
  if (typeof value.toDate === "function") {
    try {
      return value.toDate().toISOString();
    } catch (e) {}
  }
  if (typeof value === "string") return value;
  try {
    return new Date(value).toISOString();
  } catch (e2) {
    return new Date().toISOString();
  }
}

function mapKnowledgeDoc(docSnap) {
  var d = docSnap.data() || {};
  var tags = Array.isArray(d.tags) ? d.tags : [];
  return {
    id: docSnap.id,
    title: String(d.title || "").trim() || docSnap.id,
    category: String(d.category || "").trim() || "Other",
    tags: tags.map(function (t) {
      return String(t || "").trim();
    }).filter(Boolean),
    status: String(d.status || "Active").trim(),
    content: String(d.content || "").trim(),
    updatedAt: toIsoUpdatedAt(d.updatedAt)
  };
}

/**
 * @returns {Promise<Array<{id:string,title:string,category:string,tags:string[],status:string,content:string,updatedAt:string}>>}
 */
function legacyDocsToBody(snap) {
  var legacy = [];
  snap.docs.forEach(function (d) {
    if (d.id === KB_MASTER_DOC_ID) return;
    var item = mapKnowledgeDoc(d);
    if (item.title || item.content) legacy.push(item);
  });
  return legacy.length ? itemsToKnowledgeBody(legacy) : KB_DEFAULT_BODY;
}

/**
 * Teks penuh untuk editor owner (satu textarea).
 * @returns {Promise<{body:string,updatedAt:string|null}>}
 */
export function fetchOwnerKnowledgeText() {
  var masterRef = doc(db, COL_KNOWLEDGE_BASE, KB_MASTER_DOC_ID);
  return getDoc(masterRef).then(function (masterSnap) {
    if (masterSnap.exists()) {
      var body = String((masterSnap.data() || {}).body || "").trim();
      if (body) {
        return {
          body: body,
          updatedAt: toIsoUpdatedAt(masterSnap.data().updatedAt)
        };
      }
    }
    return getDocs(collection(db, COL_KNOWLEDGE_BASE)).then(function (snap) {
      return {
        body: legacyDocsToBody(snap),
        updatedAt: null
      };
    });
  });
}

/** Simpan teks penuh owner */
export function saveOwnerKnowledgeText(body) {
  return setDoc(
    doc(db, COL_KNOWLEDGE_BASE, KB_MASTER_DOC_ID),
    {
      body: String(body || ""),
      status: "Active",
      title: "Pangkalan data",
      category: "Other",
      tags: [],
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );
}

/** Item berpecah ikut ## — untuk sembang AI (koleksi + dokumen master owner) */
export async function fetchKnowledgeBase() {
  try {
    var results = await Promise.allSettled([
      (async function () {
        var q = query(
          collection(db, COL_KNOWLEDGE_BASE),
          where("status", "==", "Active"),
          orderBy("updatedAt", "desc"),
          limit(100)
        );
        var snap = await getDocs(q);
        return snap.docs
          .filter(function (d) {
            return d.id !== KB_MASTER_DOC_ID;
          })
          .map(function (d) {
            return Object.assign({ id: d.id }, d.data());
          });
      })(),

      (async function () {
        var masterRef = doc(db, COL_KNOWLEDGE_BASE, KB_MASTER_DOC_ID);
        var masterSnap = await getDoc(masterRef);
        if (!masterSnap.exists()) return [];
        var body = (masterSnap.data() && masterSnap.data().body) || "";
        return parseKnowledgeBody(body);
      })()
    ]);

    var structured = results[0].status === "fulfilled" ? results[0].value : [];
    var master = results[1].status === "fulfilled" ? results[1].value : [];

    return structured.concat(master);
  } catch (err) {
    console.error("[ai-service] fetchKnowledgeBase gagal:", err);
    return [];
  }
}

/** @deprecated — guna fetchKnowledgeBase; kekal untuk keserasian */
export function fetchKnowledgeBaseAll() {
  return fetchKnowledgeBase();
}

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(function (w) {
      return w.length > 2;
    });
}

/**
 * Skor item KB ikut padanan kata kunci; pulangkan 8 teratas.
 * @param {string} question
 * @param {Array} kbItems
 */
export function findRelevantKB(question, kbItems) {
  var items = Array.isArray(kbItems) ? kbItems : [];
  if (!items.length) return [];

  var qTokens = tokenize(question);
  if (!qTokens.length) {
    return items.slice(0, 8);
  }

  var scored = items.map(function (item) {
    var title = String(item.title || "").toLowerCase();
    var content = String(item.content || "").toLowerCase();
    var category = String(item.category || "").toLowerCase();
    var tagStr = (item.tags || []).join(" ").toLowerCase();
    var blob = title + " " + content + " " + category + " " + tagStr;
    var score = 0;

    qTokens.forEach(function (tok) {
      if (title.indexOf(tok) >= 0) score += 4;
      if (tagStr.indexOf(tok) >= 0) score += 3;
      if (category.indexOf(tok) >= 0) score += 2;
      if (content.indexOf(tok) >= 0) score += 1;
    });

    var qNorm = String(question || "")
      .toLowerCase()
      .trim();
    if (qNorm.length >= 4 && blob.indexOf(qNorm) >= 0) score += 6;

    return { item: item, score: score };
  });

  scored.sort(function (a, b) {
    if (b.score !== a.score) return b.score - a.score;
    return String(b.item.updatedAt || "").localeCompare(String(a.item.updatedAt || ""));
  });

  var top = scored.filter(function (row) {
    return row.score > 0;
  });
  var pick = (top.length ? top : scored).slice(0, 8);
  return pick.map(function (row) {
    return row.item;
  });
}

function buildSystemPrompt(relevantItems) {
  var blocks = (relevantItems || []).map(function (item, i) {
    var tags = (item.tags || []).length ? " [" + item.tags.join(", ") + "]" : "";
    return (
      (i + 1) +
      ". **" +
      item.title +
      "** (" +
      item.category +
      ")" +
      tags +
      "\n" +
      item.content
    );
  });

  var kbText =
    blocks.length > 0
      ? blocks.join("\n\n")
      : "(Tiada artikel pangkalan data yang sepadan dimuatkan.)";

  return `Anda adalah Pembantu AI untuk sistem POS ${AI_CONFIG.siteName}.
Tugas anda: membantu pengguna mendapatkan maklumat operasi perniagaan dengan cepat dan tepat.

SKOP JAWAPAN:
Anda boleh menjawab soalan berkaitan:
- Prestasi jualan dan pendapatan
- Status inventori dan stok bahan
- Maklumat produk dan menu
- Rekod pembelian bahan
- Analisis keuntungan dan kos
- Laporan operasi harian/mingguan/bulanan
- SOP dan polisi operasi syarikat
- Fungsi dan cara guna sistem POS

PERATURAN KESELAMATAN DAN PRIVASI (WAJIB DIPATUHI):
- JANGAN dedahkan kata laluan atau kelayakan pengesahan mana-mana pengguna
- JANGAN dedahkan maklumat gaji, upah, atau bayaran kakitangan
- JANGAN dedahkan data peribadi kakitangan (nombor telefon, alamat, IC, e-mel peribadi)
- JANGAN dedahkan maklumat kewangan yang terhad kepada pengurusan sahaja
- JANGAN dedahkan tetapan keselamatan sistem atau kelayakan pentadbir
- JANGAN dedahkan sebarang data yang dilindungi oleh kawalan akses berasaskan peranan
- Jika soalan menyentuh maklumat sensitif di atas, jawab: "Maklumat ini adalah sulit dan hanya boleh diakses oleh pihak yang diberi kuasa."

PERATURAN JAWAPAN:
- Jawab HANYA berdasarkan maklumat yang diberikan atau data dari tools
- JANGAN reka atau tambah maklumat yang tidak ada
- Jika maklumat tidak dijumpai, jawab: "Maaf, maklumat tersebut tidak terdapat dalam sistem. Sila rujuk Owner atau pengurus."
- Beri jawapan ringkas dan mudah difahami
- Untuk proses kerja, senaraikan langkah demi langkah (1, 2, 3...)
- Sokong Bahasa Melayu dan Bahasa Inggeris — balas dalam bahasa yang sama dengan soalan
- Jangan sebut bahawa anda AI atau model tertentu

PERATURAN PAPARAN DATA:
- Apabila tool mengembalikan senarai rekod, paparkan SEMUA rekod dalam format jadual atau senarai bernombor
- Untuk sejarah belian, tunjukkan: tarikh, kuantiti, unit, harga seunit, dan jumlah kos
- Untuk data stok, tunjukkan: nama bahan, kuantiti tinggal, unit, dan status stok
- JANGAN ringkaskan data kepada satu ayat sahaja — bentangkan setiap rekod secara berasingan
- Jika soalan meminta "detail", "terperinci", atau "lengkap", pastikan semua field dikembalikan oleh tool dipaparkan

MAKLUMAT SYARIKAT (dikemaskini oleh Owner):
${kbText}`;
}

function mapHistoryToApiMessages(historyMessages) {
  var list = Array.isArray(historyMessages) ? historyMessages : [];
  return list
    .slice(-10)
    .map(function (m) {
      var role = m && m.role === "assistant" ? "assistant" : "user";
      var content = String((m && (m.text || m.content)) || "").trim();
      return { role: role, content: content };
    })
    .filter(function (m) {
      return m.content.length > 0;
    });
}

async function executeTool(toolName, args) {
  console.info("[ai-service] Executing tool: " + toolName, args);
  var a = args && typeof args === "object" ? args : {};
  switch (toolName) {
    case "getIngredientPrices":
      return await getIngredientPrices(a.ingredientName || "");
    case "getMenuItems":
      return await getMenuItems(a.menuName || "");
    case "getLowStock":
      return await getLowStock(a.threshold != null ? a.threshold : 5);
    case "getSalesSummary":
      return await getSalesSummary(a.days != null ? a.days : 1);
    case "getPurchaseHistory":
      return await getPurchaseHistory(args.ingredientName || "", args.limitCount || 20);
    default:
      return { error: "Tool tidak dikenali" };
  }
}

async function callOpenRouter(systemPrompt, messages) {
  var models = [AI_CONFIG.primaryModel].concat(AI_CONFIG.fallbackModels);

  for (var mi = 0; mi < models.length; mi++) {
    var model = models[mi];
    try {
      var apiMessages = [{ role: "system", content: systemPrompt }].concat(messages || []);

      for (var iteration = 0; iteration < 3; iteration++) {
        var res = await fetch(AI_CONFIG.apiUrl, {
          method: "POST",
          headers: {
            Authorization: "Bearer " + AI_CONFIG.apiKey,
            "Content-Type": "application/json",
            "HTTP-Referer": AI_CONFIG.siteUrl,
            "X-Title": AI_CONFIG.siteName
          },
          body: JSON.stringify({
            model: model,
            max_tokens: AI_CONFIG.maxTokens,
            temperature: AI_CONFIG.temperature,
            tools: AI_TOOLS_DEFINITION,
            tool_choice: "auto",
            messages: apiMessages
          })
        });

        if (!res.ok) {
          var errText = await res.text();
          throw new Error("HTTP " + res.status + ": " + errText);
        }

        var data = await res.json();
        var choice = data && data.choices && data.choices[0];
        var message = choice && choice.message;

        if (!message) throw new Error("Respons kosong dari model");

        if (choice.finish_reason === "tool_calls" && message.tool_calls && message.tool_calls.length) {
          apiMessages.push(message);

          for (var ti = 0; ti < message.tool_calls.length; ti++) {
            var toolCall = message.tool_calls[ti];
            var fn = toolCall.function || {};
            var parsedArgs = {};
            try {
              parsedArgs = JSON.parse(fn.arguments || "{}");
            } catch (parseErr) {
              parsedArgs = {};
            }
            var result = await executeTool(fn.name, parsedArgs);
            apiMessages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: JSON.stringify(result)
            });
          }
          continue;
        }

        var text = message.content;
        if (!text) throw new Error("Teks respons kosong");
        console.info("[ai-service] Model digunakan: " + model);
        return String(text).trim();
      }

      throw new Error("Terlalu banyak tool call iterations");
    } catch (err) {
      console.warn("[ai-service] Model " + model + " gagal:", err && err.message ? err.message : err);
    }
  }

  return "Maaf, perkhidmatan AI tidak dapat dihubungi sekarang. Sila cuba sebentar lagi.";
}

function callOpenRouterWithFallbacks(apiMessages) {
  var systemPrompt = "";
  var messages = apiMessages || [];
  if (messages[0] && messages[0].role === "system") {
    systemPrompt = String(messages[0].content || "");
    messages = messages.slice(1);
  }
  if (!AI_CONFIG.apiKey || AI_CONFIG.apiKey === "REPLACE_WITH_YOUR_KEY") {
    return Promise.reject(new Error("OPENROUTER_API_KEY belum dikonfigurasi."));
  }
  return callOpenRouter(systemPrompt, messages);
}

/**
 * @param {string} question
 * @param {Array<{role:string,text?:string,content?:string}>} historyMessages
 * @param {Array} kbItems
 * @returns {Promise<string>}
 */
export async function askAI(question, historyMessages, kbItems) {
  var q = String(question || "").trim();
  if (!q) return Promise.resolve("");

  const kb = (kbItems === null || kbItems === undefined) ? await fetchKnowledgeBase() : kbItems;
  var relevant = findRelevantKB(q, kb || []);
  var systemPrompt = buildSystemPrompt(relevant);

  var apiMessages = [{ role: "system", content: systemPrompt }];
  mapHistoryToApiMessages(historyMessages).forEach(function (m) {
    apiMessages.push(m);
  });
  apiMessages.push({ role: "user", content: q });

  return callOpenRouterWithFallbacks(apiMessages).catch(function (err) {
    console.error("[ai-service] askAI", err);
    if (relevant.length === 0) {
      return NOT_FOUND_REPLY;
    }
    return (
      "Maaf, Pembantu AI tidak dapat dihubungi buat masa ini. Sila cuba semula atau rujuk Owner.\n\n" +
      "(" +
      String((err && err.message) || "ralat rangkaian") +
      ")"
    );
  });
}
