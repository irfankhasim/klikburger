/**
 * Padam rekod clock_in orphan Aina (Jun 2026) dari staff_activity.
 * Jalankan: node scripts/delete-bad-clockin.js
 */
import { Timestamp } from "firebase-admin/firestore";
import { ensureAdminInitialized, getAdminFirestore } from "./lib/admin-init.mjs";

async function main() {
  if (!ensureAdminInitialized()) {
    console.error("firebase-admin tidak dapat dimulakan. Semak firebase-service-account.json.");
    process.exit(1);
  }

  const db = getAdminFirestore();

  const start = Timestamp.fromDate(new Date(2026, 5, 1));
  const end = Timestamp.fromDate(new Date(2026, 6, 1));

  const snap = await db
    .collection("staff_activity")
    .where("createdAt", ">=", start)
    .where("createdAt", "<", end)
    .get();

  const targets = snap.docs.filter(function (d) {
    const data = d.data();
    return data.kind === "clock_in" && data.staffName === "Aina";
  });

  if (!targets.length) {
    console.log("Tiada rekod dijumpai.");
    return;
  }

  for (const d of targets) {
    const data = d.data();
    const at = data.createdAt && typeof data.createdAt.toDate === "function" ? data.createdAt.toDate() : null;
    console.log("Deleting:", d.id, "|", data.staffName, "|", at ? at.toLocaleString() : "—");
    await db.collection("staff_activity").doc(d.id).delete();
  }

  console.log("Done. Semua rekod orphan clock_in Aina Jun 2026 telah dibuang.");
  process.exit(0);
}

main().catch(console.error);
