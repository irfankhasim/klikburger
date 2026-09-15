/**
 * Tetapan pejabat belakang — sunting butiran staf (Firestore `staff`).
 */
import { Timestamp, auth, db, doc, getDoc } from "../firebase/init.js";
import { waitForAuthUser } from "../pos-firebase-auth-bridge.js";
import { isElevatedRole, isOwnerRole } from "../pos-rbac-session.js";
import {
  docToStaff,
  normalizeStaffNameKey,
  staffCanonicalDisplayName,
  dedupeStaffByNameKey,
  isOwnerStaffRecord,
  OWNER_STAFF_DOC_ID
} from "./staff-mappers.js";
import { subscribeStaff, addStaff, persistStaff, removeStaff } from "./staff-repository.js";
import {
  enrollStaffTotp,
  confirmStaffTotpEnrollment,
  resetStaffTotp,
  setStoreLocation,
  clearStoreLocation
} from "./totp-callables.js";
import { renderTotpQrCode } from "../totp-qr.js";
import { notifyInnerHeight } from "./bo-settings-iframe-autosize.js";
import { t as tr, onLocaleChange } from "../i18n/locale.js";

var staffList = [];
var selectedId = "";
var staffUnsub = null;
var pagehideBound = false;

/**
 * Teks yang dibina oleh JS disimpan sebagai keadaan (bukan hanya ditulis ke DOM)
 * supaya ia boleh dibina semula bila bahasa bertukar tanpa memanggil Firestore lagi.
 */
var totpFormView = { kind: "notSetup", enrolled: false, enabled: false };
var storeLocationView = { kind: "loading", loc: null };
var totpModalStaffName = "";

function defaultWeeklyRosterPagi() {
  var out = [];
  for (var day = 0; day <= 6; day++) {
    out.push({ day: day, shift: "pagi" });
  }
  return out;
}

/** Kekalkan syif dari rekod sedia ada; staf baharu dapat jadual lalai semua pagi. */
function shiftPayloadForSave(id) {
  if (id) {
    var ex = staffList.find(function (x) {
      return String(x.id) === String(id);
    });
    if (ex) {
      return {
        defaultShift: String(ex.defaultShift || "pagi"),
        weeklyRoster:
          ex.weeklyRoster && ex.weeklyRoster.length ? ex.weeklyRoster : defaultWeeklyRosterPagi()
      };
    }
  }
  return { defaultShift: "pagi", weeklyRoster: defaultWeeklyRosterPagi() };
}

function $(id) {
  return document.getElementById(id);
}

