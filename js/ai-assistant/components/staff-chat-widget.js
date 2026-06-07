/**
 * Floating AI chat widget — semua pengguna & halaman (OpenRouter + Firestore KB).
 */
import { escapeHtml, formatDateTime } from "../utils.js";
import { STAFF_QUICK_SUGGESTIONS } from "../mock-data.js";
import { askAI, fetchKnowledgeBase } from "../ai-service.js";
import { loadSession } from "../../pos-rbac-session.js";

/** Ikon FAB — gelembung sembang + sparkle (gaya pembantu AI). */
var FAB_ICON_SVG =
  '<svg class="ai-staff-widget__fab-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
  '<path fill="currentColor" d="M12 3.5c-4.14 0-7.5 3.13-7.5 7 0 1.55.58 2.98 1.56 4.07L4.5 19.5l4.35-2.18c.98.36 2.05.56 3.15.56 4.14 0 7.5-3.13 7.5-7s-3.36-7-7.5-7z"/>' +
  '<circle fill="#1a1a1a" cx="9.25" cy="10.75" r="1.15"/>' +
  '<circle fill="#1a1a1a" cx="14.75" cy="10.75" r="1.15"/>' +
  '<path fill="currentColor" d="M18.25 3.25l.75 1.55 1.55.75-1.55.75-.75 1.55-.75-1.55-1.55-.75 1.55-.75.75-1.55z"/>' +
  "</svg>";

var SEND_ICON_SVG =
  '<svg class="ai-staff-drawer__send-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2z"/></svg>';

var INPUT_MAX_HEIGHT_PX = 120;

function renderMarkdownLite(text) {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br>");
}

