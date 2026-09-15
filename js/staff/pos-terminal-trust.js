/**
 * Peranti yang Owner guna untuk "Guna lokasi semasa" ditanda sebagai terminal POS.
 * Clock-in pada peranti ini = di kaunter. Browser kawan (jauh) tiada tanda ini.
 *
 * SKIP_CLOCK_IN_GEO: sementara — clock in staf hanya 2FA. Set false bila nak hidupkan GPS semula.
 */
export var SKIP_CLOCK_IN_GEO = true;

var KEY = "kb_pos_terminal_v1";

function haversineMeters(lat1, lng1, lat2, lng2) {
  var toRad = function (d) {
    return (d * Math.PI) / 180;
  };
  var dLat = toRad(lat2 - lat1);
  var dLng = toRad(lng2 - lng1);
  var a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function markThisDeviceAsPosTerminal(lat, lng) {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({ lat: Number(lat), lng: Number(lng), at: Date.now() })
    );
  } catch (e) {}
}

export function clearPosTerminalMark() {
  try {
    localStorage.removeItem(KEY);
  } catch (e) {}
}

export function isTrustedPosTerminal(storeLat, storeLng) {
  try {
    var raw = localStorage.getItem(KEY);
    if (!raw) return false;
    var o = JSON.parse(raw);
    var a = Number(o && o.lat);
    var b = Number(o && o.lng);
    if (!isFinite(a) || !isFinite(b) || !isFinite(storeLat) || !isFinite(storeLng)) return false;
    return haversineMeters(a, b, storeLat, storeLng) <= 80;
  } catch (e) {
    return false;
  }
}

export function judgeProximity(storeLat, storeLng, radius, coords, trustedPos) {
  var r = radius > 0 ? radius : 150;
  if (!coords || !isFinite(coords.lat) || !isFinite(coords.lng)) {
    if (trustedPos) return { ok: true, reason: "trusted_pos" };
    return { ok: false, errorCode: "gps_required" };
  }
  var acc = typeof coords.accuracy === "number" && isFinite(coords.accuracy) ? coords.accuracy : 99999;
  var dist = haversineMeters(coords.lat, coords.lng, storeLat, storeLng);
  if (dist - acc > r) return { ok: false, errorCode: "too_far" };
  if (dist + acc <= r) return { ok: true, reason: "gps" };
  if (trustedPos) return { ok: true, reason: "trusted_pos" };
  return { ok: false, errorCode: "gps_inaccurate" };
}
