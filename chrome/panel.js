"use strict";

const isPanel = new URLSearchParams(window.location.search).get("view") === "panel";
const pinButton = document.querySelector("#pin-button");
document.documentElement.dataset.view = isPanel ? "panel" : "popup";
pinButton.title = isPanel ? "Unpin and close side panel" : "Pin to side panel";
pinButton.setAttribute("aria-label", pinButton.title);
pinButton.setAttribute("aria-pressed", String(isPanel));

let panelWindowId;

chrome.windows.getCurrent().then(currentWindow => {
  panelWindowId = currentWindow.id;
  pinButton.disabled = false;
}).catch(() => showStatus("Could not initialize the pin button. Reopen the extension to retry.", true));

pinButton.addEventListener("click", async () => {
  if (pinButton.disabled || panelWindowId === undefined) return;
  pinButton.disabled = true;
  try {
    if (isPanel) {
      await chrome.sidePanel.close({ windowId: panelWindowId });
    } else {
      // Call directly from the click handler to preserve the user gesture.
      await chrome.sidePanel.open({ windowId: panelWindowId });
      window.close();
    }
  } catch {
    showStatus(isPanel ? "Could not close the side panel. Please try again." : "Could not open the side panel. Please try again.", true);
  } finally {
    pinButton.disabled = false;
  }
});