function pad2(n) {
  return (n < 10 ? "0" : "") + n;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Terjemahan dengan pemegang tempat `{nama}`. */
function trFmt(key, vars) {
  return String(tr(key)).replace(/\{(\w+)\}/g, function (whole, name) {
    return vars && vars[name] != null ? String(vars[name]) : whole;
  });
}

/** Mesej ralat teknikal dari Firebase; kalau tiada, guna perkataan generik. */
function errText(e) {
  return e && e.message ? e.message : tr("settings.common.error");
}

function setStatus(msg, kind) {
  var el = $("bs-status");
  if (!el) return;
  if (!msg) {
    el.textContent = "";
    el.classList.add("sd-status--hidden");
    el.classList.remove("sd-status--ok", "sd-status--err");
    return;
  }
  el.textContent = msg;
  el.classList.remove("sd-status--hidden", "sd-status--ok", "sd-status--err");
  el.classList.add(kind === "err" ? "sd-status--err" : "sd-status--ok");
}

function isOwnerStaffRole(role) {
  return String(role || "").toLowerCase() === "owner";
}

/** Pemilik tidak perlu medan gaji / payroll & tarikh mula dalam tetapan Back Office. */
function applyPayrollFieldsVisibility() {
  var roleEl = $("bs-form-role");
  var wrap = $("bs-payroll-fields");
  if (!roleEl) return;
  var hide = isOwnerStaffRole(roleEl.value);
  if (wrap) {
    wrap.hidden = hide;
    wrap.setAttribute("aria-hidden", hide ? "true" : "false");
  }
  var startedEl = $("bs-form-started");
  if (startedEl) {
    var startedLabel = startedEl.closest("label");
    if (startedLabel) startedLabel.hidden = hide;
  }
}

function renderStaffList() {
  var wrap = $("bs-staff-list");
  if (!wrap) return;
  // Owner urus profil sendiri di tempat lain — tak perlu (dan tak patut) muncul dalam
  // senarai kakitangan yang diurus di sini (2FA, gaji, dsb. tak relevan untuk Owner).
  var visibleStaff = staffList.filter(function (s) {
    return !isOwnerStaffRecord(s);
  });
  if (!visibleStaff.length) {
    wrap.innerHTML = '<p class="sd-footnote">' + tr("settings.list.empty") + "</p>";
    notifyInnerHeight();
    return;
  }
  wrap.innerHTML = visibleStaff
    .map(function (s) {
      var active = String(s.id) === String(selectedId);
      var displayName = staffCanonicalDisplayName(s.name);
      return (
        '<button type="button" class="bs-staff-pick btn btn--outline' +
        (active ? " is-active" : "") +
        '" data-staff-id="' +
        escapeHtml(s.id) +
        '"><span class="bs-staff-pick__name">' +
        escapeHtml(displayName) +
        "</span></button>"
      );
    })
    .join("");
  notifyInnerHeight();
}

function applyOwnerFormMode(s) {
  var ownerMode = !!(s && isOwnerStaffRecord(s));
  var roleEl = $("bs-form-role");
  var statusEl = $("bs-form-status");
  var phoneEl = $("bs-form-phone");
  var startedEl = $("bs-form-started");
  var emailEl = $("bs-form-email");
  var addBtn = $("bs-btn-add-staff");
  var deleteBtn = $("bs-form-delete");
  var ownerNote = $("bs-owner-note");
  if (ownerNote) ownerNote.hidden = !ownerMode;
  if (roleEl) {
    roleEl.disabled = ownerMode;
    if (ownerMode) roleEl.value = "owner";
  }
  if (statusEl) statusEl.disabled = ownerMode;
  if (phoneEl) {
    var phoneLabel = phoneEl.closest("label");
    if (phoneLabel) phoneLabel.hidden = ownerMode;
  }
  if (startedEl) {
    var startedLabel = startedEl.closest("label");
    if (startedLabel) startedLabel.hidden = ownerMode;
  }
  if (emailEl) {
    var emailLabel = emailEl.closest("label");
    if (emailLabel) emailLabel.hidden = ownerMode;
  }
  if (addBtn) addBtn.hidden = ownerMode && !!selectedId;
  if (deleteBtn) deleteBtn.hidden = ownerMode || !selectedId;
  applyPayrollFieldsVisibility();
  var totpBlock = $("bs-totp-block");
  if (totpBlock) totpBlock.hidden = !selectedId;
}

async function fillFormForStaff(id) {
  selectedId = id ? String(id) : "";
  $("bs-form-id").value = selectedId;
  $("bs-form-delete").hidden = !selectedId;

  if (!selectedId) {
    $("bs-form-name").value = "";
    $("bs-form-email").value = "";
    $("bs-form-role").value = "cashier";
    $("bs-form-status").value = "active";
    $("bs-form-phone").value = "";
    $("bs-form-started").value = "";
    $("bs-form-paytype").value = "hourly";
    $("bs-form-pay").value = "8";
    applyOwnerFormMode(null);
    renderStaffList();
    return;
  }

  var s = staffList.find(function (x) {
    return String(x.id) === selectedId;
  });
  if (!s) return;

  $("bs-form-name").value = s.name;
  $("bs-form-email").value = s.email || "";
  $("bs-form-role").value = s.role || "cashier";
  $("bs-form-status").value = s.employmentStatus || "active";
  $("bs-form-phone").value = s.phone || "";
  if (s.startedAtDate) {
    var d = s.startedAtDate;
    $("bs-form-started").value =
      d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  } else {
    $("bs-form-started").value = "";
  }
  $("bs-form-paytype").value = s.payType || "hourly";
  $("bs-form-pay").value = String(s.payAmount != null ? s.payAmount : "");
  applyOwnerFormMode(s);
  await refreshTotpStatusForForm(id);
  renderStaffList();
}

/** Tulis semula chip On/Off + butang Delete/Setup 2FA dari `totpFormView`. */
function renderTotpFormStatus() {
  var chip = $("bs-totp-status-chip");
  var setupBtn = $("bs-btn-setup-totp");
  var deleteBtn = $("bs-btn-delete-totp");
  var v = totpFormView;
  var on = v.kind === "state" && v.enabled;
  var configured = v.kind === "state" && (v.enrolled || v.enabled);
  if (chip) {
    if (v.kind === "loading") {
      chip.className = "bs-totp-chip bs-totp-chip--muted";
      chip.textContent = tr("settings.common.loadingShort");
    } else if (v.kind === "error") {
      chip.className = "bs-totp-chip bs-totp-chip--off";
      chip.textContent = tr("settings.totp.loadError");
    } else {
      chip.className = "bs-totp-chip " + (on ? "bs-totp-chip--on" : "bs-totp-chip--off");
      chip.textContent = on ? tr("settings.totp.statusOn") : tr("settings.totp.statusOff");
    }
  }
  if (setupBtn) {
    setupBtn.textContent = tr("settings.totp.setupBtn");
  }
  if (deleteBtn) {
    deleteBtn.disabled = !configured;
  }
}

async function refreshTotpStatusForForm(id) {
  var chip = $("bs-totp-status-chip");
  if (!chip) return;
  totpFormView = { kind: "loading", enrolled: false, enabled: false };
  renderTotpFormStatus();
  try {
    var snap = await getDoc(doc(db, "staff_totp_status", id));
    var data = snap.exists() ? snap.data() : {};
    totpFormView = {
      kind: "state",
      enrolled: !!data.enrolled,
      enabled: !!data.enabled
    };
    renderTotpFormStatus();
  } catch (e) {
    console.error(e);
    totpFormView = { kind: "error", enrolled: false, enabled: false };
    renderTotpFormStatus();
  }
}

function startedTimestampFromInput() {
  var v = $("bs-form-started").value;
  if (!v) return null;
  var d = new Date(v + "T12:00:00");
  if (isNaN(d.getTime())) return null;
  return Timestamp.fromDate(d);
}

async function saveStaffForm() {
  var id = $("bs-form-id").value.trim();
  var name = $("bs-form-name").value.trim();
  var emailRaw = ($("bs-form-email") && $("bs-form-email").value.trim()) || "";
  var editingOwner = id && (id === OWNER_STAFF_DOC_ID || isOwnerStaffRecord(staffList.find(function (x) { return String(x.id) === id; })));

  if (editingOwner && !isElevatedRole()) {
    setStatus(tr("settings.msg.ownerOnly"), "err");
    return;
  }

  if (!name) {
    setStatus(tr("settings.msg.nameRequired"), "err");
    return;
  }

  var nameKey = normalizeStaffNameKey(name);
  var dupOther = staffList.some(function (s) {
    return normalizeStaffNameKey(s.name) === nameKey && String(s.id) !== String(id);
  });
  if (dupOther) {
    setStatus(tr("settings.msg.nameDuplicate"), "err");
    return;
  }
  if (!id && staffList.length >= 40) {
    setStatus(tr("settings.msg.limitReached"), "err");
    return;
  }
  if (emailRaw && emailRaw.indexOf("@") === -1) {
    setStatus(tr("settings.msg.emailInvalid"), "err");
    return;
  }
  var sh = shiftPayloadForSave(id);
  var roleVal = editingOwner ? "owner" : $("bs-form-role").value;
  var payload = {
    name: staffCanonicalDisplayName(name),
    staffName: staffCanonicalDisplayName(name),
    role: roleVal,
    defaultShift: sh.defaultShift,
    weeklyRoster: sh.weeklyRoster
  };
  if (editingOwner) {
    payload.isOwner = true;
    payload.staffId = OWNER_STAFF_DOC_ID;
    payload.payType = "salary";
    payload.payAmount = 0;
    payload.salary = 0;
    payload.employmentStatus = "active";
  } else {
    payload.email = emailRaw;
    payload.employmentStatus = $("bs-form-status").value;
    payload.phone = $("bs-form-phone").value.trim();
    if (!isOwnerStaffRole(roleVal)) {
      payload.payType = $("bs-form-paytype").value;
      payload.payAmount = parseFloat($("bs-form-pay").value) || 0;
    }
    var st = startedTimestampFromInput();
    if (st) payload.startedAt = st;
  }

  try {
    if (id) {
      await persistStaff(id, payload);
      setStatus(tr("settings.msg.staffUpdated"), "ok");
      selectedId = id;
    } else {
      var ref = await addStaff(payload);
      selectedId = ref.id;
      $("bs-form-id").value = ref.id;
      $("bs-form-delete").hidden = false;
      setStatus(tr("settings.msg.staffAdded"), "ok");
      renderStaffList();
    }
  } catch (e) {
    console.error(e);
    setStatus(e.message || String(e), "err");
  }
}

async function deleteStaffForm() {
  var id = $("bs-form-id").value.trim();
  if (!id) return;
  if (id === OWNER_STAFF_DOC_ID) {
    setStatus(tr("settings.msg.ownerUndeletable"), "err");
    return;
  }
  if (!confirm(tr("settings.msg.confirmDelete"))) return;
  try {
    await removeStaff(id);
    setStatus(tr("settings.msg.deleted"), "ok");
    selectedId = "";
    fillFormForStaff("");
  } catch (e) {
    console.error(e);
    setStatus(e.message || String(e), "err");
  }
}

function teardown() {
  if (typeof staffUnsub === "function") {
    try {
      staffUnsub();
    } catch (e) {}
    staffUnsub = null;
  }
}

function bindPagehide() {
  if (pagehideBound) return;
  pagehideBound = true;
  window.addEventListener("pagehide", teardown);
}

function wireEvents() {
  $("bs-btn-add-staff").addEventListener("click", function () {
    selectedId = "";
    fillFormForStaff("");
    $("bs-form-name").focus();
  });
  $("bs-form-save").addEventListener("click", async function () {
    var btn = $("bs-form-save");
    setBtnLoading(btn, true);
    try {
      await saveStaffForm();
    } finally {
      setBtnLoading(btn, false);
    }
  });
  $("bs-form-delete").addEventListener("click", async function () {
    var btn = $("bs-form-delete");
    setBtnLoading(btn, true);
    try {
      await deleteStaffForm();
    } finally {
      setBtnLoading(btn, false);
    }
  });
  $("bs-form-role").addEventListener("change", applyPayrollFieldsVisibility);
  $("bs-staff-list").addEventListener("click", function (e) {
    var btn = e.target.closest(".bs-staff-pick");
    if (!btn) return;
    var sid = btn.getAttribute("data-staff-id");
    if (sid) fillFormForStaff(sid);
  });
  wireTotpEvents();
  wireStoreLocationEvents();
}

function logSecurityAudit(type, meta) {
  import("../pos-firestore-hub.js")
    .then(function (hub) {
      return hub.appendPosAudit({
        type: type,
        message: type,
        userId: (auth.currentUser && auth.currentUser.uid) || "",
        role: "OWNER",
        meta: meta || {}
      });
    })
    .catch(function () {});
}

function getCurrentCoordsForOwner() {
  return new Promise(function (resolve, reject) {
    if (!navigator.geolocation) {
      reject(new Error(tr("settings.store.noGps")));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      function () {
        reject(new Error(tr("settings.store.noPermission")));
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  });
}

async function refreshStoreLocationPanel() {
  var panel = $("bs-store-location-panel");
  if (!panel) return;
  if (!isOwnerRole()) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  var statusEl = $("bs-store-location-status");
  var radiusInput = $("bs-store-radius");
  if (!statusEl) return;
  storeLocationView = { kind: "loading", loc: null };
  renderStoreLocationStatus();
  try {
    var snap = await getDoc(doc(db, "pos_meta", "store_location"));
    if (snap.exists()) {
      var d = snap.data();
      storeLocationView = { kind: "set", loc: d };
      renderStoreLocationStatus();
      if (radiusInput && d.radiusMeters) radiusInput.value = d.radiusMeters;
    } else {
      storeLocationView = { kind: "unset", loc: null };
      renderStoreLocationStatus();
    }
  } catch (e) {
    console.error(e);
    storeLocationView = { kind: "error", loc: null };
    renderStoreLocationStatus();
  }
}

/** Tulis semula status lokasi kedai dari `storeLocationView` (dipakai juga bila bahasa bertukar). */
function renderStoreLocationStatus() {
  var statusEl = $("bs-store-location-status");
  var clearBtn = $("bs-btn-clear-store-location");
  if (!statusEl) return;
  var v = storeLocationView;
  if (v.kind === "set" && v.loc) {
    statusEl.textContent = trFmt("settings.store.statusSet", {
      radius: v.loc.radiusMeters,
      lat: v.loc.lat.toFixed(5),
      lng: v.loc.lng.toFixed(5)
    });
    if (clearBtn) clearBtn.hidden = false;
  } else if (v.kind === "unset") {
    statusEl.textContent = tr("settings.store.statusUnset");
    if (clearBtn) clearBtn.hidden = true;
  } else if (v.kind === "error") {
    statusEl.textContent = tr("settings.store.statusError");
  } else {
    statusEl.textContent = tr("settings.common.loadingShort");
  }
}

/** Kemaskini panel lokasi kedai terus dari keputusan yang dah diketahui — elak getDoc berlebihan. */
function applyStoreLocationOptimistic(loc) {
  storeLocationView = loc ? { kind: "set", loc: loc } : { kind: "unset", loc: null };
  renderStoreLocationStatus();
}

function wireStoreLocationEvents() {
  var setBtn = $("bs-btn-set-store-location");
  if (setBtn) {
    setBtn.addEventListener("click", async function () {
      setBtnLoading(setBtn, true);
      try {
        var coords = await getCurrentCoordsForOwner();
        var radiusInput = $("bs-store-radius");
        var radius = radiusInput ? parseFloat(radiusInput.value) || 150 : 150;
        await setStoreLocation(coords.lat, coords.lng, radius);
        setStatus(tr("settings.store.msgSet"), "ok");
        applyStoreLocationOptimistic({ lat: coords.lat, lng: coords.lng, radiusMeters: radius });
        logSecurityAudit("store_location_set", { lat: coords.lat, lng: coords.lng, radiusMeters: radius });
      } catch (e) {
        console.error(e);
        setStatus(trFmt("settings.store.msgSetFailed", { error: errText(e) }), "err");
      } finally {
        setBtnLoading(setBtn, false);
      }
    });
  }

  var clearBtn = $("bs-btn-clear-store-location");
  if (clearBtn) {
    clearBtn.addEventListener("click", async function () {
      setBtnLoading(clearBtn, true);
      try {
        await clearStoreLocation();
        setStatus(tr("settings.store.msgCleared"), "ok");
        applyStoreLocationOptimistic(null);
        logSecurityAudit("store_location_cleared", {});
      } catch (e) {
        console.error(e);
        setStatus(trFmt("settings.store.msgClearFailed", { error: errText(e) }), "err");
      } finally {
        setBtnLoading(clearBtn, false);
      }
    });
  }
}

/** Tunjuk/sembunyi spinner dalam butang (elak "tak tahu proses jalan atau tidak"). */
function setBtnLoading(btn, loading) {
  if (!btn) return;
  btn.disabled = loading;
  btn.classList.toggle("btn--loading", loading);
}

function totpStatusText(msg, kind) {
  var el = $("bs-totp-modal-status");
  if (!el) return;
  if (!msg) {
    el.hidden = true;
    el.textContent = "";
    el.className = "bs-totp-modal-status";
    return;
  }
  el.hidden = false;
  el.textContent = msg;
  el.className = "bs-totp-modal-status" + (kind === "error" ? " bs-totp-modal-status--error" : kind === "ok" ? " bs-totp-modal-status--ok" : "");
}

/**
 * Buka modal SERTA-MERTA (sebelum Cloud Function siap) supaya user nampak sesuatu
 * berlaku dengan segera — QR dipaparkan dengan skeleton loading dahulu, ditukar
 * bila enrollStaffTotp/enrollOwnerTotp resolve. Elak "tekan butang, tak nampak apa-apa".
 */
function applyTotpModalCopy(staffName) {
  var name = staffName || tr("settings.totp.staffFallback");
  var titleEl = $("bs-totp-modal-title");
  var leadEl = $("bs-totp-modal-lead");
  if (titleEl) titleEl.textContent = trFmt("settings.totp.modalTitle", { name: name });
  if (leadEl) leadEl.textContent = trFmt("settings.totp.modalLead", { name: name });
}

function openTotpModal(staffName) {
  totpModalStaffName = staffName || "";
  applyTotpModalCopy(totpModalStaffName);
  var qr = $("bs-totp-qr");
  if (qr) qr.innerHTML = '<div class="bs-totp-qr--loading">' + escapeHtml(tr("settings.totp.generatingQr")) + "</div>";
  var secretEl = $("bs-totp-secret-text");
  if (secretEl) secretEl.textContent = "…";
  var codeInput = $("bs-totp-confirm-code");
  if (codeInput) {
    codeInput.value = "";
    codeInput.disabled = true;
  }
  var confirmBtn = $("bs-totp-modal-confirm");
  if (confirmBtn) confirmBtn.disabled = true;
  totpStatusText("", null);

  var bd = $("bs-totp-modal-backdrop");
  if (bd) {
    bd.hidden = false;
    bd.setAttribute("aria-hidden", "false");
    // rAF: pastikan browser render state "hidden dibuang" dulu sebelum tambah kelas
    // transisi — kalau tak, opacity terus 1 tanpa animasi fade-in.
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        bd.classList.add("is-open");
      });
    });
  }
}

