/**
 * Cermin clock in/out POS ke koleksi staff_activity (Firestore) untuk paparan BO.
 * staffId = `operationalStaffId` jika pekerja pilih rekod `staff` di terminal kongsi;
 * jika tidak, guna `userId` sesi (UID Auth — biasanya akaun staff kongsi).
 *
 * Ketahanan (reliability): tulisan clock TIDAK boleh hilang secara senyap.
 * Jika tulisan Firestore gagal (rangkaian/auth belum sedia), peristiwa disimpan
 * dalam baris gilir localStorage dan dicuba semula (flush) pada tindakan clock
 * berikutnya, semasa modul dimuat, dan apabila sambungan kembali (online).
 * Setiap peristiwa membawa `atMs` (masa sebenar) supaya rekod kehadiran kekal
 * tepat walaupun tulisan tertangguh.
 */
import { appendStaffActivity } from "./staff-repository.js";

var QUEUE_KEY = "kb_pending_clock_activity_v1";
var MAX_QUEUE = 100;
var flushing = false;

function loadQueue() {
  try {
    var raw = localStorage.getItem(QUEUE_KEY);
    var arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

function saveQueue(arr) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(arr.slice(-MAX_QUEUE)));
  } catch (e) {
    /* storan penuh / tidak tersedia — abaikan */
  }
}

function enqueue(entry) {
  var arr = loadQueue();
  arr.push(entry);
  saveQueue(arr);
}

/** Bina entri `staff_activity` daripada sesi POS (segerak — tangkap nilai sesi semasa). */
function buildEntry(opts) {
  var s = (opts && opts.session) || {};
  var kind = opts && opts.kind === "clock_out" ? "clock_out" : "clock_in";
  var opId = String(s.operationalStaffId || "").trim();
  var staffId = opId ? opId : String(s.userId || "");
  var staffName = opId
    ? String(s.operationalStaffName || "").trim() || String(s.displayName || "")
    : String(s.displayName || "");
  var atMs = opts && typeof opts.atMs === "number" && isFinite(opts.atMs) ? opts.atMs : Date.now();
  return {
    staffId: staffId,
    staffName: staffName,
    kind: kind,
    saleId: "",
    detail: JSON.stringify({
      source: "pos_clock",
      role: String(s.role || ""),
      email: String(s.email || ""),
      at: new Date(atMs).toISOString()
    }),
    subtotal: null,
    orderCount: null,
    atMs: atMs
  };
}

/**
 * Cuba tulis semula semua peristiwa tertangguh (FIFO). Berhenti pada kegagalan
 * pertama supaya tertib dikekalkan dan tidak membebankan rangkaian.
 */
export function flushPendingClockActivity() {
  if (flushing) return Promise.resolve();
  var queue = loadQueue();
  if (!queue.length) return Promise.resolve();
  flushing = true;

  function step() {
    var current = loadQueue();
    if (!current.length) return Promise.resolve();
    var entry = current[0];
    return appendStaffActivity(entry).then(
      function () {
        var rest = loadQueue();
        rest.shift();
        saveQueue(rest);
        return step();
      },
      function (e) {
        console.warn("[clock] flush tertangguh:", e && e.message ? e.message : e);
        return Promise.resolve();
      }
    );
  }

  return step().then(
    function () {
      flushing = false;
    },
    function () {
      flushing = false;
    }
  );
}

/**
 * @param {{ kind: 'clock_in'|'clock_out', atMs?: number, session: { userId?: string, displayName?: string, email?: string, role?: string, operationalStaffId?: string, operationalStaffName?: string } }} opts
 */
export async function recordPosClockStaffActivity(opts) {
  var s = opts && opts.session;
  if (!s || !s.userId) return;
  var entry = buildEntry(opts);

  console.info("[clock-attendance] Recording:", {
    kind: entry.kind,
    staffId: entry.staffId,
    staffName: entry.staffName,
    operationalStaffId: String(s.operationalStaffId || "").trim(),
    userId: String(s.userId || ""),
    displayName: String(s.displayName || "")
  });

  // Tulis peristiwa semasa dahulu; selepas berjaya, baru kosongkan baki gilir.
  try {
    await appendStaffActivity(entry);
    await flushPendingClockActivity();
  } catch (e) {
    console.warn(
      "[staff_activity] clock mirror gagal — disimpan untuk cuba semula:",
      e && e.message ? e.message : e
    );
    enqueue(entry);
  }
}

/** Cuba flush apabila sambungan kembali. */
if (typeof window !== "undefined" && window.addEventListener) {
  window.addEventListener("online", function () {
    flushPendingClockActivity();
  });
}
