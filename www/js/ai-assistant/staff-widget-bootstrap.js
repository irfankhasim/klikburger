/**
 * Bootstrap dari main-menu shell (sama tingkah laku seperti global-widget-bootstrap).
 */
import { mountGlobalAiChatWidget } from "./components/staff-chat-widget.js";

var mounted = false;

export function bootstrapStaffAiWidget() {
  if (mounted) return;
  try {
    if (window.self !== window.parent && document.documentElement.classList.contains("kb-embed")) {
      return;
    }
  } catch (e) {}
  mounted = true;
  mountGlobalAiChatWidget();
}
