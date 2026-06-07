#!/usr/bin/env node
/**
 * Tambah rekod pemilik dalam koleksi `staff` (ID tetap owner_01).
 * Jalankan: node scripts/add-owner-staff.js
 */
import { pathToFileURL } from "url";
import { ensureAdminInitialized, getAdminAuth, getAdminFirestore } from "./lib/admin-init.mjs";
import { FieldValue } from "firebase-admin/firestore";

const OWNER_DOC_ID = "owner_01";
const DEFAULT_OWNER_NAME = "Irfan Khasim";
const DEFAULT_PIN = "0000";

async function resolveOwnerDisplayName(db, auth) {
  try {
    var usersSnap = await db.collection("users").where("role", "==", "owner").limit(1).get();
    if (!usersSnap.empty) {
      var u = usersSnap.docs[0].data();
      var n = String(u.displayName || u.name || "").trim();
      if (n) return n;
    }
  } catch (e) {
    console.warn("  (tidak dapat baca users/owner:", e.message || e, ")");
  }

  try {
    var list = await auth.listUsers(20);
    for (var i = 0; i < list.users.length; i++) {
      var au = list.users[i];
      var dn = String(au.displayName || "").trim();
      if (dn) return dn;
    }
  } catch (e2) {
    console.warn("  (tidak dapat baca Auth displayName:", e2.message || e2, ")");
  }

  return DEFAULT_OWNER_NAME;
}

export async function addOwnerStaff() {
  if (!ensureAdminInitialized()) {
    throw new Error("Admin SDK tidak dimulakan — credential atau emulator diperlukan.");
  }

  var db = getAdminFirestore();
  var auth = getAdminAuth();
  var ref = db.collection("staff").doc(OWNER_DOC_ID);
  var snap = await ref.get();

  if (snap.exists) {
    console.log("✓ staff/" + OWNER_DOC_ID + " sudah wujud — tiada perubahan.");
    return { created: false, id: OWNER_DOC_ID };
  }

  var ownerName = await resolveOwnerDisplayName(db, auth);
  console.log("→ Menambah pemilik:", ownerName);

  await ref.set({
    staffId: OWNER_DOC_ID,
    name: ownerName,
    staffName: ownerName,
    role: "owner",
    employmentStatus: "active",
    payType: "salary",
    payAmount: 0,
    salary: 0,
    isOwner: true,
    phone: "",
    email: "",
    defaultShift: "pagi",
    weeklyRoster: [
      { day: 0, shift: "cuti" },
      { day: 1, shift: "pagi" },
      { day: 2, shift: "pagi" },
      { day: 3, shift: "pagi" },
      { day: 4, shift: "pagi" },
      { day: 5, shift: "pagi" },
      { day: 6, shift: "pagi" }
    ],
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    seededFrom: "add-owner-staff.js"
  });

  await db.collection("staff_pins").doc(OWNER_DOC_ID).set(
    {
      pin: DEFAULT_PIN,
      updatedAt: FieldValue.serverTimestamp(),
      seededFrom: "add-owner-staff.js"
    },
    { merge: true }
  );

  console.log("✓ staff/" + OWNER_DOC_ID + " dicipta (PIN default: " + DEFAULT_PIN + " — tukar selepas setup).");
  return { created: true, id: OWNER_DOC_ID, name: ownerName };
}

async function main() {
  await addOwnerStaff();
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
