#!/usr/bin/env node
/**
 * Dua akaun demo Auth sahaja (Owner + Staff kongsi) + dokumen users/{uid}.
 * Pekeja individu tidak wujud di Auth — rekod mereka dalam koleksi `staff` (seed berasingan).
 */
import { pathToFileURL } from "url";
import { ensureAdminInitialized, getAdminAuth, getAdminFirestore, isEmulatorEnv } from "./lib/admin-init.mjs";
import { readDefaultFirebaseProjectId } from "./lib/read-project-id.mjs";

var DEMO_USERS = [
  { email: "irfan@gmail.com", password: "irfan123", displayName: "Irfan", role: "owner" },
  { email: "ikhwan@gmail.com", password: "ikhwan123", displayName: "Ikhwan", role: "staff" }
];

export async function seedDemoAuthUsers() {
  if (!ensureAdminInitialized()) {
    throw new Error("Tidak dapat mulakan Admin SDK — letak firebase-service-account.json atau tetapkan emulator.");
  }
  var auth = getAdminAuth();
  var db = getAdminFirestore();
  var projectId = readDefaultFirebaseProjectId();

  for (var i = 0; i < DEMO_USERS.length; i++) {
    var u = DEMO_USERS[i];
    var uid;
    try {
      var existing = await auth.getUserByEmail(u.email);
      uid = existing.uid;
      await auth.updateUser(uid, { password: u.password, displayName: u.displayName });
    } catch (e) {
      if (e && e.code === "auth/user-not-found") {
        var created = await auth.createUser({
          email: u.email,
          password: u.password,
          displayName: u.displayName,
          emailVerified: true
        });
        uid = created.uid;
      } else {
        throw e;
      }
    }
    await db.collection("users").doc(uid).set(
      {
        displayName: u.displayName,
        role: u.role,
        email: u.email,
        seededAt: new Date().toISOString(),
        projectId: projectId
      },
      { merge: true }
    );
    console.log("  user:", u.email, "→", uid, "(" + u.role + ")");
  }
}

async function main() {
  console.log("Seed pengguna demo Auth + Firestore users/ …");
  if (isEmulatorEnv()) {
    console.log("  (mod emulator:", process.env.FIREBASE_AUTH_EMULATOR_HOST + ")");
  }
  await seedDemoAuthUsers();
  console.log("OK — demo users siap.");
}

var isMain = false;
try {
  isMain = import.meta.url === pathToFileURL(process.argv[1]).href;
} catch (e) {}
if (isMain) {
  main().catch(function (err) {
    console.error(err);
    process.exit(1);
  });
}
