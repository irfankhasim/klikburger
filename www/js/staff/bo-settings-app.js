/**
 * Tetapan pejabat belakang — sunting butiran staf (Firestore `staff`).
 */
import { Timestamp, auth, db, doc, getDoc, setDoc, serverTimestamp } from "../firebase/init.js";
import { waitForAuthUser } from "../pos-firebase-auth-bridge.js";
import { docToStaff, normalizeStaffNameKey, staffCanonicalDisplayName, dedupeStaffByNameKey } from "./staff-mappers.js";
import { subscribeStaff, addStaff, persistStaff, removeStaff } from "./staff-repository.js";

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

/** Pemilik tidak perlu medan gaji / payroll dalam tetapan Back Office. */
function applyPayrollFieldsVisibility() {
  var roleEl = $("bs-form-role");
  var wrap = $("bs-payroll-fields");
  if (!roleEl || !wrap) return;
  var hide = isOwnerStaffRole(roleEl.value);
  wrap.hidden = hide;
  wrap.setAttribute("aria-hidden", hide ? "true" : "false");
}

function renderStaffList() {
  var wrap = $("bs-staff-list");
  if (!wrap) return;
  if (!staffList.length) {
    wrap.innerHTML = '<p class="sd-footnote">Tiada rekod staf. Klik <strong>Tambah kakitangan</strong>.</p>';
    return;
  }
  wrap.innerHTML = staffList
    .map(function (s) {
      var active = String(s.id) === String(selectedId);
      var displayName = staffCanonicalDisplayName(s.name);
      return (
        '<button type="button" class="bs-staff-pick btn btn--outline' +
        (active ? " is-active" : "") +
        '" data-staff-id="' +
        escapeHtml(s.id) +
        '"><span>' +
        escapeHtml(displayName) +
        "</span></button>"
      );
    })
    .join("");
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
    applyPayrollFieldsVisibility();
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
  applyPayrollFieldsVisibility();
  // Load PIN from staff_pins
  try {
    var pinSnap = await getDoc(doc(db, "staff_pins", id));
    $("bs-form-pin").value = pinSnap.exists() ? pinSnap.data().pin || "" : "";
  } catch (e) {
    $("bs-form-pin").value = "";
  }
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
  var roleVal = $("bs-form-role").value;
  var payload = {
    name: staffCanonicalDisplayName(name),
    email: emailRaw,
    role: roleVal,
    employmentStatus: $("bs-form-status").value,
    phone: $("bs-form-phone").value.trim(),
    defaultShift: sh.defaultShift,
    weeklyRoster: sh.weeklyRoster
  };
  if (!isOwnerStaffRole(roleVal)) {
    payload.payType = $("bs-form-paytype").value;
    payload.payAmount = parseFloat($("bs-form-pay").value) || 0;
  }
  var st = startedTimestampFromInput();
  if (st) payload.startedAt = st;

  try {
    if (id) {
      await persistStaff(id, payload);
      setStatus("Butiran staf dikemas kini.", "ok");
      selectedId = id;
      // Save PIN to staff_pins collection
      var pinVal = ($("bs-form-pin").value || "").trim();
      if (pinVal) {
        await setDoc(doc(db, "staff_pins", id), {
          pin: pinVal,
          updatedAt: serverTimestamp()
        });
      }
    } else {
      var ref = await addStaff(payload);
      selectedId = ref.id;
      $("bs-form-id").value = ref.id;
      $("bs-form-delete").hidden = false;
      setStatus("Kakitangan ditambah.", "ok");
      renderStaffList();
      // Save PIN to staff_pins collection
      var newPinVal = ($("bs-form-pin").value || "").trim();
      if (newPinVal) {
        await setDoc(doc(db, "staff_pins", ref.id), {
          pin: newPinVal,
          updatedAt: serverTimestamp()
        });
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
