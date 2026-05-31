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

/**
 * Hanya port Hosting emulator Firebase (npm run dev).
 * Jangan auto-sambung pada 5500 (Live Server) — jika emulator tidak hidup, Auth gagal dengan auth/network-request-failed.
 * Untuk Live Server + emulator: jalankan `npm run dev`, kemudian `?fbEmu=1` atau `localStorage kb_fb_emu=1`.
 */
var EMULATOR_HOSTING_PORTS = { "5000": true, "5001": true };

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
    var p = window.location.port || "";
    if (EMULATOR_HOSTING_PORTS[p]) return true;
    if (new URLSearchParams(window.location.search).get("fbEmu") === "1") return isLocalBrowserHost();
    if (window.localStorage && window.localStorage.getItem("kb_fb_emu") === "1") return isLocalBrowserHost();
  } catch (e) {}
  return false;
}

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

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
}

export {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  collection,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  getDocs,
  getDoc,
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
