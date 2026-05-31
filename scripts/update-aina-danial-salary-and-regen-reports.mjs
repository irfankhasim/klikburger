#!/usr/bin/env node
/**
 * Tetapkan gaji tetap RM1,000/bulan untuk Aina & Danial,
 * kemudian jana semula laporan bulanan dari 2024-01 hingga bulan semasa.
 *
 * Jalankan: node scripts/update-aina-danial-salary-and-regen-reports.mjs
 */
import { pathToFileURL } from "url";
import { FieldValue } from "firebase-admin/firestore";
import { ensureAdminInitialized, getAdminFirestore } from "./lib/admin-init.mjs";
import { writeMonthlyReportAdmin } from "../mcp/lib/monthly-report-generate-admin.mjs";

var STAFF_IDS_PREFERRED = ["kb_roster_01", "kb_roster_02", "Xvl7Hly3aNS8bqeoXL7R", "b2mOuGiSgUHPOyU8GeJZ"];

function isTargetStaffName(name) {
  var n = String(name || "").toLowerCase();
  return (
    n === "aina" ||
    n.indexOf("aina ") === 0 ||
    n.indexOf("aina razak") >= 0 ||
    n === "danial" ||
    n === "daniel" ||
    n.indexOf("danial ") === 0 ||
    n.indexOf("daniel ") === 0
  );
}

function pad2(n) {
  return (n < 10 ? "0" : "") + n;
}

function monthKey(year, month) {
  return year + "-" + pad2(month);
}

function iterMonths(fromYear, fromMonth, toYear, toMonth) {
  var out = [];
  var y = fromYear;
  var m = fromMonth;
  while (y < toYear || (y === toYear && m <= toMonth)) {
    out.push({ year: y, month: m, key: monthKey(y, m) });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

async function resolveStaffToUpdate(db) {
  var byId = new Map();
  for (var i = 0; i < STAFF_IDS_PREFERRED.length; i++) {
    var id = STAFF_IDS_PREFERRED[i];
    var snap = await db.collection("staff").doc(id).get();
    if (snap.exists) byId.set(id, snap.data().name || id);
  }
  var all = await db.collection("staff").get();
  all.docs.forEach(function (d) {
    if (isTargetStaffName(d.data().name)) byId.set(d.id, d.data().name || d.id);
  });
  return Array.from(byId.entries()).map(function (e) {
    return { id: e[0], name: e[1] };
  });
}

export async function updateAinaDanialSalaryAndRegenReports() {
  if (!ensureAdminInitialized()) {
    throw new Error("Admin SDK tidak dimulakan — set GOOGLE_APPLICATION_CREDENTIALS atau emulator.");
  }
  var db = getAdminFirestore();
  var STAFF_UPDATES = await resolveStaffToUpdate(db);
  if (!STAFF_UPDATES.length) {
    throw new Error("Tiada rekod staff Aina / Danial dijumpai dalam Firestore.");
  }
  console.log("\n→ Kemas kini gaji Aina & Danial (RM1,000/bulan tetap)\n");

  for (var i = 0; i < STAFF_UPDATES.length; i++) {
    var row = STAFF_UPDATES[i];
    await db.collection("staff").doc(row.id).set(
      {
        payType: "monthly",
        payAmount: 1000,
        employmentStatus: "active",
        updatedAt: FieldValue.serverTimestamp(),
        salaryUpdatedBy: "update-aina-danial-salary-and-regen-reports.mjs"
      },
      { merge: true }
    );
    console.log("  staff/" + row.id + " — " + row.name + " → monthly RM 1000");
  }

  var now = new Date();
  var toYear = now.getFullYear();
  var toMonth = now.getMonth() + 1;
  var months = iterMonths(2024, 1, toYear, toMonth);

  console.log("\n→ Jana semula " + months.length + " laporan bulanan (" + months[0].key + " … " + months[months.length - 1].key + ")\n");

  for (var j = 0; j < months.length; j++) {
    var mk = months[j].key;
    process.stdout.write("  monthly_reports/" + mk + " … ");
    await writeMonthlyReportAdmin(db, mk, {
      source: "salary_config_update",
      actorUid: "script"
    });
    console.log("ok");
  }

  console.log("\n✓ Selesai. Muat semula Laporan penuh dalam Back Office.\n");
}

async function main() {
  await updateAinaDanialSalaryAndRegenReports();
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
