/**
 * Inisialisasi firebase-admin untuk skrip terminal (Cloud atau Emulator).
 */
import { readFileSync, existsSync } from "fs";
import path from "path";
import admin from "firebase-admin";
import { getRepoRoot, readDefaultFirebaseProjectId } from "./read-project-id.mjs";

/**
 * @returns {string|null} laluan fail kunci perkhidmatan atau null jika emulator sahaja
 */
export function resolveServiceAccountPath() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS && existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
    return process.env.GOOGLE_APPLICATION_CREDENTIALS;
  }
  var argvPath = process.argv.find(function (a) {
    return a.endsWith(".json") && existsSync(a);
  });
  if (argvPath && existsSync(argvPath)) return path.resolve(argvPath);
  var def = path.join(getRepoRoot(), "firebase-service-account.json");
  if (existsSync(def)) return def;
  return null;
}

export function isEmulatorEnv() {
  return !!(process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST);
}

/**
 * Satu kali initialize. Emulator: tiada credential. Cloud: perlu fail SA atau ADC.
 * @returns {boolean} true jika berjaya
 */
export function ensureAdminInitialized() {
  if (admin.apps.length) return true;

  var projectId =
    process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || readDefaultFirebaseProjectId();

  if (isEmulatorEnv()) {
    admin.initializeApp({ projectId: projectId });
    return true;
  }

  var saPath = resolveServiceAccountPath();
  if (saPath) {
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(readFileSync(saPath, "utf8"))),
      projectId: projectId
    });
    return true;
  }

  try {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId: projectId
    });
    return true;
  } catch (e) {
    return false;
  }
}

export function getAdminFirestore() {
  if (!ensureAdminInitialized()) throw new Error("firebase-admin tidak dapat dimulakan.");
  return admin.firestore();
}

export function getAdminAuth() {
  if (!ensureAdminInitialized()) throw new Error("firebase-admin tidak dapat dimulakan.");
  return admin.auth();
}
