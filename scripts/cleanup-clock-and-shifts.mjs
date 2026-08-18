/**
 * Pembersihan data untuk mula bersih:
 *   1) Padam SEMUA rekod Clock In / Clock Out dalam `staff_activity`
 *      (hanya kind === "clock_in" | "clock_out" — rekod lain dikekalkan).
 *   2) Padam SEMUA rekod Drawer Tunai / penutupan shift dalam `pos_shifts`.
 *
 * Struktur koleksi TIDAK terjejas — hanya dokumen dipadam.
 *
 * Jalankan: node scripts/cleanup-clock-and-shifts.mjs
 */
import { ensureAdminInitialized, getAdminFirestore } from "./lib/admin-init.mjs";

const BATCH_LIMIT = 400;

async function deleteDocs(db, docs, label) {
  let removed = 0;
  for (let i = 0; i < docs.length; i += BATCH_LIMIT) {
    const slice = docs.slice(i, i + BATCH_LIMIT);
    const batch = db.batch();
    slice.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    removed += slice.length;
    console.log(`[${label}] dipadam ${removed}/${docs.length}`);
  }
  return removed;
}

async function main() {
  if (!ensureAdminInitialized()) {
    console.error(
      "firebase-admin tidak dapat dimulakan. Sediakan firebase-service-account.json " +
        "di root repo atau set GOOGLE_APPLICATION_CREDENTIALS."
    );
    process.exit(1);
  }

  const db = getAdminFirestore();

  // 1) staff_activity — clock_in / clock_out sahaja
  const actSnap = await db.collection("staff_activity").get();
  const clockDocs = actSnap.docs.filter((d) => {
    const k = d.data().kind;
    return k === "clock_in" || k === "clock_out";
  });
  console.log(
    `staff_activity: jumpa ${clockDocs.length} rekod clock_in/clock_out ` +
      `(daripada ${actSnap.size} jumlah dokumen).`
  );
  const clocksRemoved = clockDocs.length
    ? await deleteDocs(db, clockDocs, "clock")
    : 0;

  // 2) pos_shifts — semua dokumen
  const shiftSnap = await db.collection("pos_shifts").get();
  console.log(`pos_shifts: jumpa ${shiftSnap.size} rekod shift.`);
  const shiftsRemoved = shiftSnap.size
    ? await deleteDocs(db, shiftSnap.docs, "shift")
    : 0;

  console.log("------------------------------------------------------------");
  console.log(`SELESAI. clock_in/clock_out dipadam: ${clocksRemoved}`);
  console.log(`SELESAI. pos_shifts dipadam:        ${shiftsRemoved}`);
  console.log("Struktur koleksi kekal utuh.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
