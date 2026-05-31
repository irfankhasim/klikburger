#!/usr/bin/env node
/**
 * Seed: 23 rekod `staff` tetap (ID `kb_roster_01` … `kb_roster_23`) — termasuk Aina Razak & Daniel Chong.
 *
 * - Menulis/merge dokumen tetap supaya boleh dijalankan semula tanpa pendua nama.
 * - **Tidak** memadam dokumen lama automatik — padam rekod tambahan secara manual di Console
 *   atau gunakan skrip pentadbiran berasingan jika pangkalan sudah bersepah.
 *
 * Jalankan: node scripts/seed-staff-23.mjs
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

/** 23 nama operasi — Aina & Daniel dalam senarai rasmi. */
var ROSTER23 = [
  { id: "kb_roster_01", name: "Aina Razak", email: "aina.razak@tabkaunter.local", role: "supervisor" },
  { id: "kb_roster_02", name: "Daniel Chong", email: "daniel.chong@tabkaunter.local", role: "cashier" },
  { id: "kb_roster_03", name: "Amira Yasmin", email: "amira.y@tabkaunter.local", role: "cashier" },
  { id: "kb_roster_04", name: "Hariz Hakimi", email: "hariz.h@tabkaunter.local", role: "kitchen" },
  { id: "kb_roster_05", name: "Nurin Sofia", email: "nurin.s@tabkaunter.local", role: "runner" },
  { id: "kb_roster_06", name: "Irfan Hadi", email: "irfan.h@tabkaunter.local", role: "cashier" },
  { id: "kb_roster_07", name: "Siti Aminah", email: "siti.a@tabkaunter.local", role: "kitchen" },
  { id: "kb_roster_08", name: "Zaki Imran", email: "zaki.i@tabkaunter.local", role: "runner" },
  { id: "kb_roster_09", name: "Farah Liyana", email: "farah.l@tabkaunter.local", role: "cashier" },
  { id: "kb_roster_10", name: "Hakim Razif", email: "hakim.r@tabkaunter.local", role: "kitchen" },
  { id: "kb_roster_11", name: "Liyana Maisarah", email: "liyana.m@tabkaunter.local", role: "cashier" },
  { id: "kb_roster_12", name: "Syafiq Aiman", email: "syafiq.a@tabkaunter.local", role: "runner" },
  { id: "kb_roster_13", name: "Aisyah Dania", email: "aisyah.d@tabkaunter.local", role: "cashier" },
  { id: "kb_roster_14", name: "Danish Iqbal", email: "danish.i@tabkaunter.local", role: "kitchen" },
  { id: "kb_roster_15", name: "Mira Khalilah", email: "mira.k@tabkaunter.local", role: "cashier" },
  { id: "kb_roster_16", name: "Rayyan Firdaus", email: "rayyan.f@tabkaunter.local", role: "runner" },
  { id: "kb_roster_17", name: "Puteri Balqis", email: "puteri.b@tabkaunter.local", role: "cashier" },
  { id: "kb_roster_18", name: "Luqman Haikal", email: "luqman.h@tabkaunter.local", role: "kitchen" },
  { id: "kb_roster_19", name: "Hana Maisara", email: "hana.m@tabkaunter.local", role: "cashier" },
  { id: "kb_roster_20", name: "Imran Syauqi", email: "imran.s@tabkaunter.local", role: "runner" },
  { id: "kb_roster_21", name: "Balqis Adriana", email: "balqis.a@tabkaunter.local", role: "cashier" },
  { id: "kb_roster_22", name: "Syed Ariz", email: "syed.ariz@tabkaunter.local", role: "kitchen" },
  { id: "kb_roster_23", name: "Wanie Natasha", email: "wanie.n@tabkaunter.local", role: "cashier" }
];

export async function seedStaff23() {
  if (!ensureAdminInitialized()) {
    throw new Error("Admin SDK tidak dimulakan — credential atau emulator.");
  }
  var db = getAdminFirestore();
  var projectId = readDefaultFirebaseProjectId();
  console.log("\n→ staff — 23 rekod tetap (kb_roster_01 … kb_roster_23)\n");
  console.log("  projectId:", projectId);

  await db
    .collection("staff_settings")
    .doc("default")
    .set(
      {
        teamMonthlyTargetRm: 18000,
        bonusRateAboveTarget: 0.035,
        ratingBase: 3.7,
        updatedAt: FieldValue.serverTimestamp(),
        seededFrom: "seed-staff-23.mjs",
        projectId: projectId
      },
      { merge: true }
    );
  console.log("  staff_settings/default (merge)");

  for (var i = 0; i < ROSTER23.length; i++) {
    var row = ROSTER23[i];
    var payType = row.id === "kb_roster_01" || row.id === "kb_roster_02" ? "monthly" : "hourly";
    var payAmount = row.id === "kb_roster_01" || row.id === "kb_roster_02" ? 1000 : 9 + (i % 5) * 0.25;
    await db
      .collection("staff")
      .doc(row.id)
      .set(
        {
          name: row.name,
          email: row.email,
          role: row.role,
          phone: "",
          employmentStatus: "active",
          payType: payType,
          payAmount: payAmount,
          defaultShift: i % 3 === 0 ? "pagi" : i % 3 === 1 ? "petang" : "penuh",
          weeklyRoster: rosterDefault(),
          startedAt: Timestamp.fromDate(new Date(2024, 0, 15 + (i % 20))),
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          seededFrom: "seed-staff-23.mjs"
        },
        { merge: true }
      );
    console.log("  staff/" + row.id + " — " + row.name);
  }

  console.log(
    "\nNota: Dokumen `staff` lama (ID lain) tidak dipadam. Buang secara manual di Firebase Console jika perlu.\n"
  );
  console.log("✓ seed-staff-23 selesai.\n");
}

async function main() {
  await seedStaff23();
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
