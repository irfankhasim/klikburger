import { auth, signInWithEmailAndPassword, signOut } from "./firebase/init.js";
import { waitForAuthUser, getPosUserRbacPayload } from "./pos-firebase-auth-bridge.js";
import { applyLoginIdentity, ROLES } from "./pos-rbac-session.js";
import {
  getLoginLockState,
  recordLoginFailure,
  recordLoginSuccess,
  isCredentialLoginFailure,
  lockoutMessageForState
} from "./login-lockout.js";
import { t as tr, interpolate } from "./i18n/locale.js";

var MAIN_MENU_HREF = new URL("../html/main-menu.html", import.meta.url).href;

/** Elak skrin tunggu selama-lamanya jika Firestore `users/{uid}` tidak jawab. */
async function getPosUserRbacPayloadWithFallback(firebaseUser) {
  try {
    return await Promise.race([
      getPosUserRbacPayload(firebaseUser),
      new Promise(function (_, rej) {
        window.setTimeout(function () {
          rej(new Error("rbac-timeout"));
        }, 12000);
      })
    ]);
  } catch (e) {
    return {
      userId: firebaseUser.uid,
      displayName: (firebaseUser.displayName || "").trim() ||
        (firebaseUser.email ? String(firebaseUser.email).split("@")[0] : tr("login.userFallback")),
      email: firebaseUser.email || "",
      role: ROLES.CASHIER
    };
  }
}

function bindPasswordToggle() {
  var pw = document.getElementById("password");
  var btn = document.getElementById("password-toggle");
  if (!pw || !btn) return;
  btn.addEventListener("click", function () {
    var showing = pw.type === "text";
    pw.type = showing ? "password" : "text";
    btn.setAttribute("aria-pressed", showing ? "false" : "true");
    btn.setAttribute("aria-label", showing ? "Tunjuk kata laluan" : "Sembunyi kata laluan");
    var i = btn.querySelector("i");
    if (i) i.className = showing ? "fa-regular fa-eye" : "fa-regular fa-eye-slash";
  });
}

/**
 * Jangan auto-redirect: elakkan "kilat" log masuk → menu.
 * Jika sesi Firebase masih ada, tunjuk pilihan manual sahaja.
 */
async function showResumeSessionIfNeeded() {
  var form = document.querySelector(".login-form");
  if (!form) return;
  var u = await Promise.race([
    waitForAuthUser(),
    new Promise(function (resolve) {
      window.setTimeout(function () {
        resolve(null);
      }, 12000);
    })
  ]);
  if (!u) return;
  var email = u.email || "";
  var emailInput = document.getElementById("email");
  if (emailInput && email && !emailInput.value.trim()) {
    emailInput.value = email;
  }
  var wrap = document.createElement("div");
  wrap.className = "login-resume";
  wrap.setAttribute("role", "region");
  wrap.setAttribute("aria-label", "Sesi sedia ada");
  wrap.innerHTML =
    '<p class="login-resume__text">Sesi Firebase masih aktif' +
    (email ? " (<strong>" +
      email.replace(/</g, "&lt;").replace(/>/g, "&gt;") +
      "</strong>)" : "") +
    ".</p>" +
    '<p class="login-resume__actions">' +
    '<button type="button" class="btn btn--primary login-resume__menu">Terus ke menu</button>' +
    '<button type="button" class="btn btn--ghost login-resume__out">Log keluar</button>' +
    "</p>";
  form.parentNode.insertBefore(wrap, form);
  form.hidden = true;
  var footer = document.querySelector(".login-footer");
  if (footer) footer.hidden = true;
  wrap.querySelector(".login-resume__menu").addEventListener("click", async function () {
    try {
      var payload = await getPosUserRbacPayloadWithFallback(u);
      applyLoginIdentity(payload);
      window.location.href = MAIN_MENU_HREF;
    } catch (err) {
      window.alert(err && err.message ? err.message : tr("login.alert.connectFail"));
    }
  });
  wrap.querySelector(".login-resume__out").addEventListener("click", async function () {
    try {
      var rbac = await import("./pos-rbac-session.js");
      var blockReason = await rbac.assertLogoutReady();
      if (blockReason) {
        window.alert(blockReason + " " + tr("login.alert.finishClock"));
        return;
      }
      await signOut(auth);
      rbac.logoutSession();
    } catch (e) {}
    wrap.remove();
    form.hidden = false;
    if (footer) footer.hidden = false;
    if (emailInput) emailInput.value = "";
    var pw = document.getElementById("password");
    if (pw) pw.value = "";
  });
}

