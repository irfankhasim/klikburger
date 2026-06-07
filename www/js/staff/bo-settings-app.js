/**
 * Tetapan pejabat belakang — sunting butiran staf (Firestore `staff`).
 */
import { Timestamp, auth, db, doc, getDoc, setDoc, serverTimestamp } from "../firebase/init.js";
import { waitForAuthUser } from "../pos-firebase-auth-bridge.js";
import { isElevatedRole } from "../pos-rbac-session.js";
import {
  docToStaff,
  normalizeStaffNameKey,
  staffCanonicalDisplayName,
  dedupeStaffByNameKey,
  isOwnerStaffRecord,
  OWNER_STAFF_DOC_ID,
  STAFF_ROLES_MS
} from "./staff-mappers.js";
import { subscribeStaff, addStaff, persistStaff, removeStaff, staffPinExists } from "./staff-repository.js";

var staffList = [];
var selectedId = "";
var staffUnsub = null;
var pagehideBound = false;
var staffPinStatus = Object.create(null);

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

/** Pemilik tidak perlu medan gaji / payroll dalam tetapan Back Office. */
function applyPayrollFieldsVisibility() {
  var roleEl = $("bs-form-role");
  var wrap = $("bs-payroll-fields");
  if (!roleEl || !wrap) return;
  var hide = isOwnerStaffRole(roleEl.value);
  wrap.hidden = hide;
  wrap.setAttribute("aria-hidden", hide ? "true" : "false");
}

function pinStatusLabel(staffId) {
  var has = staffPinStatus[String(staffId)];
  if (has === true) return "PIN: ada";
  if (has === false) return "PIN: tiada";
  return "PIN: …";
}

async function refreshStaffPinStatusCache(rows) {
  var next = Object.create(null);
  await Promise.all(
    (rows || []).map(async function (s) {
      try {
        next[String(s.id)] = await staffPinExists(s.id);
      } catch (e) {
        next[String(s.id)] = false;
      }
    })
  );
  staffPinStatus = next;
  renderStaffList();
}

function renderStaffList() {
  var wrap = $("bs-staff-list");
  if (!wrap) return;
  if (!staffList.length) {
    wrap.innerHTML = '<p class="sd-footnote">Tiada rekod staf. Klik <strong>Tambah kakitangan</strong> atau jalankan <code>node scripts/add-owner-staff.js</code>.</p>';
    return;
  }
  wrap.innerHTML = staffList
    .map(function (s) {
      var active = String(s.id) === String(selectedId);
      var displayName = staffCanonicalDisplayName(s.name);
      var owner = isOwnerStaffRecord(s);
      var roleBadge = owner
        ? '<span class="kb-badge kb-badge--owner">Owner</span>'
        : '<span class="kb-badge kb-badge--muted">' + escapeHtml(STAFF_ROLES_MS[s.role] || s.role) + "</span>";
      return (
        '<button type="button" class="bs-staff-pick btn btn--outline' +
        (active ? " is-active" : "") +
        (owner ? " bs-staff-pick--owner" : "") +
        '" data-staff-id="' +
        escapeHtml(s.id) +
        '"><span class="bs-staff-pick__name">' +
        escapeHtml(displayName) +
        '</span><span class="bs-staff-pick__meta">' +
        roleBadge +
        '<span class="sd-muted">' +
        escapeHtml(pinStatusLabel(s.id)) +
        "</span></span></button>"
      );
    })
    .join("");
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
    $("bs-form-pin").value = "";
    if ($("bs-form-pin-confirm")) $("bs-form-pin-confirm").value = "";
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
  // Load PIN from staff_pins
  try {
    var pinSnap = await getDoc(doc(db, "staff_pins", id));
    $("bs-form-pin").value = pinSnap.exists() ? pinSnap.data().pin || "" : "";
    staffPinStatus[String(id)] = !!String($("bs-form-pin").value || "").trim();
  } catch (e) {
    $("bs-form-pin").value = "";
    staffPinStatus[String(id)] = false;
  }
  if ($("bs-form-pin-confirm")) $("bs-form-pin-confirm").value = "";
  renderStaffList();
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

  var pinVal = ($("bs-form-pin").value || "").trim();
  var pinConfirm = ($("bs-form-pin-confirm") && $("bs-form-pin-confirm").value.trim()) || "";
  if (pinVal || pinConfirm || editingOwner) {
    if (!/^\d{4}$/.test(pinVal)) {
      setStatus("PIN mesti 4 digit angka.", "err");
      return;
    }
    if (pinVal !== pinConfirm) {
      setStatus("PIN dan pengesahan PIN tidak sepadan.", "err");
      return;
    }
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
      if (pinVal) {
        await setDoc(doc(db, "staff_pins", id), {
          pin: pinVal,
          updatedAt: serverTimestamp()
        });
        staffPinStatus[String(id)] = true;
      }
    } else {
      var ref = await addStaff(payload);
      selectedId = ref.id;
      $("bs-form-id").value = ref.id;
      $("bs-form-delete").hidden = false;
      setStatus("Kakitangan ditambah.", "ok");
      renderStaffList();
      if (pinVal) {
        await setDoc(doc(db, "staff_pins", ref.id), {
          pin: pinVal,
          updatedAt: serverTimestamp()
        });
        staffPinStatus[String(ref.id)] = true;
      }
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
  $("bs-form-save").addEventListener("click", function () {
    saveStaffForm();
  });
  $("bs-form-delete").addEventListener("click", function () {
    deleteStaffForm();
  });
  $("bs-form-role").addEventListener("change", applyPayrollFieldsVisibility);
  $("bs-staff-list").addEventListener("click", function (e) {
    var btn = e.target.closest(".bs-staff-pick");
    if (!btn) return;
    var sid = btn.getAttribute("data-staff-id");
    if (sid) fillFormForStaff(sid);
  });
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

  staffUnsub = subscribeStaff(
    function (snap) {
      var rawFiltered = [];
      try {
        rawFiltered = snap.docs.map(function (d) {
          return docToStaff(d);
        });
        staffList = dedupeStaffByNameKey(rawFiltered);
        refreshStaffPinStatusCache(staffList);
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