function fillTotpModalFailed(msg) {
  var qr = $("bs-totp-qr");
  if (qr) {
    qr.innerHTML = '<div class="bs-totp-qr--error">' + escapeHtml(msg || tr("settings.totp.generateFailedShort")) + "</div>";
  }
  var secretEl = $("bs-totp-secret-text");
  if (secretEl) secretEl.textContent = "—";
  var codeInput = $("bs-totp-confirm-code");
  if (codeInput) codeInput.disabled = true;
  var confirmBtn = $("bs-totp-modal-confirm");
  if (confirmBtn) confirmBtn.disabled = true;
  totpStatusText(msg || tr("settings.totp.generateFailedShort"), "error");
}

/** Tukar modal dari skeleton loading ke QR sebenar bila Cloud Function dah siap. */
function fillTotpModalReady(otpauthUrl, secret) {
  var qr = $("bs-totp-qr");
  if (qr) renderTotpQrCode(qr, otpauthUrl);
  var secretEl = $("bs-totp-secret-text");
  if (secretEl) secretEl.textContent = secret;
  var codeInput = $("bs-totp-confirm-code");
  if (codeInput) {
    codeInput.disabled = false;
    codeInput.focus();
  }
  var confirmBtn = $("bs-totp-modal-confirm");
  if (confirmBtn) confirmBtn.disabled = false;
}

