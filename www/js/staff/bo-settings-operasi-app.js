/**
 * Tetapan operasi — peratus cukai pelanggan (Firestore `staff_settings/default`).
 */
import { waitForAuthUser, getPosUserRbacPayload } from "../pos-firebase-auth-bridge.js";
import { ROLES } from "../pos-rbac-constants.js";
import { getStaffSettings, saveStaffSettings } from "./staff-repository.js";
import { clampTaxPercent } from "../pos-tax.js";

function $(id) {
  return document.getElementById(id);
}

function setStatus(msg, kind) {
  var el = $("bs-ops-status");
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

async function ensureOwner() {
  var u = await waitForAuthUser();
  if (!u) {
    setStatus("Sila log masuk sebagai pemilik.", "err");
    return false;
  }
  var rbac = await getPosUserRbacPayload(u);
  if (rbac.role !== ROLES.OWNER) {
    setStatus("Hanya akaun pemilik boleh mengubah tetapan cukai.", "err");
    var saveBtn = $("bs-ops-save");
    var taxInp = $("bs-ops-tax-percent");
    if (saveBtn) saveBtn.disabled = true;
    if (taxInp) taxInp.disabled = true;
    return false;
  }
  return true;
}

async function loadForm() {
  try {
    var settings = await getStaffSettings();
    var inp = $("bs-ops-tax-percent");
    if (inp) inp.value = String(clampTaxPercent(settings.customerTaxPercent));
  } catch (e) {
    console.error(e);
    setStatus(e.message || String(e), "err");
  }
}

async function saveForm() {
  if (!(await ensureOwner())) return;
  var inp = $("bs-ops-tax-percent");
  var pct = clampTaxPercent(inp && inp.value);
  try {
    var current = await getStaffSettings();
    await saveStaffSettings({
      teamMonthlyTargetRm: current.teamMonthlyTargetRm,
      bonusRateAboveTarget: current.bonusRateAboveTarget,
      ratingBase: current.ratingBase,
      customerTaxPercent: pct
    });
    if (inp) inp.value = String(pct);
    setStatus("Peratus cukai dikemas kini (" + pct + "%).", "ok");
  } catch (e) {
    console.error(e);
    setStatus(e.message || String(e), "err");
  }
}

async function main() {
  var saveBtn = $("bs-ops-save");
  if (saveBtn) {
    saveBtn.addEventListener("click", function () {
      saveForm();
    });
  }
  if (!(await ensureOwner())) {
    await loadForm();
    return;
  }
  await loadForm();
}

main().catch(function (e) {
  console.error(e);
  setStatus(e.message || String(e), "err");
});
