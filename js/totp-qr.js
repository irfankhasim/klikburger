/** Render kod QR TOTP (otpauth:// URI) ke dalam satu elemen DOM, guna js/vendor/qrcode-generator.mjs. */
import qrcode from "./vendor/qrcode-generator.mjs";

export function renderTotpQrCode(container, otpauthUrl) {
  if (!container || !otpauthUrl) return;
  var qr = qrcode(0, "M");
  qr.addData(otpauthUrl);
  qr.make();
  container.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2 });
}
