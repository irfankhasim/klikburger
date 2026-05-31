#!/usr/bin/env node
/**
 * Seed: staff_settings + dokumen `staff` (data operasi / dashboard), staff_activity contoh.
 *
 * Model: hanya dua akaun Firebase Auth (Owner vs Staff); pekerja individu ialah dokumen
 * `staff` tanpa Auth sendiri. Jualan & aktiviti guna ID dokumen `staff` apabila pekerja
 * memilih nama di terminal kongsi (pos-rbac-session operationalStaffId).
 *
 * Jalankan: node scripts/seed-staff-full.mjs
 * Auth demo (Irfan / Ikhwan): node scripts/seed-demo-auth-users.mjs — berasingan daripada `staff`.
 */
import { ensureAdminInitialized, getAdminFirestore } from "./lib/admin-init.mjs";
import { readDefaultFirebaseProjectId } from "./lib/read-project-id.mjs";
import { pathToFileURL } from "url";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

function rosterDefault() {
  return [0, 1, 2, 3, 4, 5, 6].map(function (day) {
    return { day: day, shift: day === 0 ? "cuti" : "pagi" };
  });
}

/** @param {import("firebase-admin/firestore").Firestore} db */
export async function seedStaffFull() {
  if (!ensureAdminInitialized()) {
    throw new Error("Admin SDK tidak dimulakan — credential atau emulator.");
  }
  var db = getAdminFirestore();
  var projectId = readDefaultFirebaseProjectId();

  console.log("\n→ staff_settings/default\n");
  await db
    .collection("staff_settings")
    .doc("default")
    .set(
      {
        teamMonthlyTargetRm: 18000,
        bonusRateAboveTarget: 0.035,
        ratingBase: 3.7,
        updatedAt: FieldValue.serverTimestamp(),
        seededFrom: "seed-staff-full.mjs",
        projectId: projectId
      },
      { merge: true }
    );

  console.log("\n→ staff (auto-id) — senarai operasi / dashboard\n");
  var extras = [
    { name: "Aina Razak", email: "aina.r@klikburger.local", role: "kitchen", phone: "012-5001001" },
    { name: "Daniel Chong", email: "daniel.c@klikburger.local", role: "runner", phone: "012-5001002" },
    { name: "Mira Hassan", email: "mira.h@klikburger.local", role: "cashier", phone: "012-5001003" }
  ];
  for (var e = 0; e < extras.length; e++) {
    var x = extras[e];
    var ref = await db.collection("staff").add({
      name: x.name,
      email: x.email,
      role: x.role,
      phone: x.phone,
      employmentStatus: "active",
      payType: "hourly",
      payAmount: 8.5 + e * 0.25,
      defaultShift: e % 2 === 0 ? "petang" : "pagi",
      weeklyRoster: rosterDefault(),
      startedAt: Timestamp.fromDate(new Date(2024, 5, 1)),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
    console.log("  staff/" + ref.id + " — " + x.name);
  }

  /** Dua rekod jelas untuk ujian dashboard / senarai (bukan Auth UID). */
  console.log("\n→ staff (2 rekod ujian)\n");
  var ujianRows = [
    { name: "Ujian Satu (Kaunter)", email: "ujian.satu@klikburger.local", role: "cashier", phone: "010-9001001" },
    { name: "Ujian Dua (Dapur)", email: "ujian.dua@klikburger.local", role: "kitchen", phone: "010-9001002" }
  ];
  for (var ui = 0; ui < ujianRows.length; ui++) {
    var ur = ujianRows[ui];
    var ujRef = await db.collection("staff").add({
      name: ur.name,
      email: ur.email,
      role: ur.role,
      phone: ur.phone,
      employmentStatus: "active",
      payType: "hourly",
      payAmount: 9 + ui * 0.5,
      defaultShift: ui === 0 ? "pagi" : "petang",
      weeklyRoster: rosterDefault(),
      startedAt: Timestamp.fromDate(new Date(2026, 0, 1)),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
    console.log("  staff/" + ujRef.id + " — " + ur.name);
    await db.collection("staff_activity").add({
      staffId: ujRef.id,
      staffName: ur.name,
      kind: "note",
      saleId: "",
      detail: "Rekod ujian — semak senarai & aktiviti di dashboard kakitangan.",
      subtotal: null,
      orderCount: null,
      createdAt: FieldValue.serverTimestamp()
    });
    console.log("    + staff_activity (nota ujian)");
  }

  console.log("\n→ staff_activity (contoh)\n");
  var snap = await db.collection("staff").limit(20).get();
  var batch = db.batch();
  var n = 0;
  snap.docs.forEach(function (d) {
    var data = d.data();
    var ref = db.collection("staff_activity").doc();
    batch.set(ref, {
      staffId: d.id,
      staffName: String(data.name || ""),
      kind: "note",
      saleId: "",
      detail: "Rekod awal sistem — selamat datang ke dashboard kakitangan.",
      subtotal: null,
      orderCount: null,
      createdAt: FieldValue.serverTimestamp()
    });
    n++;
  });
  await batch.commit();
  console.log("  " + n + " dokumen contoh staff_activity");

  console.log("\n✓ seed-staff-full selesai.\n");
}

async function main() {
  await seedStaffFull();
}

var isMain = false;
try {
  isMain = import.meta.url === pathToFileURL(process.argv[1]).href;
} catch (e2) {}
if (isMain) {
  main().catch(function (err) {
    console.error(err);
    process.exit(1);
  });
}
