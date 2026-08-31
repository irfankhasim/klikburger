/**
 * Inisialisasi Firebase App + Firestore (singleton).
 * Modul lain import { db, collection, ... } dari fail ini.
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getFirestore,
  connectFirestoreEmulator,
  collection,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  getDocs,
  getDoc,
  getDocFromServer,
  writeBatch,
  runTransaction,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  Timestamp,
  serverTimestamp,
  increment
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig } from "./config.js";
import {
  getAuth,
  connectAuthEmulator,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFunctions,
  httpsCallable,
  connectFunctionsEmulator
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-functions.js";

/**
 * Port yang auto-sambung ke Firebase emulator: Hosting emulator (5000/5001) DAN
 * port biasa VSCode Live Server (5500/5501) — pasangan Live Server + `npm run dev:emulators`
 * ialah workflow biasa untuk repo ni. Kalau emulator tak hidup semasa buka port-port ni,
 * Auth akan gagal dengan `auth/network-request-failed` — jalankan `npm run dev:emulators` dulu.
 * Port localhost lain (elak paksa emulator pada production): guna `?fbEmu=1` sekali sahaja,
 * ia melekat automatik (localStorage `kb_fb_emu`) untuk page localhost seterusnya.
 */
var EMULATOR_HOSTING_PORTS = { "5000": true, "5001": true, "5500": true, "5501": true };

/** Elak paksa emulator pada domain production — jika tidak, Auth cuba 127.0.0.1:9099 & boleh “loading” lama. */
function isLocalBrowserHost() {
  try {
    var h = String(window.location.hostname || "");
    return !h || h === "localhost" || h === "127.0.0.1";
  } catch (e) {
    return false;
  }
}

function shouldUseFirebaseEmulators() {
  if (typeof window === "undefined") return false;
  try {
    // ?fbProd=1 memaksa production walaupun pada port Live Server (5500/5501) yang
    // biasanya auto-emulator — lekat dalam localStorage macam kb_fb_emu supaya tak perlu
    // ulang tiap kali buka page localhost lain.
    if (new URLSearchParams(window.location.search).get("fbProd") === "1") {
      try {
        if (window.localStorage) {
          window.localStorage.setItem("kb_fb_prod", "1");
          window.localStorage.removeItem("kb_fb_emu");
        }
      } catch (e3) {}
      return false;
    }
    if (window.localStorage && window.localStorage.getItem("kb_fb_prod") === "1" && isLocalBrowserHost()) {
      return false;
    }

    var p = window.location.port || "";
    if (EMULATOR_HOSTING_PORTS[p]) return true;
    if (new URLSearchParams(window.location.search).get("fbEmu") === "1") {
      if (!isLocalBrowserHost()) return false;
      // Lekatkan pilihan ni supaya page localhost lain (cth Live Server) tak perlu ?fbEmu=1 berulang kali.
      try {
        if (window.localStorage) {
          window.localStorage.setItem("kb_fb_emu", "1");
          window.localStorage.removeItem("kb_fb_prod");
        }
      } catch (e2) {}
      return true;
    }
    if (window.localStorage && window.localStorage.getItem("kb_fb_emu") === "1") return isLocalBrowserHost();
  } catch (e) {}
  return false;
}

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
/** Sama dengan REGION dalam functions/index.js */
export const functions = getFunctions(app, "asia-southeast1");

if (shouldUseFirebaseEmulators()) {
  try {
    connectFirestoreEmulator(db, "127.0.0.1", 8080);
  } catch (e) {
    /* sudah disambung */
  }
  try {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  } catch (e) {
    /* sudah disambung */
  }
  try {
    connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  } catch (e) {
    /* sudah disambung */
  }
}

export {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  httpsCallable,
  collection,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  getDocs,
  getDoc,
  getDocFromServer,
  writeBatch,
  runTransaction,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  Timestamp,
  serverTimestamp,
  increment
};