function closeTotpModal() {
  var bd = $("bs-totp-modal-backdrop");
  if (bd) {
    bd.classList.remove("is-open");
    bd.setAttribute("aria-hidden", "true");
    setTimeout(function () {
      bd.hidden = true;
    }, 160);
  }
  var qr = $("bs-totp-qr");
  if (qr) qr.innerHTML = "";
  var secretEl = $("bs-totp-secret-text");
  if (secretEl) secretEl.textContent = "";
  var codeInput = $("bs-totp-confirm-code");
  if (codeInput) codeInput.value = "";
  totpStatusText("", null);
}

function totpDeleteStatusText(msg, kind) {
  var el = $("bs-totp-delete-status");
  if (!el) return;
  if (!msg) {
    el.hidden = true;
    el.textContent = "";
    el.className = "bs-totp-modal-status";
    return;
  }
  el.hidden = false;
  el.textContent = msg;
  el.className =
    "bs-totp-modal-status" +
    (kind === "error" ? " bs-totp-modal-status--error" : kind === "ok" ? " bs-totp-modal-status--ok" : "");
}

function applyDeleteModalCopy() {
  var staffRec = staffList.find(function (x) {
    return String(x.id) === selectedId;
  });
  var name = staffRec && staffRec.name ? staffRec.name : tr("settings.totp.staffFallback");
  var leadEl = $("bs-totp-delete-lead");
  if (leadEl) leadEl.textContent = trFmt("settings.totp.deleteLead", { name: name });
}

