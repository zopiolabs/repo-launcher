const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync('chrome/panel.js', 'utf8');

async function setup(isPanel, { failOpen = false, failClose = false, failInit = false } = {}) {
  const button = { disabled: true, setAttribute(name, value) { this[name] = value; }, addEventListener(name, callback) { this[name] = callback; } };
  const root = {dataset: {}};
  const calls = [];
  const messages = [];
  const context = vm.createContext({
    URLSearchParams,
    document: { querySelector: () => button, documentElement: root },
    window: { location: {search: isPanel ? '?view=panel' : ''}, close: () => calls.push('popup closed') },
    showStatus: (...args) => messages.push(args),
    chrome: {
      windows: {getCurrent: async () => { if (failInit) throw Error('Unavailable'); return {id: 42}; }},
      sidePanel: {
        open: async options => { calls.push(['open', options.windowId]); if (failOpen) throw Error('Open failed'); },
        close: async options => { calls.push(['close', options.windowId]); if (failClose) throw Error('Close failed'); }
      }
    }
  });
  vm.runInContext(source, context);
  await new Promise(resolve => setImmediate(resolve));
  return {button, root, calls, messages};
}

(async () => {
  const popup = await setup(false);
  assert.equal(popup.root.dataset.view, 'popup');
  assert.equal(popup.button.title, 'Pin to side panel');
  assert.equal(popup.button['aria-pressed'], 'false');
  await popup.button.click();
  assert.deepEqual(popup.calls, [['open', 42], 'popup closed']);
  const panel = await setup(true);
  assert.equal(panel.root.dataset.view, 'panel');
  assert.equal(panel.button.title, 'Unpin and close side panel');
  assert.equal(panel.button['aria-pressed'], 'true');
  await panel.button.click();
  assert.deepEqual(panel.calls, [['close', 42]]);
  const openFailure = await setup(false, {failOpen: true});
  await openFailure.button.click();
  assert.deepEqual(openFailure.calls, [['open', 42]]);
  assert.match(openFailure.messages[0][0], /Could not open/);
  assert.equal(openFailure.button.disabled, false);
  const closeFailure = await setup(true, {failClose: true});
  await closeFailure.button.click();
  assert.match(closeFailure.messages[0][0], /Could not close/);
  assert.equal(closeFailure.button.disabled, false);
  const unavailable = await setup(false, {failInit: true});
  assert.equal(unavailable.button.disabled, true);
  assert.match(unavailable.messages[0][0], /Could not initialize/);
  console.log('PASS: pin opens the current window panel and closes popup, unpin closes panel, view state, initialization and API failures.');
})().catch(error => { console.error(error); process.exitCode = 1; });
