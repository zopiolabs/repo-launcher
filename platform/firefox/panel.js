"use strict";

const isPanel = new URLSearchParams(window.location.search).get("view") === "panel";
const pinButton = document.querySelector("#pin-button");
document.documentElement.dataset.view = isPanel ? "panel" : "popup";
pinButton.title = isPanel ? "Unpin and close sidebar" : "Pin to sidebar";
pinButton.setAttribute("aria-label", pinButton.title);
pinButton.setAttribute("aria-pressed", String(isPanel));
pinButton.disabled = false;

pinButton.addEventListener("click", async () => {
  if (pinButton.disabled) return;
  pinButton.disabled = true;
  try {
    if (isPanel) {
      await browser.sidebarAction.close();
    } else {
      // Firefox requires this call directly within a user action handler.
      await browser.sidebarAction.open();
      window.close();
    }
  } catch {
    showStatus(isPanel ? "Could not close the sidebar. Please try again." : "Could not open the sidebar. Please try again.", true);
  } finally {
    pinButton.disabled = false;
  }
});
