/**
 * Owner — pangkalan pengetahuan AI (editor teks tunggal).
 */
import { mountKnowledgeBase } from "./components/knowledge-base.js";
import { waitForAuthUser } from "../pos-firebase-auth-bridge.js";

function showLoadError(root, message) {
  root.innerHTML =
    '<div class="ai-app ai-app--error">' +
    '<p class="ai-kb-load-error"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> ' +
    message +
    "</p>" +
    '<p class="ai-kb-load-error__hint">Pastikan anda log masuk sebagai owner/admin.</p>' +
    "</div>";
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
    document.body.classList.remove("ai-boot");
    return;
  }

  root.innerHTML =
    '<div class="ai-app ai-app--editor"><section class="ai-panel ai-panel--solo" data-ai-panel="kb"></section></div>';

  var kbPanel = root.querySelector('[data-ai-panel="kb"]');
  mountKnowledgeBase(kbPanel, {
    onItemsChange: function () {}
  });

  document.body.classList.remove("ai-boot");
}

bootOwnerAiAssistant();
