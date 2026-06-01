/**
 * Sekatan log masuk berperingkat (localStorage, per e-mel).
 * Akaun disekat hanya selepas MAX_FAILS percubaan gagal; tempoh 1 min → maks 1 jam.
 */

export var MAX_FAILS_BEFORE_LOCK = 10;

/** Minit: 1 → 5 → 15 → 30 → 60 (maks) */
var LOCKOUT_MINUTES = [1, 5, 15, 30, 60];

var STORAGE_KEY = "kb_login_lockout_v1";

function readStore() {
  try {
    var raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    var parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (e) {
    return {};
  }
}

function writeStore(store) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch (e) {}
}

export function normalizeLoginEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

function getEntry(store, key) {
  var e = store[key];
  if (!e || typeof e !== "object") {
    return { failCount: 0, lockoutUntil: 0, lockoutTier: 0 };
  }
  return {
    failCount: typeof e.failCount === "number" ? e.failCount : 0,
    lockoutUntil: typeof e.lockoutUntil === "number" ? e.lockoutUntil : 0,
    lockoutTier: typeof e.lockoutTier === "number" ? e.lockoutTier : 0
  };
}

function lockoutDurationMs(tier) {
  var idx = Math.min(Math.max(0, tier), LOCKOUT_MINUTES.length - 1);
  return LOCKOUT_MINUTES[idx] * 60 * 1000;
}

function formatRemaining(ms) {
  var sec = Math.max(0, Math.ceil(ms / 1000));
  if (sec < 60) return sec + " saat";
  var min = Math.ceil(sec / 60);
  if (min < 60) return min + " minit";
  var hr = Math.floor(min / 60);
  var rm = min % 60;
  return rm ? hr + " jam " + rm + " minit" : hr + " jam";
}

/**
 * @param {string} email
 * @returns {{ locked: boolean, remainingMs: number, failCount: number, attemptsLeft: number, lockoutTier: number }}
 */
export function getLoginLockState(email) {
  var key = normalizeLoginEmail(email);
  if (!key) {
    return { locked: false, remainingMs: 0, failCount: 0, attemptsLeft: MAX_FAILS_BEFORE_LOCK, lockoutTier: 0 };
  }
  var entry = getEntry(readStore(), key);
  var now = Date.now();
  if (entry.lockoutUntil > now) {
    return {
      locked: true,
      remainingMs: entry.lockoutUntil - now,
      failCount: entry.failCount,
      attemptsLeft: 0,
      lockoutTier: entry.lockoutTier
    };
  }
  if (entry.lockoutUntil > 0 && entry.lockoutUntil <= now) {
    entry.lockoutUntil = 0;
  }
  var left = Math.max(0, MAX_FAILS_BEFORE_LOCK - entry.failCount);
  return {
    locked: false,
    remainingMs: 0,
    failCount: entry.failCount,
    attemptsLeft: left,
    lockoutTier: entry.lockoutTier
  };
}

/**
 * @param {unknown} err
 * @returns {boolean}
 */
export function isCredentialLoginFailure(err) {
  var code = err && err.code;
  return (
    code === "auth/invalid-credential" ||
    code === "auth/wrong-password" ||
    code === "auth/user-not-found" ||
    code === "auth/invalid-email"
  );
}

/**
 * @param {string} email
 * @returns {{ locked: boolean, remainingMs: number, message: string, failCount: number }}
 */
export function recordLoginFailure(email) {
  var key = normalizeLoginEmail(email);
  var store = readStore();
  var entry = getEntry(store, key);
  var now = Date.now();

  if (entry.lockoutUntil > now) {
    return {
      locked: true,
      remainingMs: entry.lockoutUntil - now,
      message: "Akaun disekat buat sementara. Cuba lagi dalam " + formatRemaining(entry.lockoutUntil - now) + ".",
      failCount: entry.failCount
    };
  }

  entry.failCount += 1;
  entry.lockoutUntil = 0;

  if (entry.failCount >= MAX_FAILS_BEFORE_LOCK) {
    var duration = lockoutDurationMs(entry.lockoutTier);
    entry.lockoutUntil = now + duration;
    entry.failCount = 0;
    entry.lockoutTier = Math.min(entry.lockoutTier + 1, LOCKOUT_MINUTES.length - 1);
    store[key] = entry;
    writeStore(store);
    return {
      locked: true,
      remainingMs: duration,
      message:
        "Terlalu banyak percubaan gagal. Akaun disekat " +
        formatRemaining(duration) +
        ". Selepas itu anda boleh cuba lagi.",
      failCount: MAX_FAILS_BEFORE_LOCK
    };
  }

  store[key] = entry;
  writeStore(store);
  var left = MAX_FAILS_BEFORE_LOCK - entry.failCount;
  return {
    locked: false,
    remainingMs: 0,
    message:
      left <= 3
        ? "E-mel atau kata laluan tidak sah. (" + left + " percubaan lagi sebelum sekatan sementara.)"
        : "E-mel atau kata laluan tidak sah.",
    failCount: entry.failCount
  };
}

/** Reset kiraan selepas log masuk berjaya. */
export function recordLoginSuccess(email) {
  var key = normalizeLoginEmail(email);
  if (!key) return;
  var store = readStore();
  if (!store[key]) return;
  delete store[key];
  writeStore(store);
}

export function lockoutMessageForState(state) {
  if (!state.locked) return "";
  return "Akaun disekat buat sementara. Cuba lagi dalam " + formatRemaining(state.remainingMs) + ".";
}
