"use strict";

const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const source = fs.readFileSync("firefox/panel.js", "utf8");

function setup(isPanel, fail = false) {
  const calls = [];
  const errors = [];
  const button = { disabled: true, setAttribute(name, value) { this[name] = value; }, addEventListener(name, callback) { this[name] = callback; } };
  const root = { dataset: {} };
  let inClick = false;
  const context = vm.createContext({
    URLSearchParams,
    window: { location: { search: isPanel ? "?view=panel" : "" }, close: () => calls.push("popup closed") },
    document: { querySelector: () => button, documentElement: root },
    showStatus: (...args) => errors.push(args),
    browser: { sidebarAction: {
      open: async (...args) => {
        assert.equal(inClick, true, "Sidebar must open synchronously within the click handler");
        assert.equal(args.length, 0);
        calls.push("open");
        if (fail) throw Error("Open failed");
      },
      close: async (...args) => {
        assert.equal(inClick, true);
        assert.equal(args.length, 0);
        calls.push("close");
        if (fail) throw Error("Close failed");
      }
    } }
  });
  vm.runInContext(source, context);
  return { button, root, calls, errors, click: async () => {
    inClick = true;
    const pending = button.click();
    inClick = false;
    await pending;
  } };
}

(async () => {
  const popup = setup(false);
  assert.equal(popup.button.disabled, false);
  assert.equal(popup.button["aria-pressed"], "false");
  assert.equal(popup.root.dataset.view, "popup");
  await popup.click();
  assert.deepEqual(popup.calls, ["open", "popup closed"]);
  const panel = setup(true);
  assert.equal(panel.button["aria-pressed"], "true");
  assert.equal(panel.root.dataset.view, "panel");
  await panel.click();
  assert.deepEqual(panel.calls, ["close"]);
  for (const isPanel of [false, true]) {
    const failed = setup(isPanel, true);
    await failed.click();
    assert.equal(failed.calls.includes("popup closed"), false);
    assert.equal(failed.button.disabled, false);
    assert.equal(failed.errors[0][1], true);
  }
  console.log("PASS: Firefox pin/unpin, synchronous user gesture calls, popup and sidebar state, failure recovery.");
})().catch(error => { console.error(error); process.exitCode = 1; });