function openTotpDeleteModal() {
  applyDeleteModalCopy();
  totpDeleteStatusText("", null);
  var bd = $("bs-totp-delete-backdrop");
  if (!bd) return;
  bd.hidden = false;
  bd.setAttribute("aria-hidden", "false");
  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      bd.classList.add("is-open");
    });
  });
}

function closeTotpDeleteModal() {
  var bd = $("bs-totp-delete-backdrop");
  if (!bd) return;
  bd.classList.remove("is-open");
  bd.setAttribute("aria-hidden", "true");
  setTimeout(function () {
    bd.hidden = true;
  }, 160);
  totpDeleteStatusText("", null);
}

/** Kemaskini chip status 2FA staf terus dari keputusan Cloud Function yang dah diketahui — elak getDoc berlebihan. */
function applyTotpStatusOptimistic(enrolled, enabled) {
  totpFormView = { kind: "state", enrolled: enrolled, enabled: enabled };
  renderTotpFormStatus();
}

function wireTotpEvents() {
  var setupBtn = $("bs-btn-setup-totp");
  if (setupBtn) {
    setupBtn.addEventListener("click", async function () {
      var id = selectedId;
      if (!id) {
        setStatus(tr("settings.totp.needStaff"), "err");
        return;
      }
      var staffRec = staffList.find(function (x) {
        return String(x.id) === id;
      });
      // Buka modal SERTA-MERTA dengan skeleton — jangan tunggu network dulu.
      openTotpModal(staffRec ? staffRec.name : "");
      setBtnLoading(setupBtn, true);
      try {
        var res = await enrollStaffTotp(id);
        if (!res || !res.otpauthUrl || !res.secret) {
          fillTotpModalFailed(tr("settings.totp.generateFailedShort"));
          return;
        }
        fillTotpModalReady(res.otpauthUrl, res.secret);
      } catch (e) {
        console.error(e);
        fillTotpModalFailed(trFmt("settings.totp.generateFailed", { error: errText(e) }));
      } finally {
        setBtnLoading(setupBtn, false);
      }
    });
  }

  var deleteBtn = $("bs-btn-delete-totp");
  if (deleteBtn) {
    deleteBtn.addEventListener("click", function () {
      if (totpFormView.kind !== "state" || !(totpFormView.enrolled || totpFormView.enabled)) return;
      if (!selectedId) {
        setStatus(tr("settings.totp.needStaff"), "err");
        return;
      }
      openTotpDeleteModal();
    });
  }

  var closeBtn = $("bs-totp-modal-close");
  if (closeBtn) closeBtn.addEventListener("click", closeTotpModal);

  var confirmBtn = $("bs-totp-modal-confirm");
  if (confirmBtn) {
    confirmBtn.addEventListener("click", async function () {
      var id = selectedId;
      var codeInput = $("bs-totp-confirm-code");
      var code = codeInput ? codeInput.value.trim() : "";
      if (!/^\d{6}$/.test(code)) {
        totpStatusText(tr("settings.totp.needSix"), "error");
        return;
      }
      setBtnLoading(confirmBtn, true);
      try {
        await confirmStaffTotpEnrollment(id, code);
        totpStatusText(tr("settings.totp.confirmed"), "ok");
        applyTotpStatusOptimistic(true, true);
        logSecurityAudit("staff_totp_enrolled", { staffId: id });
        setTimeout(closeTotpModal, 700);
      } catch (e) {
        console.error(e);
        totpStatusText(e && e.message ? e.message : tr("settings.totp.codeMismatch"), "error");
      } finally {
        setBtnLoading(confirmBtn, false);
      }
    });
  }

  var backdrop = $("bs-totp-modal-backdrop");
  if (backdrop) {
    backdrop.addEventListener("click", function (e) {
      if (e.target === backdrop) closeTotpModal();
    });
  }

  var deleteClose = $("bs-totp-delete-close");
  if (deleteClose) deleteClose.addEventListener("click", closeTotpDeleteModal);
  var deleteCancel = $("bs-totp-delete-cancel");
  if (deleteCancel) deleteCancel.addEventListener("click", closeTotpDeleteModal);
  var deleteBd = $("bs-totp-delete-backdrop");
  if (deleteBd) {
    deleteBd.addEventListener("click", function (e) {
      if (e.target === deleteBd) closeTotpDeleteModal();
    });
  }
  var deleteConfirm = $("bs-totp-delete-confirm");
  if (deleteConfirm) {
    deleteConfirm.addEventListener("click", async function () {
      var id = selectedId;
      if (!id) {
        totpDeleteStatusText(tr("settings.totp.needStaff"), "error");
        return;
      }
      setBtnLoading(deleteConfirm, true);
      try {
        var res = await resetStaffTotp(id);
        if (res && res.ok === false) {
          throw new Error(res.error || tr("settings.common.error"));
        }
        applyTotpStatusOptimistic(false, false);
        logSecurityAudit("staff_totp_deleted", { staffId: id });
        setStatus(tr("settings.totp.deletedOk"), "ok");
        closeTotpDeleteModal();
      } catch (e) {
        console.error(e);
        totpDeleteStatusText(trFmt("settings.totp.deleteFailed", { error: errText(e) }), "error");
      } finally {
        setBtnLoading(deleteConfirm, false);
      }
    });
  }
}

