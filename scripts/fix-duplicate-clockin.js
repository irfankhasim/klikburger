/**
 * Padam rekod clock_in BERGANDA untuk owner_01 pada Jumaat 26 Jun 2026.
 * Logik: kekalkan clock_in PERTAMA sahaja; buang selebihnya.
 *
 * Nota: projek ini "type": "module" (ESM) dan guna kunci perkhidmatan
 * `firebase-service-account.json` di root (atau GOOGLE_APPLICATION_CREDENTIALS /
 * emulator) melalui helper bersama `./lib/admin-init.mjs` — bukan
 * `serviceAccountKey.json` + require(). Tingkah laku skrip kekal sama.
 *
 * Preview (selamat, tiada padam):
 *   node scripts/fix-duplicate-clockin.js
 *
 * Padam betul (selepas sahkan rekod):
 *   tukar CONFIRM_DELETE = true di bawah, ATAU jalankan dengan flag:
 *   node scripts/fix-duplicate-clockin.js --delete
 */
import { Timestamp } from "firebase-admin/firestore";
import { ensureAdminInitialized, getAdminFirestore } from "./lib/admin-init.mjs";

const STAFF_ID = "owner_01";

// Tukar ke true untuk benar-benar padam (atau guna flag --delete).
let CONFIRM_DELETE = false;
if (process.argv.includes("--delete")) CONFIRM_DELETE = true;

async function main() {
  if (!ensureAdminInitialized()) {
    console.error(
      "firebase-admin tidak dapat dimulakan. Letak firebase-service-account.json di root projek, " +
        "atau set GOOGLE_APPLICATION_CREDENTIALS, atau jalankan terhadap emulator."
    );
    process.exit(1);
  }

  const db = getAdminFirestore();

  // Julat hari: Jumaat 26 Jun 2026 00:00 → 27 Jun 2026 00:00 (waktu tempatan mesin).
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

  console.log("Rekod clock_in " + STAFF_ID + " Jumaat 26 Jun 2026:", rows.length);
  rows.forEach(function (d) {
    const at = d.data().createdAt;
    const when = at && typeof at.toDate === "function" ? at.toDate().toLocaleString() : "—";
    console.log("ID:", d.id, "| Masa:", when);
  });

  if (rows.length <= 1) {
    console.log("Tiada rekod clock_in berganda untuk dipadam.");
    process.exit(0);
  }

  // Kekalkan clock_in PERTAMA; sasaran padam = selebihnya.
  const keep = rows[0];
  const toDelete = rows.slice(1);

  if (!CONFIRM_DELETE) {
    console.log("");
    console.log(
      "[PREVIEW] " +
        toDelete.length +
        " rekod berganda akan dipadam (kekal yang pertama: " +
        keep.id +
        ")."
    );
    toDelete.forEach(function (d) {
      console.log("  akan padam:", d.id);
    });
    console.log("");
    console.log("Untuk padam betul: tukar CONFIRM_DELETE = true, atau jalankan dengan --delete");
    process.exit(0);
  }

  for (const d of toDelete) {
    await db.collection("staff_activity").doc(d.id).delete();
    console.log("Deleted:", d.id);
  }
  console.log("Selesai. Kekal:", keep.id);
  process.exit(0);
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
