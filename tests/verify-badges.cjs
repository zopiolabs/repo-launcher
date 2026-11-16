"use strict";

const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const firefox = process.argv.includes('--firefox');
const extensionDirectory = firefox ? 'firefox' : 'chrome';
const commonSource = fs.readFileSync(`${extensionDirectory}/github-counts.js`, "utf8");
const badgeSource = fs.readFileSync(`${extensionDirectory}/badges.js`, "utf8");
const root = "https://github.com/team/project";
const prefix = "github-counts:exclude-dependabot-prs-critical-high-v1:";

class Element {
  constructor() { this.children = []; this.dataset = {}; this.listeners = {}; }
  append(child) { this.children.push(child); }
  setAttribute(name, value) { this[name] = value; }
  addEventListener(name, callback) { this.listeners[name] = callback; }
}

async function setup({initial = {}, signedIn = true, fail = false, readerPolicy = "exclude-dependabot-prs-critical-high-v1", result = {pulls: 0, issues: 123, dependabot: null}} = {}) {
  const refresh = new Element();
  const saved = {...initial};
  const requests = [];
  let now = 1800000000000;
  let storageListener;
  let timer = 0;
  const scheduled = new Map();
  class Clock extends Date { static now() { return now; } }
  const ctx = vm.createContext({
    URL, Date: Clock,
    document: {hidden: false, querySelector: () => refresh, createElement: () => new Element(), addEventListener() {}},
    window: {},
    setTimeout: (callback, delay) => { const id = ++timer; if (delay === 700) Promise.resolve().then(callback); else scheduled.set(id, callback); return id; },
    clearTimeout: id => scheduled.delete(id),
    setInterval() {},
    [firefox ? 'browser' : 'chrome']: {
      windows: {getCurrent: async () => ({id: 42})},
      tabs: {
        query: async options => { assert.equal(options.windowId, 42); assert.equal(options.url, "https://github.com/*"); return [{id: 101, active: true}]; },
        sendMessage: async (id, message) => {
          assert.equal(id, 101);
          requests.push(message);
          if (message.type === "github-session-status") return {signedIn, policy: readerPolicy};
          if (fail) throw Error("Reader unavailable");
          return {...result, reason: "unreadable"};
        }
      },
      storage: {
        session: { get: async () => saved, set: async value => { Object.assign(saved, value); } },
        onChanged: {addListener(callback) {storageListener = callback;}}
      }
    }
  });
  vm.runInContext(commonSource, ctx);
  vm.runInContext(badgeSource, ctx);
  await new Promise(resolve => setImmediate(resolve));
  function bind(repository = root) {
    ctx.window.repoBadges.beginRender();
    const links = ["PR", "Issues", "Dependabot"].map(label => {
      const link = new Element();
      link.title = label;
      ctx.window.repoBadges.bind(link, repository, {label, description: label});
      return link;
    });
    ctx.window.repoBadges.endRender();
    return links;
  }
  return {
    bind, refresh, saved, requests,
    runScheduled: async () => { const callbacks = [...scheduled.values()]; scheduled.clear(); for (const callback of callbacks) await callback(); },
    advance: milliseconds => {now += milliseconds;},
    external: entry => storageListener({[prefix + root]: {newValue: entry}}, "session")
  };
}

