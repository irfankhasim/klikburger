/**
 * Halaman POS standalone (bukan iframe) — pastikan sesi Firebase Auth wujud.
 */
import { waitForAuthUser } from "./pos-firebase-auth-bridge.js";

var LOGIN_PAGE_HREF = new URL("../html/login.html", import.meta.url).href;

export async function redirectIfPosPageWithoutAuth() {
  try {
    if (window.self !== window.top) return;
  } catch (e) {
    return;
  }
  try {
    var u = await waitForAuthUser();
    if (!u) window.location.replace(LOGIN_PAGE_HREF);
  } catch (e) {
    window.location.replace(LOGIN_PAGE_HREF);
  }
}
