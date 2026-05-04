// Creates the custom DevTools panel. The network response body API is only available
// from DevTools extension pages, so the process-mining logic lives in panel.js.
chrome.devtools.panels.create(
  "SFMC Process Miner",
  "icons/icon48.png",
  "panel.html",
  panel => {
    // Keep this callback for future panel lifecycle hooks.
    console.log("[SFMC Process Miner] DevTools panel created", panel);
  }
);
