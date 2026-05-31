/**
 * Modal pangkalan pengetahuan — borang ringkas (BM).
 */
import {
  KNOWLEDGE_CATEGORIES,
  KNOWLEDGE_STATUSES,
  CATEGORY_LABELS_MS,
  STATUS_LABELS_MS
} from "../constants.js";
import { escapeHtml } from "../utils.js";

function buildCategoryOptions(selected) {
  return KNOWLEDGE_CATEGORIES.map(function (v) {
    return (
      '<option value="' +
      escapeHtml(v) +
      '"' +
      (v === selected ? " selected" : "") +
      ">" +
      escapeHtml(CATEGORY_LABELS_MS[v] || v) +
      "</option>"
    );
  }).join("");
}

function buildStatusOptions(selected) {
  return KNOWLEDGE_STATUSES.map(function (v) {
    return (
      '<option value="' +
      escapeHtml(v) +
      '"' +
      (v === selected ? " selected" : "") +
      ">" +
      escapeHtml(STATUS_LABELS_MS[v] || v) +
      "</option>"
    );
  }).join("");
}

function mountModalShell(title, bodyHtml, footHtml) {
  var backdrop = document.createElement("div");
  backdrop.className = "ai-modal-backdrop";
  backdrop.setAttribute("role", "presentation");

  var dialog = document.createElement("div");
  dialog.className = "ai-modal ai-modal--kb";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.innerHTML =
    '<div class="ai-modal__head">' +
    '<h2 class="ai-modal__title">' +
    escapeHtml(title) +
    "</h2>" +
    '<button type="button" class="ai-modal__close" aria-label="Tutup"><i class="fa-solid fa-xmark"></i></button>' +
    "</div>" +
    '<div class="ai-modal__body">' +
    bodyHtml +
    "</div>" +
    '<div class="ai-modal__foot">' +
    footHtml +
    "</div>";

  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);

  function close() {
    document.removeEventListener("keydown", onKey);
    if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
  }

  function onKey(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  }
  document.addEventListener("keydown", onKey);

  backdrop.addEventListener("click", function (e) {
    if (e.target === backdrop) close();
  });
  dialog.querySelector(".ai-modal__close").addEventListener("click", close);

  return { backdrop: backdrop, dialog: dialog, close: close };
}

function formFieldsHtml(item, readOnly) {
  var ro = readOnly ? " readonly" : "";
  var dis = readOnly ? " disabled" : "";
  var tags = (item.tags || []).join(", ");
  var cat = item.category || KNOWLEDGE_CATEGORIES[0];
  var st = item.status || "Active";

  return (
    '<p class="ai-modal__intro">Isi tajuk dan jawapan yang jelas. Staf dan AI akan guna maklumat ini apabila ditanya.</p>' +
    '<div class="ai-form-stack">' +
    '<label class="ai-field ai-field--full">' +
    '<span class="ai-field__label">Tajuk / topik</span>' +
    '<span class="ai-field__hint">Soalan atau perkara yang biasa ditanya</span>' +
    '<input class="ai-input" name="title" value="' +
    escapeHtml(item.title || "") +
    '" placeholder="Contoh: Cara proses bayaran balik" required' +
    ro +
    "></label>" +
    '<label class="ai-field">' +
    '<span class="ai-field__label">Kategori</span>' +
    '<select class="ai-select" name="category"' +
    dis +
    ">" +
    buildCategoryOptions(cat) +
    "</select></label>" +
    '<label class="ai-field">' +
    '<span class="ai-field__label">Status</span>' +
    '<select class="ai-select" name="status"' +
    dis +
    ">" +
    buildStatusOptions(st) +
    "</select></label>" +
    '<p class="ai-field__hint ai-field__hint--inline">Aktif = AI boleh gunakan · Draf = simpan dulu · Arkib = tidak dipaparkan</p>' +
    '<label class="ai-field ai-field--full">' +
    '<span class="ai-field__label">Jawapan / maklumat</span>' +
    '<span class="ai-field__hint">Langkah demi langkah jika prosedur. Tulis ringkas dan tepat.</span>' +
    '<textarea class="ai-textarea" name="content" rows="7" placeholder="Contoh:&#10;1) Semak resit asal&#10;2) Minta kelulusan shift lead&#10;3) Proses bayaran balik mengikut polisi"' +
    ro +
    ">" +
    escapeHtml(item.content || "") +
    "</textarea></label>" +
    '<details class="ai-form-advanced"' +
    (readOnly ? "" : "") +
    ">" +
    '<summary class="ai-form-advanced__summary">Pilihan lanjutan (kata kunci)</summary>' +
    '<label class="ai-field ai-field--full">' +
    '<span class="ai-field__label">Kata kunci</span>' +
    '<span class="ai-field__hint">Pisahkan dengan koma — membantu carian</span>' +
    '<input class="ai-input" name="tags" value="' +
    escapeHtml(tags) +
    '" placeholder="refund, tunai, kaunter"' +
    ro +
    "></label></details></div>"
  );
}