export function mountGlobalAiChatWidget() {
  if (document.getElementById("kb-ai-staff-widget")) return;

  var wrap = document.createElement("div");
  wrap.id = "kb-ai-staff-widget";
  wrap.className = "ai-staff-widget";
  wrap.innerHTML =
    '<button type="button" class="ai-staff-widget__backdrop" tabindex="-1" aria-hidden="true" data-ai-backdrop></button>' +
    '<button type="button" class="ai-staff-widget__fab" aria-expanded="false" aria-controls="kb-ai-staff-drawer" aria-label="Buka Pembantu AI">' +
    FAB_ICON_SVG +
    "</button>" +
    '<div id="kb-ai-staff-drawer" class="ai-staff-drawer" role="dialog" aria-modal="true" aria-labelledby="kb-ai-staff-title" aria-hidden="true">' +
    '<header class="ai-staff-drawer__head">' +
    '<div><h2 id="kb-ai-staff-title" class="ai-staff-drawer__title">Pembantu AI</h2>' +
    '<p class="ai-staff-drawer__sub">Tanya tentang SOP syarikat, produk dan cara guna sistem.</p></div>' +
    '<button type="button" class="ai-staff-drawer__close" aria-label="Tutup"><span aria-hidden="true">×</span></button>' +
    "</header>" +
    '<div class="ai-staff-drawer__suggestions" data-ai-mount="suggestions"></div>' +
    '<div class="ai-staff-drawer__messages" data-ai-mount="messages" aria-live="polite"></div>' +
    '<div class="ai-staff-drawer__typing" data-ai-mount="typing" hidden><span></span><span></span><span></span></div>' +
    '<form class="ai-staff-drawer__composer">' +
    '<div class="ai-staff-drawer__composer-inner">' +
    '<label class="sr-only" for="kb-ai-staff-input">Mesej</label>' +
    '<textarea id="kb-ai-staff-input" class="ai-staff-drawer__input" rows="1" placeholder="Tanya apa sahaja…" autocomplete="off"></textarea>' +
    '<button type="submit" class="ai-staff-drawer__send" aria-label="Hantar">' +
    SEND_ICON_SVG +
    "</button></div></form></div>";

  document.body.appendChild(wrap);

  var fab = wrap.querySelector(".ai-staff-widget__fab");
  var backdrop = wrap.querySelector("[data-ai-backdrop]");
  var drawer = wrap.querySelector("#kb-ai-staff-drawer");
  var closeBtn = wrap.querySelector(".ai-staff-drawer__close");
  var messagesEl = wrap.querySelector('[data-ai-mount="messages"]');
  var suggestionsEl = wrap.querySelector('[data-ai-mount="suggestions"]');
  var typingEl = wrap.querySelector('[data-ai-mount="typing"]');
  var form = wrap.querySelector("form");
  var input = wrap.querySelector("#kb-ai-staff-input");
  var sendBtn = wrap.querySelector(".ai-staff-drawer__send");

  var messages = [];
  var sending = false;

  suggestionsEl.innerHTML = STAFF_QUICK_SUGGESTIONS.map(function (q) {
    return (
      '<button type="button" class="ai-suggestion-chip" data-suggestion="' +
      escapeHtml(q) +
      '">' +
      escapeHtml(q) +
      "</button>"
    );
  }).join("");

  function resizeInput() {
    if (!input) return;
    input.style.height = "auto";
    var next = Math.min(input.scrollHeight, INPUT_MAX_HEIGHT_PX);
    input.style.height = next + "px";
    input.style.overflowY = input.scrollHeight > INPUT_MAX_HEIGHT_PX ? "auto" : "hidden";
  }

  function resetInputField() {
    if (!input) return;
    input.value = "";
    resizeInput();
  }

  function setComposerBusy(busy) {
    if (input) input.disabled = busy;
    if (sendBtn) sendBtn.disabled = busy;
  }

  function setTypingVisible(show) {
    if (!typingEl) return;
    typingEl.classList.toggle("is-active", !!show);
    typingEl.hidden = !show;
    typingEl.setAttribute("aria-hidden", show ? "false" : "true");
  }

  function renderMessages() {
    if (!messages.length) {
      messagesEl.innerHTML =
        '<p class="ai-staff-drawer__empty">Hai! Tanya tentang bayaran balik, stok, promosi, atau clock in.</p>';
      return;
    }
    messagesEl.innerHTML = messages
      .map(function (m) {
        var cls = m.role === "user" ? "ai-bubble ai-bubble--user" : "ai-bubble ai-bubble--ai";
        return (
          '<article class="' +
          cls +
          '"><div class="ai-bubble__inner">' +
          renderMarkdownLite(m.text) +
          '</div><time class="ai-bubble__time">' +
          escapeHtml(formatDateTime(m.at)) +
          "</time></article>"
        );
      })
      .join("");
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function openDrawer() {
    drawer.setAttribute("aria-hidden", "false");
    fab.setAttribute("aria-expanded", "true");
    backdrop.setAttribute("aria-hidden", "false");
    wrap.classList.add("is-open");
    setTypingVisible(false);
    window.requestAnimationFrame(function () {
      input.focus();
    });
    renderMessages();
  }

  function closeDrawer() {
    drawer.setAttribute("aria-hidden", "true");
    fab.setAttribute("aria-expanded", "false");
    backdrop.setAttribute("aria-hidden", "true");
    wrap.classList.remove("is-open");
    setTypingVisible(false);
  }

  function send(text) {
    var trimmed = String(text || "").trim();
    if (!trimmed || sending) return;
    if (!wrap.classList.contains("is-open")) openDrawer();
    messages.push({ role: "user", text: trimmed, at: new Date().toISOString() });
    renderMessages();
    sending = true;
    setTypingVisible(true);
    setComposerBusy(true);

    var history = messages.slice(0, -1).map(function (m) {
      return { role: m.role, text: m.text };
    });

    var session = loadSession();
    var userRole = session.role || "cashier";

    askAI(trimmed, history, null, userRole)
      .then(function (reply) {
        messages.push({
          role: "assistant",
          text: reply,
          at: new Date().toISOString()
        });
      })
      .catch(function (err) {
        console.warn("[staff-chat] askAI", err);
        messages.push({
          role: "assistant",
          text:
            "Maaf, Pembantu AI tidak dapat dihubungi buat masa ini. Sila cuba semula atau rujuk Owner.",
          at: new Date().toISOString()
        });
      })
      .finally(function () {
        setTypingVisible(false);
        setComposerBusy(false);
        sending = false;
        renderMessages();
      });
  }

  fab.addEventListener("click", function () {
    if (wrap.classList.contains("is-open")) closeDrawer();
    else openDrawer();
  });
  closeBtn.addEventListener("click", closeDrawer);
  backdrop.addEventListener("click", closeDrawer);

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && wrap.classList.contains("is-open")) closeDrawer();
  });

  suggestionsEl.addEventListener("click", function (e) {
    var chip = e.target.closest("[data-suggestion]");
    if (!chip) return;
    send(chip.getAttribute("data-suggestion"));
  });

  input.addEventListener("input", resizeInput);
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var v = input.value;
    resetInputField();
    send(v);
  });

  setTypingVisible(false);
  resizeInput();
  renderMessages();
}

/** Alias — kod lama */
export var mountStaffAiChatWidget = mountGlobalAiChatWidget;
