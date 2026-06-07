/**
 * Owner AI Chat — sidebar history + main window (OpenRouter).
 */
import { escapeHtml, formatDateTime } from "../utils.js";
import { createEmptyConversation } from "../mock-data.js";
import { askAI } from "../ai-service.js";

function renderMarkdownLite(text) {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br>");
}

export function mountOwnerChat(root, initialConversations, knowledgeGetter) {
  var conversations = initialConversations.slice();
  var activeId = conversations[0] ? conversations[0].id : null;
  var sending = false;

  root.innerHTML =
    '<div class="ai-chat-layout">' +
    '<aside class="ai-chat-sidebar" aria-label="Sejarah perbualan">' +
    '<div class="ai-chat-sidebar__head">' +
    "<h3 class=\"ai-chat-sidebar__title\">Sejarah</h3>" +
    '<button type="button" class="btn btn--primary btn--sm ai-chat-new"><i class="fa-solid fa-plus" aria-hidden="true"></i> Sembang baharu</button>' +
    "</div>" +
    '<ul class="ai-chat-history" data-ai-mount="history"></ul>' +
    "</aside>" +
    '<section class="ai-chat-main">' +
    '<div class="ai-chat-messages" data-ai-mount="messages" aria-live="polite"></div>' +
    '<div class="ai-chat-typing" data-ai-mount="typing" hidden><span></span><span></span><span></span></div>' +
    '<form class="ai-chat-composer" data-ai-form="owner">' +
    '<label class="sr-only" for="ai-owner-input">Mesej</label>' +
    '<textarea id="ai-owner-input" class="ai-chat-input" rows="2" placeholder="Tanya apa sahaja tentang pangkalan pengetahuan…"></textarea>' +
    '<div class="ai-chat-composer__actions">' +
    '<button type="button" class="btn btn--ghost" data-ai-action="clear">Kosongkan</button>' +
    '<button type="submit" class="btn btn--primary" aria-label="Hantar"><i class="fa-solid fa-paper-plane" aria-hidden="true"></i></button>' +
    "</div></form></section></div>";

  var historyEl = root.querySelector('[data-ai-mount="history"]');
  var messagesEl = root.querySelector('[data-ai-mount="messages"]');
  var typingEl = root.querySelector('[data-ai-mount="typing"]');
  var form = root.querySelector("[data-ai-form='owner']");
  var input = root.querySelector("#ai-owner-input");

  function setTypingVisible(show) {
    if (!typingEl) return;
    typingEl.classList.toggle("is-active", !!show);
    typingEl.hidden = !show;
    typingEl.setAttribute("aria-hidden", show ? "false" : "true");
  }

  function getActive() {
    return conversations.find(function (c) {
      return c.id === activeId;
    });
  }

  function renderHistory() {
    historyEl.innerHTML = conversations
      .map(function (c) {
        return (
          '<li><button type="button" class="ai-chat-history__item' +
          (c.id === activeId ? " is-active" : "") +
          '" data-conv-id="' +
          escapeHtml(c.id) +
          '"><span class="ai-chat-history__title">' +
          escapeHtml(c.title) +
          '</span><span class="ai-chat-history__meta">' +
          escapeHtml(formatDateTime(c.updatedAt)) +
          "</span></button></li>"
        );
      })
      .join("");
  }

  function renderMessages() {
    var conv = getActive();
    if (!conv || !conv.messages.length) {
      messagesEl.innerHTML =
        '<div class="ai-chat-empty"><i class="fa-solid fa-robot" aria-hidden="true"></i><p>Mulakan perbualan tentang pangkalan pengetahuan anda.</p></div>';
      return;
    }
    messagesEl.innerHTML = conv.messages
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

  function pushMessage(role, text) {
    var conv = getActive();
    if (!conv) return;
    var msg = { role: role, text: text, at: new Date().toISOString() };
    conv.messages.push(msg);
    conv.updatedAt = msg.at;
    if (role === "user" && conv.title === "Sembang baharu") {
      conv.title = text.slice(0, 42) + (text.length > 42 ? "…" : "");
    }
    conversations.sort(function (a, b) {
      return String(b.updatedAt).localeCompare(String(a.updatedAt));
    });
    renderHistory();
    renderMessages();
  }

  function sendUserMessage(text) {
    var trimmed = String(text || "").trim();
    if (!trimmed || sending) return;
    pushMessage("user", trimmed);

    var conv = getActive();
    var history = conv
      ? conv.messages.slice(0, -1).map(function (m) {
          return { role: m.role, text: m.text };
        })
      : [];
    var kbItems = knowledgeGetter ? knowledgeGetter() : [];

    sending = true;
    setTypingVisible(true);
    input.disabled = true;

    askAI(trimmed, history, kbItems, "owner")
      .then(function (reply) {
        pushMessage("assistant", reply);
      })
      .catch(function (err) {
        console.warn("[owner-chat] askAI", err);
        pushMessage(
          "assistant",
          "Maaf, Pembantu AI tidak dapat dihubungi buat masa ini. Sila cuba semula."
        );
      })
      .finally(function () {
        setTypingVisible(false);
        input.disabled = false;
        sending = false;
        input.focus();
      });
  }

  root.querySelector(".ai-chat-new").addEventListener("click", function () {
    var c = createEmptyConversation();
    conversations.unshift(c);
    activeId = c.id;
    renderHistory();
    renderMessages();
    input.focus();
  });

  historyEl.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-conv-id]");
    if (!btn) return;
    activeId = btn.getAttribute("data-conv-id");
    renderHistory();
    renderMessages();
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var val = input.value;
    input.value = "";
    sendUserMessage(val);
  });

  root.querySelector('[data-ai-action="clear"]').addEventListener("click", function () {
    var conv = getActive();
    if (!conv) return;
    if (!conv.messages.length) return;
    if (!window.confirm("Kosongkan mesej dalam sembang ini?")) return;
    conv.messages = [];
    renderMessages();
  });

  if (!activeId) {
    var fresh = createEmptyConversation();
    conversations.unshift(fresh);
    activeId = fresh.id;
  }
  setTypingVisible(false);
  renderHistory();
  renderMessages();
}