async function main() {
  wireEvents();
  bindPagehide();

  try {
    await waitForAuthUser();
    if (auth.currentUser) {
      await auth.currentUser.getIdToken(false);
    }
  } catch (e) {
    console.warn("[bo-settings] auth", e);
  }

  refreshStoreLocationPanel();

  staffUnsub = subscribeStaff(
    function (snap) {
      var rawFiltered = [];
      try {
        rawFiltered = snap.docs.map(function (d) {
          return docToStaff(d);
        });
        staffList = dedupeStaffByNameKey(rawFiltered);
      } catch (e) {
        console.error(e);
        staffList = [];
      }
      renderStaffList();
      if (selectedId) {
        var still = staffList.some(function (x) {
          return String(x.id) === String(selectedId);
        });
        if (still) {
          fillFormForStaff(selectedId);
        } else {
          var ghost = rawFiltered.find(function (x) {
            return String(x.id) === String(selectedId);
          });
          var repl =
            ghost &&
            staffList.find(function (x) {
            return normalizeStaffNameKey(x.name) === normalizeStaffNameKey(ghost.name);
            });
          if (repl) {
            selectedId = String(repl.id);
            fillFormForStaff(selectedId);
          } else {
            selectedId = "";
            fillFormForStaff("");
          }
        }
      }
    },
    function (err) {
      console.error(err);
      staffList = [];
      setStatus(err.message || String(err), "err");
      renderStaffList();
    }
  );

  fillFormForStaff("");
}

onLocaleChange(function () {
  renderStaffList();
  renderTotpFormStatus();
  renderStoreLocationStatus();
  var bd = $("bs-totp-modal-backdrop");
  if (bd && !bd.hidden) applyTotpModalCopy(totpModalStaffName);
  var deleteBd = $("bs-totp-delete-backdrop");
  if (deleteBd && !deleteBd.hidden) applyDeleteModalCopy();
});

main().catch(function (e) {
  console.error(e);
  try {
    setStatus(e.message || String(e), "err");
  } catch (e2) {}
});