(async () => {
  const app = await setup();
  let links = app.bind();
  assert.deepEqual(links.map(link => link.children[0].textContent), ["—", "—", "—"]);
  assert.deepEqual(links.map(link => link.children[0].dataset.kind), ["pulls", "issues", "dependabot"]);
  await app.refresh.listeners.click();
  assert.deepEqual(links.map(link => link.children[0].textContent), ["0", "99+", "—"]);
  assert.deepEqual(links.map(link => link.children[0].hidden), [true, false, false]);
  assert.deepEqual(links.map(link => link.dataset.zero), ['true', 'false', 'false']);
  assert.match(links[0].title, /0 open/);
  assert.match(links[1].title, /123 open/);
  assert.match(links[2]["aria-label"], /count unavailable/);
  assert.equal(app.saved[prefix + root].pulls, 0);
  assert.equal(app.saved[prefix + root].dependabot, null);
  assert.match(links[0].title, /excluding Dependabot/);
  assert.equal(app.refresh.disabled, false);
  links = app.bind(`${root}/pulls`);
  assert.equal(links[0].children[0].textContent, "0");
  app.external({pulls: 8, issues: 4, dependabot: 2, reason: "ok", updatedAt: 1800000000000});
  assert.deepEqual(links.map(link => link.children[0].textContent), ["8", "4", "2"]);
  assert.deepEqual(links.map(link => link.children[0].hidden), [false, false, false]);
  assert.deepEqual(links.map(link => link.dataset.zero), ['false', 'false', 'false']);
  app.advance(6 * 60 * 1000);
  links = app.bind();
  assert.deepEqual(links.map(link => link.children[0].textContent), ["—", "—", "—"]);
  assert.deepEqual(links.map(link => link.children[0].hidden), [false, false, false]);
  assert.deepEqual(links.map(link => link.dataset.zero), ['false', 'false', 'false']);

  const fresh = await setup({initial: {[prefix + root]: {pulls: 3, issues: 2, dependabot: 1, reason: "ok", updatedAt: 1800000000000}}});
  const freshLinks = fresh.bind();
  await fresh.runScheduled();
  assert.equal(fresh.requests.filter(request => request.type === "read-github-counts").length, 0);
  assert.equal(freshLinks[0].children[0].textContent, "3");
  await fresh.refresh.listeners.click();
  assert.equal(fresh.requests.filter(request => request.type === "read-github-counts").length, 1);

  const noSession = await setup({signedIn: false, initial: {[prefix + root]: {pulls: 3, issues: 2, dependabot: 1, reason: "ok", updatedAt: 1800000000000}}});
  const missingLinks = noSession.bind();
  await noSession.refresh.listeners.click();
  assert.deepEqual(missingLinks.map(link => link.children[0].textContent), ["—", "—", "—"]);
  assert.equal(noSession.requests.filter(request => request.type === "read-github-counts").length, 0);
  assert.match(noSession.refresh.title, /signed-in GitHub tab/);

  const failure = await setup({fail: true});
  const failedLinks = failure.bind();
  await failure.refresh.listeners.click();
  assert.deepEqual(failedLinks.map(link => link.children[0].textContent), ["—", "—", "—"]);
  assert.match(failedLinks[0].title, /reader disconnected/);
  const diagnosed = await setup({result: {pulls: null, issues: null, dependabot: null, diagnostics: {pulls: 'counter-not-found', issues: 'http-404', dependabot: 'http-403'}}});
  const diagnosedLinks = diagnosed.bind();
  await diagnosed.refresh.listeners.click();
  assert.match(diagnosedLinks[0].title, /counter could not be identified/);
  assert.match(diagnosedLinks[1].title, /404/);
  assert.match(diagnosedLinks[2].title, /403/);
  const disabledSecurity = await setup({result: {pulls: 0, issues: 0, dependabot: null, diagnostics: {dependabot: "dependabot-disabled"}}});
  const disabledLinks = disabledSecurity.bind();
  await disabledSecurity.refresh.listeners.click();
  assert.equal(disabledLinks[2].children[0].textContent, "—");
  assert.match(disabledLinks[2].title, /Dependabot alerts are disabled/);
  // An old page reader cannot supply counts under the new criteria.
  const oldReader = await setup({readerPolicy: 'old-policy'});
  const oldReaderLinks = oldReader.bind();
  await oldReader.refresh.listeners.click();
  assert.deepEqual(oldReaderLinks.map(link => link.children[0].textContent), ['—', '—', '—']);
  assert.match(oldReaderLinks[0].title, /reader did not respond/);
  const legacyCache = await setup({initial: {['github-counts:' + root]: {pulls: 99, issues: 99, dependabot: 99, reason: 'ok', updatedAt: 1800000000000}}});
  assert.deepEqual(legacyCache.bind().map(link => link.children[0].textContent), ['—', '—', '—']);
  const external = await setup();
  const externalLinks = external.bind("https://git.example.com/team/project");
  assert.deepEqual(externalLinks.map(link => link.children[0].textContent), ["—", "—", "—"]);
  console.log("PASS: unknown badges, explicit zero, 99+ and exact tooltips, cache reuse, expiry, manual refresh, session absence, reader errors, cross-view cache updates and unsupported hosts.");
})().catch(error => { console.error(error); process.exitCode = 1; });
