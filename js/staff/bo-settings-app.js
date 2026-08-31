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
  setStaffTotpEnabled,
  setStoreLocation,
  clearStoreLocation
} from "./totp-callables.js";
import { renderTotpQrCode } from "../totp-qr.js";
import { notifyInnerHeight } from "./bo-settings-iframe-autosize.js";

var staffList = [];
var selectedId = "";
var staffUnsub = null;
var pagehideBound = false;

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
    wrap.innerHTML = '<p class="sd-footnote">Tiada rekod staf. Klik <strong>Tambah kakitangan</strong> atau jalankan <code>node scripts/add-owner-staff.js</code>.</p>';
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
  if (totpBlock) totpBlock.hidden = ownerMode || !selectedId;
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

async function refreshTotpStatusForForm(id) {
  var toggle = $("bs-form-totp-enabled");
  var text = $("bs-form-totp-enabled-text");
  var statusText = $("bs-totp-status-text");
  if (!toggle || !statusText) return;
  toggle.checked = false;
  if (text) text.textContent = "Tidak aktif";
  statusText.textContent = "Memuat…";
  try {
    var snap = await getDoc(doc(db, "staff_totp_status", id));
    var data = snap.exists() ? snap.data() : {};
    var enrolled = !!data.enrolled;
    var enabled = !!data.enabled;
    toggle.checked = enabled;
    toggle.disabled = !enrolled;
    if (text) text.textContent = enabled ? "Aktif" : "Tidak aktif";
    statusText.textContent = enrolled
      ? enabled
        ? "2FA disediakan dan aktif — wajib semasa clock in."
        : "2FA disediakan tapi tidak aktif."
      : "Belum disediakan — tekan “Setup / Reset 2FA” dahulu.";
  } catch (e) {
    console.error(e);
    statusText.textContent = "Gagal muat status 2FA.";
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
    setStatus("Hanya pemilik (owner) boleh kemaskini rekod pemilik.", "err");
    return;
  }

  if (!name) {
    setStatus("Isi nama.", "err");
    return;
  }

  var nameKey = normalizeStaffNameKey(name);
  var dupOther = staffList.some(function (s) {
    return normalizeStaffNameKey(s.name) === nameKey && String(s.id) !== String(id);
  });
  if (dupOther) {
    setStatus("Nama ini sudah digunakan oleh rekod lain.", "err");
    return;
  }
  if (!id && staffList.length >= 40) {
    setStatus("Had 40 rekod staf dicapai. Padam rekod tidak digunakan dahulu.", "err");
    return;
  }
  if (emailRaw && emailRaw.indexOf("@") === -1) {
    setStatus("E-mel tidak sah.", "err");
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
      setStatus("Butiran staf dikemas kini.", "ok");
      selectedId = id;
    } else {
      var ref = await addStaff(payload);
      selectedId = ref.id;
      $("bs-form-id").value = ref.id;
      $("bs-form-delete").hidden = false;
      setStatus("Kakitangan ditambah.", "ok");
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
    setStatus("Rekod pemilik tidak boleh dipadam.", "err");
    return;
  }
  if (!confirm("Padam kakitangan ini dari pangkalan data?")) return;
  try {
    await removeStaff(id);
    setStatus("Dipadam.", "ok");
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
      reject(new Error("Peranti/browser ini tidak menyokong GPS."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      function () {
        reject(new Error("Tidak dapat akses lokasi. Benarkan kebenaran GPS dan cuba lagi."));
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
  var clearBtn = $("bs-btn-clear-store-location");
  var radiusInput = $("bs-store-radius");
  if (!statusEl) return;
  statusEl.textContent = "Memuat…";
  try {
    var snap = await getDoc(doc(db, "pos_meta", "store_location"));
    if (snap.exists()) {
      var d = snap.data();
      statusEl.textContent =
        "Lokasi ditetapkan — radius " + d.radiusMeters + "m (" + d.lat.toFixed(5) + ", " + d.lng.toFixed(5) + "). Clock-in disekat di luar kawasan ini.";
      if (clearBtn) clearBtn.hidden = false;
      if (radiusInput && d.radiusMeters) radiusInput.value = d.radiusMeters;
    } else {
      statusEl.textContent = "Belum ditetapkan — clock-in staf tiada sekatan lokasi buat masa ini.";
      if (clearBtn) clearBtn.hidden = true;
    }
  } catch (e) {
    console.error(e);
    statusEl.textContent = "Gagal muat status lokasi kedai.";
  }
}

/** Kemaskini panel lokasi kedai terus dari keputusan yang dah diketahui — elak getDoc berlebihan. */
function applyStoreLocationOptimistic(loc) {
  var statusEl = $("bs-store-location-status");
  var clearBtn = $("bs-btn-clear-store-location");
  if (!statusEl) return;
  if (loc) {
    statusEl.textContent =
      "Lokasi ditetapkan — radius " + loc.radiusMeters + "m (" + loc.lat.toFixed(5) + ", " + loc.lng.toFixed(5) + "). Clock-in disekat di luar kawasan ini.";
    if (clearBtn) clearBtn.hidden = false;
  } else {
    statusEl.textContent = "Belum ditetapkan — clock-in staf tiada sekatan lokasi buat masa ini.";
    if (clearBtn) clearBtn.hidden = true;
  }
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
        setStatus("Lokasi kedai ditetapkan.", "ok");
        applyStoreLocationOptimistic({ lat: coords.lat, lng: coords.lng, radiusMeters: radius });
        logSecurityAudit("store_location_set", { lat: coords.lat, lng: coords.lng, radiusMeters: radius });
      } catch (e) {
        console.error(e);
        setStatus("Gagal tetapkan lokasi: " + (e && e.message ? e.message : "ralat"), "err");
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
        setStatus("Sekatan lokasi dibuang.", "ok");
        applyStoreLocationOptimistic(null);
        logSecurityAudit("store_location_cleared", {});
      } catch (e) {
        console.error(e);
        setStatus("Gagal buang sekatan lokasi: " + (e && e.message ? e.message : "ralat"), "err");
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
function openTotpModal(staffName) {
  var titleEl = $("bs-totp-modal-title");
  var leadEl = $("bs-totp-modal-lead");
  if (titleEl) titleEl.textContent = "Setup 2FA — " + (staffName || "Staf");
  if (leadEl) {
    leadEl.textContent =
      "Imbas kod QR ini dengan app authenticator pada telefon " +
      (staffName ? staffName : "staf ini") +
      ", atau masukkan kod secara manual.";
  }
  var qr = $("bs-totp-qr");
  if (qr) qr.innerHTML = '<div class="bs-totp-qr--loading">Menjana kod QR…</div>';
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

/** Kemaskini togol + teks status 2FA staf terus dari keputusan Cloud Function yang dah diketahui — elak getDoc berlebihan. */
function applyTotpStatusOptimistic(enrolled, enabled) {
  var toggle = $("bs-form-totp-enabled");
  var text = $("bs-form-totp-enabled-text");
  var statusText = $("bs-totp-status-text");
  if (toggle) {
    toggle.checked = enabled;
    toggle.disabled = !enrolled;
  }
  if (text) text.textContent = enabled ? "Aktif" : "Tidak aktif";
  if (statusText) {
    statusText.textContent = enrolled
      ? enabled
        ? "2FA disediakan dan aktif — wajib semasa clock in."
        : "2FA disediakan tapi tidak aktif."
      : "Belum disediakan — tekan “Setup / Reset 2FA” dahulu.";
  }
}

function wireTotpEvents() {
  var toggle = $("bs-form-totp-enabled");
  if (toggle) {
    toggle.addEventListener("change", async function () {
      var id = selectedId;
      if (!id) return;
      var wantEnabled = toggle.checked;
      toggle.disabled = true;
      try {
        await setStaffTotpEnabled(id, wantEnabled);
        applyTotpStatusOptimistic(true, wantEnabled);
        setStatus(wantEnabled ? "2FA diaktifkan untuk staf ini." : "2FA dinyahaktifkan untuk staf ini.", "ok");
        logSecurityAudit(wantEnabled ? "staff_totp_enabled" : "staff_totp_disabled", { staffId: id });
      } catch (e) {
        console.error(e);
        toggle.checked = !wantEnabled;
        toggle.disabled = false;
        setStatus("Gagal kemaskini status 2FA: " + (e && e.message ? e.message : "ralat"), "err");
      }
    });
  }

  var setupBtn = $("bs-btn-setup-totp");
  if (setupBtn) {
    setupBtn.addEventListener("click", async function () {
      var id = selectedId;
      if (!id) {
        setStatus("Pilih nama staf dari senarai di sebelah dahulu sebelum setup 2FA.", "err");
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
        fillTotpModalReady(res.otpauthUrl, res.secret);
      } catch (e) {
        console.error(e);
        totpStatusText("Gagal jana 2FA: " + (e && e.message ? e.message : "ralat"), "error");
      } finally {
        setBtnLoading(setupBtn, false);
      }
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
        totpStatusText("Masukkan kod 6 digit.", "error");
        return;
      }
      setBtnLoading(confirmBtn, true);
      try {
        await confirmStaffTotpEnrollment(id, code);
        totpStatusText("2FA disahkan & diaktifkan.", "ok");
        applyTotpStatusOptimistic(true, true);
        logSecurityAudit("staff_totp_enrolled", { staffId: id });
        setTimeout(closeTotpModal, 700);
      } catch (e) {
        console.error(e);
        totpStatusText(e && e.message ? e.message : "Kod tidak sepadan.", "error");
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

main().catch(function (e) {
  console.error(e);
  try {
    setStatus(e.message || String(e), "err");
  } catch (e2) {}
});
