/**
 * TOTP (RFC 6238) di pelayar — fallback bila Cloud Function tak dapat cold-start
 * (cth. billing Cloud Run dinyahaktif). Secret masih 20 byte raw, Base32.
 */

var B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(bytes) {
  var out = "";
  var bits = 0;
  var value = 0;
  var i;
  for (i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  var clean = String(str || "")
    .toUpperCase()
    .replace(/=+$/g, "")
    .replace(/[^A-Z2-7]/g, "");
  var bits = 0;
  var value = 0;
  var out = [];
  var i;
  var idx;
  for (i = 0; i < clean.length; i++) {
    idx = B32.indexOf(clean.charAt(i));
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

export function generateTotpSecret() {
  var bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return base32Encode(bytes);
}

export function totpOtpauthUrl(accountName, issuer, secret) {
  var acc = String(accountName || "staff");
  var iss = String(issuer || "Tab Kaunter");
  return (
    "otpauth://totp/" +
    encodeURIComponent(iss) +
    ":" +
    encodeURIComponent(acc) +
    "?secret=" +
    encodeURIComponent(secret) +
    "&issuer=" +
    encodeURIComponent(iss) +
    "&algorithm=SHA1&digits=6&period=30"
  );
}

function counterBytes(counter) {
  var buf = new Uint8Array(8);
  var i;
  for (i = 7; i >= 0; i--) {
    buf[i] = counter & 255;
    counter = Math.floor(counter / 256);
  }
  return buf;
}

function truncateHmac(hmac) {
  var offset = hmac[hmac.length - 1] & 15;
  var bin =
    (((hmac[offset] & 127) * 0x1000000) +
      ((hmac[offset + 1] & 255) * 0x10000) +
      ((hmac[offset + 2] & 255) * 0x100) +
      (hmac[offset + 3] & 255)) >>>
    0;
  return bin % 1000000;
}

async function hotp(secretB32, counter) {
  var keyBytes = base32Decode(secretB32);
  var key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  var sig = await crypto.subtle.sign("HMAC", key, counterBytes(counter));
  var n = truncateHmac(new Uint8Array(sig));
  return String(n).padStart(6, "0");
}

export async function verifyTotpCode(secretB32, code, windowSteps) {
  var want = String(code || "").replace(/\D/g, "");
  if (!/^\d{6}$/.test(want) || !secretB32) return false;
  var secret = String(secretB32).replace(/\s+/g, "").replace(/=+$/g, "");
  var step = 30;
  var now = Math.floor(Date.now() / 1000 / step);
  var w = typeof windowSteps === "number" ? windowSteps : 2;
  var i;
  var got;
  for (i = -w; i <= w; i++) {
    got = await hotp(secret, now + i);
    if (got === want) return true;
  }
  return false;
}
