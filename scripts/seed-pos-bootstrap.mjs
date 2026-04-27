#!/usr/bin/env node
/**
 * Inisialisasi dokumen POS: pos_meta/counters, drawer contoh (tutup), audit contoh (pilihan).
 */
import { pathToFileURL } from "url";
import admin from "firebase-admin";
import { ensureAdminInitialized, getAdminFirestore, isEmulatorEnv } from "./lib/admin-init.mjs";

var FieldValue = admin.firestore.FieldValue;
var Timestamp = admin.firestore.Timestamp;

export async function seedPosBootstrap(options) {
  options = options || {};
  var withSampleShift = options.withSampleShift !== false;
  var withSampleAudit = options.withSampleAudit === true;

  if (!ensureAdminInitialized()) {
    throw new Error("Admin SDK tidak sedia.");
  }
  var db = getAdminFirestore();

  var countersRef = db.collection("pos_meta").doc("counters");
  await countersRef.set(
    {
      seqOrder: 1000,
      seqReceipt: 1000,
      activeShiftDocId: null,
      updatedAt: FieldValue.serverTimestamp()
    },
    { merge: true }
  );
  console.log("  pos_meta/counters");

  if (withSampleShift) {
    var shiftRef = db.collection("pos_shifts").doc();
    await shiftRef.set({
      shiftCode: "SEED-DEMO",
      status: "closed",
      openedAt: Timestamp.fromMillis(Date.now() - 86400000),
      closedAt: Timestamp.fromMillis(Date.now() - 3600000),
      openingCash: 200,
      closing: {
        closedAt: new Date(Date.now() - 3600000).toISOString(),
        expectedDrawer: 200,
        countedCash: 200,
        variance: 0,
        note: "Drawer contoh — seed terminal"
      },
      openedByUserId: "seed",
      openedByDisplayName: "Seed",
      openedByRole: "owner",
      openedWithOwnerBypass: false,
      updatedAt: FieldValue.serverTimestamp(),
      seeded: true
    });
    console.log("  pos_shifts sample (closed):", shiftRef.id);
  }

  if (withSampleAudit) {
    await db.collection("pos_audit_logs").add({
      at: FieldValue.serverTimestamp(),
      type: "seed",
      message: "Bootstrap POS dari skrip terminal",
      userId: "system",
      userName: "setup",
      role: "system",
      meta: { emulator: isEmulatorEnv() }
    });
    console.log("  pos_audit_logs sample");
  }
}

async function main() {
  console.log("Seed POS bootstrap …");
  await seedPosBootstrap({ withSampleShift: true, withSampleAudit: false });
  console.log("OK — POS bootstrap siap.");
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
