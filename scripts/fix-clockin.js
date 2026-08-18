/**
 * Padam clock_in BERGANDA untuk owner_01 pada Jumaat 26 Jun 2026.
 * Kekalkan clock_in PERTAMA (06:05 PG); buang selebihnya.
 *
 * Nota: projek ini "type": "module" (ESM) dan guna `firebase-service-account.json`
 * di root (atau GOOGLE_APPLICATION_CREDENTIALS / emulator) melalui helper bersama
 * `./lib/admin-init.mjs` — bukan `serviceAccountKey.json` + require().
 *
 * Jalankan: node scripts/fix-clockin.js
 */
import { Timestamp } from "firebase-admin/firestore";
import { ensureAdminInitialized, getAdminFirestore } from "./lib/admin-init.mjs";

const STAFF_ID = "owner_01";

async function main() {
  if (!ensureAdminInitialized()) {
    console.error(
      "firebase-admin tidak dapat dimulakan. Letak firebase-service-account.json di root projek, " +
        "atau set GOOGLE_APPLICATION_CREDENTIALS, atau jalankan terhadap emulator."
    );
    process.exit(1);
  }

  const db = getAdminFirestore();

  const start = Timestamp.fromDate(new Date(2026, 5, 26, 0, 0, 0));
  const end = Timestamp.fromDate(new Date(2026, 5, 27, 0, 0, 0));

  // Query ikut julat createdAt sahaja, kemudian tapis kind + staffId dalam memori
  // (elak keperluan composite index untuk kind + staffId + createdAt).
  const snap = await db
    .collection("staff_activity")
    .where("createdAt", ">=", start)
    .where("createdAt", "<", end)
    .orderBy("createdAt", "asc")
    .get();

  const rows = snap.docs.filter(function (d) {
    const data = d.data();
    return data.kind === "clock_in" && String(data.staffId) === STAFF_ID;
  });

  console.log("Jumlah clock_in dijumpai:", rows.length);
  rows.forEach(function (d) {
    const at = d.data().createdAt;
    const when = at && typeof at.toDate === "function" ? at.toDate().toLocaleString("ms-MY") : "—";
    console.log("ID:", d.id, "| Masa:", when);
  });

  if (rows.length <= 1) {
    console.log("Tiada clock_in berganda. Selesai.");
    process.exit(0);
  }

  // Kekalkan clock_in PERTAMA sahaja; padam selebihnya.
  const keep = rows[0];
  const toDelete = rows.slice(1);
  console.log("\nAkan delete", toDelete.length, "rekod berganda...");

  for (const d of toDelete) {
    const at = d.data().createdAt;
    const when = at && typeof at.toDate === "function" ? at.toDate().toLocaleString("ms-MY") : "—";
    await db.collection("staff_activity").doc(d.id).delete();
    console.log("Deleted:", d.id, "|", when);
  }

  const keepAt = keep.data().createdAt;
  const keepWhen =
    keepAt && typeof keepAt.toDate === "function" ? keepAt.toDate().toLocaleString("ms-MY") : "—";
  console.log("\nSelesai!");
  console.log("Kekal:", keep.id, "|", keepWhen);

  process.exit(0);
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