export function openKnowledgeFormModal(item, onSave) {
  var isEdit = !!(item && item.id);
  var shell = mountModalShell(
    isEdit ? "Edit maklumat" : "Tambah maklumat",
    formFieldsHtml(item || { status: "Active", category: KNOWLEDGE_CATEGORIES[0] }, false),
    '<button type="button" class="btn btn--ghost ai-modal-cancel">Batal</button>' +
      '<button type="button" class="btn btn--primary ai-modal-save">Simpan</button>'
  );

  shell.dialog.querySelector(".ai-modal-cancel").addEventListener("click", shell.close);
  shell.dialog.querySelector(".ai-modal-save").addEventListener("click", function () {
    var form = shell.dialog;
    var title = String(form.querySelector('[name="title"]').value || "").trim();
    if (!title) {
      window.alert("Sila isi tajuk / topik.");
      return;
    }
    var content = String(form.querySelector('[name="content"]').value || "").trim();
    if (!content) {
      window.alert("Sila isi jawapan / maklumat.");
      return;
    }
    var tagsRaw = String(form.querySelector('[name="tags"]').value || "");
    var tags = tagsRaw
      .split(",")
      .map(function (t) {
        return t.trim();
      })
      .filter(Boolean);
    var payload = {
      id: item && item.id,
      title: title,
      category: form.querySelector('[name="category"]').value,
      tags: tags,
      content: content,
      status: form.querySelector('[name="status"]').value,
      updatedAt: new Date().toISOString()
    };
    onSave(payload);
    shell.close();
  });
}

export function openKnowledgeViewModal(item) {
  var shell = mountModalShell(
    "Lihat maklumat",
    formFieldsHtml(item, true),
    '<button type="button" class="btn btn--primary ai-modal-cancel">Tutup</button>'
  );
  shell.dialog.querySelector(".ai-modal-cancel").addEventListener("click", shell.close);
  var details = shell.dialog.querySelector(".ai-form-advanced");
  if (details) details.open = true;
}

export function confirmDeleteKnowledge(item, onConfirm) {
  var shell = mountModalShell(
    "Padam maklumat?",
    '<p class="ai-modal__lead">Padam <strong>' +
      escapeHtml(item.title) +
      "</strong>? Tindakan ini tidak boleh dibatalkan.</p>",
    '<button type="button" class="btn btn--ghost ai-modal-cancel">Batal</button>' +
      '<button type="button" class="btn btn--danger ai-modal-delete">Padam</button>'
  );
  shell.dialog.querySelector(".ai-modal-cancel").addEventListener("click", shell.close);
  shell.dialog.querySelector(".ai-modal-delete").addEventListener("click", function () {
    onConfirm();
    shell.close();
  });
}
