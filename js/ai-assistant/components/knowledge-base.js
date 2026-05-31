/**
 * Pangkalan pengetahuan — editor teks dengan mod baca sahaja + Edit / Simpan.
 */
import { escapeHtml } from "../utils.js";
import { waitForAuthUser } from "../../pos-firebase-auth-bridge.js";
import {
  fetchOwnerKnowledgeText,
  saveOwnerKnowledgeText
} from "../ai-service.js";
import { parseKnowledgeBody, KB_DEFAULT_BODY } from "../knowledge-format.js";

export function mountKnowledgeBase(root, options) {
  options = options || {};
  var loadError = options.loadError;
  var editing = false;
  var saving = false;
  var lastSavedBody = "";

  root.innerHTML =
    (loadError
      ? '<div class="ai-kb-alert" role="alert"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> ' +
        escapeHtml(loadError) +
        "</div>"
      : "") +
    '<header class="ai-kb-header ai-kb-header--editor">' +
    '<div class="ai-kb-header__text">' +
    "<h2 class=\"ai-kb-header__title\">Pangkalan data</h2>" +
    '<p class="ai-kb-header__desc">Baca maklumat dalam mod paparan. Klik <strong>Edit</strong> untuk ubah, kemudian <strong>Simpan</strong>.</p>' +
    "</div></header>" +
    '<section class="ai-kb-editor-wrap">' +
    '<label class="ai-kb-editor-label" for="ai-kb-editor">Maklumat untuk Pembantu AI</label>' +
    '<textarea id="ai-kb-editor" class="ai-kb-editor ai-kb-editor--readonly" data-ai-editor readonly spellcheck="true" ' +
    'placeholder="## Soalan atau topik&#10;Jawapan penuh di sini…"></textarea>' +
    '<div class="ai-kb-editor-bar">' +
    '<div class="ai-kb-editor-actions">' +
    '<button type="button" class="btn btn--outline" data-ai-action="edit"><i class="fa-solid fa-pen" aria-hidden="true"></i> Edit</button>' +
    '<button type="button" class="btn btn--primary" data-ai-action="save" disabled><i class="fa-solid fa-floppy-disk" aria-hidden="true"></i> Simpan</button>' +
    "</div></div></section>";

  var editor = root.querySelector("[data-ai-editor]");
  var btnEdit = root.querySelector('[data-ai-action="edit"]');
  var btnSave = root.querySelector('[data-ai-action="save"]');

  function notifyItemsChange() {
    if (typeof options.onItemsChange === "function") {
      options.onItemsChange(parseKnowledgeBody(editor.value));
    }
  }

  function setReadOnlyMode(on) {
    editing = !on;
    editor.readOnly = on;
    editor.classList.toggle("ai-kb-editor--readonly", on);
    editor.setAttribute("aria-readonly", on ? "true" : "false");
    btnEdit.disabled = !on || saving;
    btnSave.disabled = on || saving;
  }

  function enterEditMode() {
    if (editing || saving) return;
    setReadOnlyMode(false);
    editor.focus();
  }

  async function saveAndLock() {
    if (!editing || saving) return;
    var body = editor.value;
    var user = await waitForAuthUser();
    if (!user) {
      alert("Sila log masuk semula.");
      return;
    }
    saving = true;
    btnEdit.disabled = true;
    btnSave.disabled = true;
    try {
      await saveOwnerKnowledgeText(body);
      lastSavedBody = body;
      setReadOnlyMode(true);
      notifyItemsChange();
    } catch (err) {
      console.error("[knowledge-base] save", err);
      alert("Gagal simpan. Sila cuba lagi.");
      btnEdit.disabled = false;
      btnSave.disabled = false;
    } finally {
      saving = false;
    }
  }

  btnEdit.addEventListener("click", enterEditMode);
  btnSave.addEventListener("click", saveAndLock);

  setReadOnlyMode(true);

  fetchOwnerKnowledgeText()
    .then(function (row) {
      var body = (row && row.body) || KB_DEFAULT_BODY;
      editor.value = body;
      lastSavedBody = body;
      setReadOnlyMode(true);
      notifyItemsChange();
    })
    .catch(function (err) {
      console.warn("[knowledge-base] load", err);
      editor.value = KB_DEFAULT_BODY;
      lastSavedBody = editor.value;
      setReadOnlyMode(true);
      alert("Gagal memuatkan data.");
    });

  return {
    getItems: function () {
      return parseKnowledgeBody(editor.value);
    },
    getBody: function () {
      return editor.value;
    },
    refresh: function () {
      return fetchOwnerKnowledgeText().then(function (row) {
        editor.value = row.body || KB_DEFAULT_BODY;
        lastSavedBody = editor.value;
        setReadOnlyMode(true);
        notifyItemsChange();
      });
    },
    flushSave: function () {
      if (editing) return saveAndLock();
      return Promise.resolve(true);
    }
  };
}
