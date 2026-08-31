/**
 * Owner — pangkalan pengetahuan AI (editor teks tunggal).
 */
import { mountKnowledgeBase } from "./components/knowledge-base.js";
import { waitForAuthUser } from "../pos-firebase-auth-bridge.js";

function showLoadError(root, message) {
  root.innerHTML =
    '<div class="sd-status sd-status--err">' +
    '<p class="bs-settings__load-error"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> ' +
    message +
    "</p>" +
    '<p class="sd-footnote">Pastikan anda log masuk sebagai owner/admin.</p></div>';
  root.removeAttribute("aria-busy");
}

export async function bootOwnerAiAssistant() {
  var root = document.getElementById("ai-root");
  if (!root) return;

  var user = await waitForAuthUser();
  if (!user) {
    showLoadError(
      root,
      "Sesi log masuk tidak dijumpai. Sila log masuk semula, kemudian buka Pangkalan data."
    );
    return;
  }

  root.innerHTML = "";
  root.removeAttribute("aria-busy");
  mountKnowledgeBase(root, {
    onItemsChange: function () {}
  });
}

bootOwnerAiAssistant();
