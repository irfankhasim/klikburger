import { auth, signInWithEmailAndPassword, signOut } from "./firebase/init.js";
import { waitForAuthUser, getPosUserRbacPayload } from "./pos-firebase-auth-bridge.js";
import { loginSession } from "./pos-rbac-session.js";

var MAIN_MENU_HREF = new URL("../html/main-menu.html", import.meta.url).href;

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
  var u = await waitForAuthUser();
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
    '<button type="button" class="btn btn--secondary login-resume__menu">Terus ke menu</button> ' +
    '<button type="button" class="btn btn--ghost login-resume__out">Log keluar</button>' +
    "</p>";
  form.parentNode.insertBefore(wrap, form);
  wrap.querySelector(".login-resume__menu").addEventListener("click", async function () {
    try {
      var payload = await getPosUserRbacPayload(u);
      loginSession(payload);
      window.location.href = MAIN_MENU_HREF;
    } catch (err) {
      window.alert(err && err.message ? err.message : "Tidak dapat sambung ke menu.");
    }
  });
  wrap.querySelector(".login-resume__out").addEventListener("click", async function () {
    try {
      await signOut(auth);
    } catch (e) {}
    wrap.remove();
    if (emailInput) emailInput.value = "";
    var pw = document.getElementById("password");
    if (pw) pw.value = "";
  });
}

showResumeSessionIfNeeded();
bindPasswordToggle();

document.querySelector(".login-form").addEventListener("submit", async function (e) {
  e.preventDefault();
  var emailEl = document.getElementById("email");
  var pwEl = document.getElementById("password");
  var email = (emailEl && emailEl.value.trim()) || "";
  var password = (pwEl && pwEl.value) || "";
  if (!email || !password) {
    window.alert("Sila isi e-mel dan kata laluan.");
    return;
  }
  try {
    var cred = await signInWithEmailAndPassword(auth, email, password);
    var payload = await getPosUserRbacPayload(cred.user);
    loginSession(payload);
    window.location.href = MAIN_MENU_HREF;
  } catch (err) {
    var code = err && err.code;
    var msg = "Log masuk gagal.";
    if (code === "auth/invalid-credential" || code === "auth/wrong-password" || code === "auth/user-not-found") {
      msg = "E-mel atau kata laluan tidak sah.";
    } else if (code === "auth/too-many-requests") {
      msg = "Terlalu banyak percubaan. Cuba lagi kemudian.";
    } else if (err && err.message) {
      msg = err.message;
    }
    window.alert(msg);
  }
});
