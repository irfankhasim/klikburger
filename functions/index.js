const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

initializeApp();

/**
 * Verify staff clock-in PIN.
 * Called from POS terminal — PIN never sent back to client.
 */
exports.verifyStaffPin = onCall({ region: "asia-southeast1" }, async (request) => {
  // Must be authenticated
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Login diperlukan.");
  }

  const { staffId, pin } = request.data;

  if (!staffId || typeof staffId !== "string") {
    throw new HttpsError("invalid-argument", "staffId diperlukan.");
  }
  if (pin != null && typeof pin !== "string") {
    throw new HttpsError("invalid-argument", "PIN diperlukan.");
  }
  const pinStr = typeof pin === "string" ? pin : "";

  const db = getFirestore();

  try {
    const staffRef = db.collection("staff").doc(staffId);
    const staffSnap = await staffRef.get();

    if (!staffSnap.exists) {
      throw new HttpsError("not-found", "Rekod staf tidak dijumpai.");
    }

    const staffData = staffSnap.data();
    const storedPin = String(staffData.pin || "").trim();

    // If no PIN set, allow clock-in (backward compatible)
    if (!storedPin) {
      return { verified: true, noPin: true };
    }

    // Compare PIN
    if (pinStr.trim() !== storedPin) {
      return { verified: false, error: "PIN tidak betul." };
    }

    return { verified: true };
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    console.error("[verifyStaffPin] error:", err);
    throw new HttpsError("internal", "Ralat semasa semak PIN.");
  }
});
