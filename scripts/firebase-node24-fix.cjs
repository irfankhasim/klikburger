/* Workaround Node 24.17 + node-fetch "Premature close" during firebase deploy. */
try {
  require("http").globalAgent.keepAlive = false;
  require("https").globalAgent.keepAlive = false;
} catch (e) {}
