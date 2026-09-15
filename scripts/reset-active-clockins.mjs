/**
 * Reset SEMUA sesi Clock In aktif (pos_active_shift).
 * Tulis clock_out audit supaya kehadiran tidak kekal "on duty".
 * Tidak padam history clock lama atau pos_shifts.
 *
 * Jalankan: node scripts/reset-active-clockins.mjs
 */
import { FieldValue } from "firebase-admin/firestore";
import { ensureAdminInitialized, getAdminFirestore } from "./lib/admin-init.mjs";

async function main() {
  if (!ensureAdminInitialized()) {
    console.error("firebase-admin gagal. Sediakan firebase-service-account.json.");
    process.exit(1);
  }
  const db = getAdminFirestore();
  const snap = await db.collection("pos_active_shift").get();
  console.log("pos_active_shift:", snap.size, "sesi aktif");

  for (const d of snap.docs) {
    const x = d.data() || {};
    const staffId = String(x.staffId || d.id);
    const staffName = String(x.staffName || "");
    const workRole = String(x.workRole || "cashier");
    console.log("  -", staffId, staffName, workRole);
    await db.collection("staff_activity").add({
      staffId,
      staffName,
      kind: "clock_out",
      saleId: "",
      detail: JSON.stringify({
        source: "system_reset_all_clock_in",
        workRole,
        ownerManual: true
      }),
      subtotal: null,
      orderCount: null,
      workRole,
      createdAt: FieldValue.serverTimestamp()
    });
    await d.ref.delete();
  }

  await db.collection("attendance_audit").add({
    actorUid: "system",
    actorName: "system_reset",
    actorRole: "owner",
    staffId: "",
    staffName: "",
    action: "reset_all_active_clock_in",
    reason: "Reset semua sesi clock in yang tersekat",
    changes: { cleared: snap.size },
    createdAt: FieldValue.serverTimestamp()
  });

  console.log("Selesai. Roster aktif dikosongkan:", snap.size);
  process.exit(0);
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
