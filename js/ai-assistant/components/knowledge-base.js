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
import { t, onLocaleChange, applyI18n } from "../../i18n/locale.js";

export function mountKnowledgeBase(root, options) {
  options = options || {};
  var loadError = options.loadError;
  var editing = false;
  var saving = false;
  var lastSavedBody = "";

  if (loadError) {
    root.innerHTML =
      '<div class="sd-status sd-status--err" role="alert"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> ' +
      escapeHtml(loadError) +
      "</div>";
    return;
  }

  root.innerHTML =
    '<header class="kb-page-header">' +
    '<div class="kb-page-header__row">' +
    '<h1 class="kb-page-title" data-i18n="ai.kb.title">Pangkalan data</h1>' +
    '<div class="bs-settings__header-actions ai-kb-editor-actions">' +
    '<button type="button" class="btn btn--outline" data-ai-action="edit"><i class="fa-solid fa-pen" aria-hidden="true"></i> <span data-i18n="ai.kb.edit">Edit</span></button>' +
    '<button type="button" class="btn btn--primary" data-ai-action="save" disabled><i class="fa-solid fa-floppy-disk" aria-hidden="true"></i> <span data-i18n="ai.kb.save">Simpan</span></button>' +
    "</div></div>" +
    '<p class="kb-page-lead" data-i18n-html="ai.kb.lead">Maklumat rujukan untuk Pembantu AI. Baca dalam mod paparan; klik <strong>Edit</strong> untuk ubah.</p>' +
    "</header>" +
    '<section class="sd-panel bs-kb-editor-panel">' +
    '<label class="sd-field sd-field--full" for="ai-kb-editor">' +
    '<span data-i18n="ai.kb.contentLabel">Kandungan pengetahuan</span>' +
    '<textarea id="ai-kb-editor" class="ai-kb-editor ai-kb-editor--readonly" data-ai-editor readonly spellcheck="true" ' +
    'placeholder="## Soalan atau topik&#10;Jawapan penuh di sini…"></textarea>' +
    "</label></section>";

  var editor = root.querySelector("[data-ai-editor]");
  var btnEdit = root.querySelector('[data-ai-action="edit"]');
  var btnSave = root.querySelector('[data-ai-action="save"]');
  applyI18n(root);
  onLocaleChange(function () {
    applyI18n(root);
  });

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
      alert(t("ai.kb.alertRelogin"));
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
      alert(t("ai.kb.alertSaveFail"));
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
      alert(t("ai.kb.alertLoadFail"));
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
