/**
 * Pasang butang terapung AI Assistant pada semua halaman (frontend mock).
 * Dalam iframe embed (kb-embed), widget hanya pada dokumen induk — elak pendua.
 */
import { mountGlobalAiChatWidget } from "./components/staff-chat-widget.js";

function shouldMountHere() {
  try {
    if (window.self !== window.parent) {
      if (document.documentElement.classList.contains("kb-embed")) {
        return false;
      }
    }
  } catch (e) {
    /* cross-origin iframe — anggap mount */
  }
  return true;
}

function boot() {
  if (!shouldMountHere()) return;
  mountGlobalAiChatWidget();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