var lockoutBanner = null;
var lockoutTimerId = null;
var loginSubmitBtn = null;

function ensureLockoutBanner() {
  var form = document.querySelector(".login-form");
  if (!form) return null;
  if (!lockoutBanner) {
    lockoutBanner = document.createElement("p");
    lockoutBanner.className = "login-lockout-banner";
    lockoutBanner.setAttribute("role", "alert");
    lockoutBanner.hidden = true;
    form.insertBefore(lockoutBanner, form.firstChild);
  }
  if (!loginSubmitBtn) {
    loginSubmitBtn = form.querySelector('button[type="submit"]');
  }
  return lockoutBanner;
}

function applyLoginLockUi(email) {
  var banner = ensureLockoutBanner();
  if (!banner) return;
  var state = getLoginLockState(email);
  if (state.locked) {
    banner.hidden = false;
    banner.textContent = lockoutMessageForState(state);
    if (loginSubmitBtn) loginSubmitBtn.disabled = true;
    if (lockoutTimerId) window.clearInterval(lockoutTimerId);
    lockoutTimerId = window.setInterval(function () {
      var s = getLoginLockState(email);
      if (!s.locked) {
        window.clearInterval(lockoutTimerId);
        lockoutTimerId = null;
        banner.hidden = true;
        if (loginSubmitBtn) loginSubmitBtn.disabled = false;
        return;
      }
      banner.textContent = lockoutMessageForState(s);
    }, 1000);
  } else {
    banner.hidden = true;
    if (loginSubmitBtn) loginSubmitBtn.disabled = false;
    if (lockoutTimerId) {
      window.clearInterval(lockoutTimerId);
      lockoutTimerId = null;
    }
  }
}

function bindLoginLockoutWatch() {
  var emailEl = document.getElementById("email");
  if (!emailEl) return;
  emailEl.addEventListener("input", function () {
    applyLoginLockUi(emailEl.value.trim());
  });
  emailEl.addEventListener("blur", function () {
    applyLoginLockUi(emailEl.value.trim());
  });
  applyLoginLockUi(emailEl.value.trim());
}

showResumeSessionIfNeeded();
bindPasswordToggle();
bindLoginLockoutWatch();

document.querySelector(".login-form").addEventListener("submit", async function (e) {
  e.preventDefault();
  var emailEl = document.getElementById("email");
  var pwEl = document.getElementById("password");
  var email = (emailEl && emailEl.value.trim()) || "";
  var password = (pwEl && pwEl.value) || "";
  if (!email || !password) {
    window.alert(tr("login.alert.fillFields"));
    return;
  }

  var lockState = getLoginLockState(email);
  if (lockState.locked) {
    applyLoginLockUi(email);
    window.alert(lockoutMessageForState(lockState));
    return;
  }

  var submitBtn = this.querySelector('button[type="submit"]');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.classList.add("is-busy");
  }

  try {
    var cred = await Promise.race([
      signInWithEmailAndPassword(auth, email, password),
      new Promise(function (_, rej) {
        window.setTimeout(function () {
          rej(Object.assign(new Error("auth/network-timeout"), { code: "auth/network-timeout" }));
        }, 25000);
      })
    ]);
    recordLoginSuccess(email);
    var payload = await getPosUserRbacPayloadWithFallback(cred.user);
    applyLoginIdentity(payload);
    window.location.href = MAIN_MENU_HREF;
  } catch (err) {
    var code = err && err.code;
    var msg = "Log masuk gagal.";
    if (isCredentialLoginFailure(err)) {
      var fail = recordLoginFailure(email);
      msg = fail.message;
      applyLoginLockUi(email);
    } else if (code === "auth/network-timeout") {
      msg = "Rangkaian terlalu lama tidak menjawab. Cuba lagi.";
    } else if (code === "auth/too-many-requests") {
      msg = "Terlalu banyak percubaan. Cuba lagi kemudian.";
    } else if (err && err.message) {
      msg = err.message;
    }
    window.alert(msg);
  } finally {
    if (submitBtn && !submitBtn.hidden) {
      var lock = getLoginLockState(email);
      if (!lock.locked) submitBtn.disabled = false;
      submitBtn.classList.remove("is-busy");
    }
  }
});
