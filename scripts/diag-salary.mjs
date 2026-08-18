/**
 * Diagnostik (READ-ONLY): kenapa gaji laporan bulanan salah.
 * Jalankan: node scripts/diag-salary.mjs
 */
import { ensureAdminInitialized, getAdminFirestore } from "./lib/admin-init.mjs";
import { staffSalaryForCalendarMonth, staffAccumulatedSalaryToDate, staffMonthlyRate } from "../js/monthly-reports/staff-salary-calc.js";

async function main() {
  if (!ensureAdminInitialized()) {
    console.error("admin gagal init.");
    process.exit(1);
  }
  const db = getAdminFirestore();

  console.log("=== STAFF ===");
  const staffSnap = await db.collection("staff").get();
  staffSnap.docs.forEach(function (d) {
    const x = d.data();
    const monthly = staffMonthlyRate(x);
    const may = staffSalaryForCalendarMonth(x, 2026, 5);
    const acc = staffAccumulatedSalaryToDate(x, 2026, 5);
    const started = x.startedAt && typeof x.startedAt.toDate === "function" ? x.startedAt.toDate().toISOString().slice(0, 10) : x.startedAt;
    console.log(
      "id=" + d.id,
      "| name=" + (x.name || x.staffName),
      "| payType=" + x.payType,
      "| payAmount=" + x.payAmount,
      "| started=" + started,
      "| monthlyRate=" + monthly,
      "| May2026=" + may,
      "| accum=" + acc
    );
  });

  console.log("\n=== STORED REPORT monthly_reports/2026-05 ===");
  const rep = await db.collection("monthly_reports").doc("2026-05").get();
  if (!rep.exists) {
    console.log("(tiada dokumen 2026-05)");
  } else {
    const r = rep.data();
    console.log("company.payrollEstimateRm:", r.company && r.company.payrollEstimateRm);
    console.log("company.netOperatingEstimateRm:", r.company && r.company.netOperatingEstimateRm);
    console.log("staffSalary.activeStaffPayrollEstimateRm:", r.staffSalary && r.staffSalary.activeStaffPayrollEstimateRm);
    console.log("generatorVersion:", r.generatorVersion, "| generatedAt:", r.generatedAt && r.generatedAt.toDate && r.generatedAt.toDate().toISOString());
    (r.staffSalary && r.staffSalary.lines ? r.staffSalary.lines : []).forEach(function (ln) {
      console.log(
        "  line:", ln.name,
        "| estMonthly=" + ln.estimatedMonthlySalaryRm,
        "| salaryDisplay=" + ln.salaryDisplayRm,
        "| accum=" + ln.accumulatedSalaryRm
      );
    });
  }
  process.exit(0);
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
