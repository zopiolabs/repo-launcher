"use strict";

const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const firefox = process.argv.includes('--firefox');
const extensionDirectory = firefox ? 'firefox' : 'chrome';
const extensionOrigin = firefox ? 'moz-extension://fixture-extension' : 'chrome-extension://fixture-extension';
const commonSource = fs.readFileSync(`${extensionDirectory}/github-counts.js`, "utf8");
const readerSource = fs.readFileSync(`${extensionDirectory}/github-reader.js`, "utf8");
const root = "https://github.com/team/project";
const pullsQuery = "is:pr is:open -author:app/dependabot";
const securityQuery = "is:open severity:critical,high";

function element(text, attributes = {}, counter = null) {
  return {
    textContent: text,
    getAttribute: name => attributes[name] ?? null,
    hasAttribute: name => Object.hasOwn(attributes, name),
    querySelector: () => counter,
    hidden: false
  };
}

function page({ signedIn = true, navKind, navCount, controls = [], modernNav = false, query = "", headings = [], results = [] } = {}) {
  const meta = element("", { content: signedIn ? "fixture-user" : "" });
  const main = { querySelectorAll: selector => selector.includes('results-count') ? results : controls };
  const nav = navKind ? element("", { href: `/team/project/${navKind}` }, navCount) : null;
  return {
    body: { classList: { contains: () => false } },
    querySelectorAll: selector => selector === "main h2, main h3" ? headings : modernNav && nav ? [nav] : [],
    querySelector: selector => selector.includes("repo-pulls-dashboard-filter-input") || selector.includes("issues-index-filter-input") || selector === "#dependabot-alert-list-filterbar-input" ? element("", {value: query})
      : selector === 'meta[name="user-login"]' ? meta
      : selector === "main" ? main
        : selector === "#pull-requests-tab" && navKind === "pulls" && !modernNav ? nav
          : selector === "#issues-tab" && navKind === "issues" && !modernNav ? nav : null
  };
}

const context = vm.createContext({ URL });
vm.runInContext(commonSource, context);
const api = context.GitHubCounts;
assert.equal(api.rootFor("https://github.com/TEAM/Project/pulls?q=is%3Aopen"), root);
assert.equal(api.rootFor("https://github.com/team/project.git"), root);
for (const invalid of ["https://github.com.evil.test/team/project", "http://github.com/team/project", "https://user:secret@github.com/team/project", "https://github.com/team", "https://github.com/team/%2fescape", "javascript:alert(1)"]) assert.equal(api.rootFor(invalid), null, invalid);
for (const [input, expected] of [["0", 0], ["12", 12], ["1,234", 1234], ["1 234", 1234], ["1\u202f234", 1234], ["1.2k", null], ["99+", null], ["-1", null], ["1,2", null], ["", null], ["9007199254740992", null]]) assert.equal(api.exactNumber(input), expected, input);
assert.equal(api.readOpenCount(page({ navKind: "pulls", navCount: element("1.2k", {title: "1,234"}) }), root, "pulls"), 1234);
assert.equal(api.readOpenCount(page({ navKind: "issues", navCount: element("0") }), root, "issues"), 0);
assert.equal(api.readOpenCount(page({ modernNav: true, navKind: "pulls", navCount: element("1") }), root, "pulls"), 1);
assert.equal(api.readOpenCount(page({ modernNav: true, navKind: "issues", navCount: element("24") }), root, "issues"), 24);
assert.equal(api.readOpenCount(page({ navKind: "pulls", navCount: element("1.2k") }), root, "pulls"), null);
// With zero issues, GitHub omits the navigation badge and renders an active hash link.
function currentIssueControl(count, attributes = {}) {
  return element(`Open${count}\u00a0(${count})`, {href: "#", "aria-current": "true", ...attributes}, element(String(count)));
}
for (const count of [0, 8]) {
  assert.equal(api.readOpenCount(page({modernNav: true, navKind: "issues", controls: [currentIssueControl(count)], query: "is:issue state:open"}), root, "issues"), count);
}
for (const query of ["", "is:issue state:closed", "is:issue state:open assignee:@me"]) {
  assert.equal(api.readOpenCount(page({controls: [currentIssueControl(0)], query}), root, "issues"), null);
}
assert.equal(api.readOpenCount(page({controls: [currentIssueControl(0, {"aria-current": "false"})], query: "is:issue is:open"}), root, "issues"), null);
assert.equal(api.readOpenCount(page({controls: [currentIssueControl(0, {href: "/other/project/issues#"})], query: "is:issue is:open"}), root, "issues"), null);
// Observed advanced-search markup: <h2><span data-testid="results-count">0<!-- --> <!-- -->results</span></h2>.
// There are no Open/Closed controls and zero has no repository navigation badge.
for (const [text, expected] of [["0 results", 0], ["1 result", 1], ["1,234 results", 1234], ["1.2k results", null], ["99+ results", null]]) {
  assert.equal(api.readOpenCount(page({query: "is:issue is:open", results: [element(text)]}), root, "issues"), expected);
}
for (const query of ["", "is:issue is:closed", "is:issue is:open assignee:@me"]) {
  assert.equal(api.readOpenCount(page({query, results: [element("0 results")]}), root, "issues"), null);
}
assert.equal(api.readOpenCount(page({signedIn: false, query: "is:issue is:open", results: [element("0 results")]}), root, "issues"), null);
assert.equal(api.readOpenCount(page({query: "is:issue is:open", results: [element("0 results", {"aria-busy": "true"})]}), root, "issues"), null);
assert.equal(api.readOpenCount(page({query: securityQuery, results: [element("0 results")]}), root, "dependabot", securityQuery), null);
const openControl = element("7 Open", {href: "/team/project/security/dependabot?q=is%3Aopen"});
const closedControl = element("99 Closed", {href: "/team/project/security/dependabot?q=is%3Aclosed"});
const otherRepository = element("82 Open", {href: "/other/project/security/dependabot?q=is%3Aopen"});
const modernOpen = element("Open0 (0)", {href: "/team/project/security/dependabot?q=is%3Aopen"});
modernOpen.querySelector = selector => selector.includes('data-component="text"') ? element("Open")
  : selector.includes("CounterLabel") ? element("0") : null;
assert.equal(api.readOpenCount(page({controls: [modernOpen]}), root, "dependabot"), 0);
assert.equal(api.readOpenCount(page({controls: [closedControl, otherRepository, openControl]}), root, "dependabot"), 7);
assert.equal(api.readOpenCount(page({controls: [closedControl]}), root, "dependabot"), null);
assert.equal(api.readOpenCount(page({controls: [element("12 Open", {href: "?q=is%3Aopen"})]}), root, "dependabot"), 12);
assert.equal(api.readOpenCount(page({signedIn: false, controls: [openControl]}), root, "dependabot"), null);
assert.equal(api.readOpenCount(page({controls: [element("Open 0", {href: "/team/project/security/dependabot?q=is%3Aopen"})]}), root, "dependabot"), 0);
assert.equal(api.readOpenCount(page({controls: [element("Open 1.2k", {href: "/team/project/security/dependabot?q=is%3Aopen"})]}), root, "dependabot"), null);
const filteredPrControl = element("1 Open", {href: "/team/project/pulls?q=is%3Apr+state%3Aopen+-author%3Aapp%2Fdependabot"});
function currentPrControl(count) {
  const control = element(`Open${count}\u00a0(${count})`, {href: "/team/project/pulls?q=is%3Apr+state%3Aopen+-author%3Aapp%2Fdependabot"});
  control.querySelector = selector => selector.includes("CounterLabel") ? element(String(count)) : null;
  return control;
}
for (const count of [0, 1, 12]) {
  assert.equal(api.readOpenCount(page({modernNav: true, navKind: "pulls", navCount: element("99"), controls: [currentPrControl(count)], query: pullsQuery}), root, "pulls", pullsQuery), count);
}
assert.equal(api.readOpenCount(page({modernNav: true, navKind: "pulls", navCount: element("3"), controls: [filteredPrControl], query: pullsQuery}), root, "pulls", pullsQuery), 1);
assert.equal(api.readOpenCount(page({modernNav: true, navKind: "pulls", navCount: element("3"), controls: [filteredPrControl], query: "is:pr is:open"}), root, "pulls", pullsQuery), null);
assert.equal(api.readOpenCount(page({controls: [modernOpen], query: securityQuery}), root, "dependabot", securityQuery), 0);
assert.equal(api.readOpenCount(page({controls: [modernOpen], query: "is:open severity:high,critical"}), root, "dependabot", securityQuery), 0);
assert.equal(api.readOpenCount(page({controls: [openControl], query: "is:open"}), root, "dependabot", securityQuery), null);
assert.equal(api.readOpenCount(page({controls: [openControl], query: "is:open severity:critical,high,medium"}), root, "dependabot", securityQuery), null);

async function reader({loggedIn = true, saved = [root], failKind = "", loginRedirect = false, modern = false, disabledSecurity = false, zeroIssues = false, advancedIssues = false} = {}) {
  let listener;
  const requests = [];
  const pages = {
    pulls: page({navKind: "pulls", navCount: element("99"), modernNav: modern, query: pullsQuery, controls: [modern ? currentPrControl(4) : element("4 Open", {href: "/team/project/pulls?q=is%3Apr+state%3Aopen+-author%3Aapp%2Fdependabot"})]}),
    issues: page({navKind: "issues", navCount: element("2"), modernNav: modern}),
    dependabot: page({controls: [modern ? modernOpen : openControl], query: securityQuery})
  };
  if (zeroIssues) pages.issues = page({navKind: "issues", modernNav: true, controls: [currentIssueControl(0)], query: "is:issue state:open"});
  if (advancedIssues) pages.issues = page({navKind: "issues", modernNav: true, query: "is:issue is:open", results: [element("0 results")]});
  if (disabledSecurity) pages.dependabot = page({headings: [element("Dependabot alerts are disabled.")]});
  const ctx = vm.createContext({
    URL, Date, AbortSignal,
    document: page({signedIn: loggedIn}),
    DOMParser: class { parseFromString(html) { return pages[html]; } },
    fetch: async (url, options) => {
      requests.push({url, options});
      const kind = url.includes("/security/dependabot") ? "dependabot" : url.includes("/pulls") ? "pulls" : "issues";
      return {ok: kind !== failKind, status: kind === failKind ? 403 : 200, url: loginRedirect ? "https://github.com/login" : url, headers: {get: () => "text/html; charset=utf-8"}, text: async () => kind};
    },
    [firefox ? 'browser' : 'chrome']: {
      runtime: { id: "fixture-extension", getURL: () => `${extensionOrigin}/`, onMessage: {addListener(callback) {listener = callback;}} },
      storage: {local: {get: async () => ({repositories: saved})}}
    }
  });
  vm.runInContext(commonSource, ctx);
  vm.runInContext(readerSource, ctx);
  const sender = {id: "fixture-extension", url: `${extensionOrigin}/popup.html`};
  return {
    requests,
    listener,
    sender,
    request: message => new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error("Reader did not respond")), 1000);
      listener(message, sender, value => {clearTimeout(timeout); resolve(value);});
    })
  };
}

(async () => {
  const live = await reader();
  assert.equal((await live.request({type: "github-session-status"})).signedIn, true);
  const result = await live.request({type: "read-github-counts", root});
  assert.deepEqual([result.pulls, result.issues, result.dependabot], [4, 2, 7]);
  assert.equal(live.requests.length, 3);
  assert.equal(new URL(live.requests.find(request => request.url.includes('/pulls?')).url).searchParams.get('q'), pullsQuery);
  assert.equal(new URL(live.requests.find(request => request.url.includes('/security/dependabot?')).url).searchParams.get('q'), securityQuery);
  assert.equal((await live.request({type: 'github-session-status'})).policy, api.POLICY);
  const newMarkup = await reader({modern: true});
  const modernResult = await newMarkup.request({type: "read-github-counts", root});
  assert.deepEqual([modernResult.pulls, modernResult.issues, modernResult.dependabot], [4, 2, 0]);
  const disabled = await reader({zeroIssues: true, disabledSecurity: true});
  const disabledResult = await disabled.request({type: "read-github-counts", root});
  assert.deepEqual([disabledResult.pulls, disabledResult.issues, disabledResult.dependabot], [4, 0, null]);
  assert.equal(disabledResult.diagnostics.issues, "ok");
  assert.equal(disabledResult.diagnostics.dependabot, "dependabot-disabled");
  const advanced = await reader({advancedIssues: true});
  const advancedResult = await advanced.request({type: "read-github-counts", root});
  assert.deepEqual([advancedResult.pulls, advancedResult.issues, advancedResult.dependabot], [4, 0, 7]);
  assert.equal(advancedResult.diagnostics.issues, "ok");
  let originReply;
  live.listener({type: "github-session-status"}, {id: live.sender.id, origin: extensionOrigin}, value => {originReply = value;});
  assert.equal(originReply.signedIn, true);
  assert.equal(live.listener({type: "github-session-status"}, {id: live.sender.id, tab: {id: 12}, url: "https://github.com/"}, () => {throw Error("Unexpected tab reply");}), undefined);
  for (const request of live.requests) {
    assert.equal(request.options.credentials, "same-origin");
    assert.equal(request.options.mode, "same-origin");
    assert.equal(request.options.redirect, "follow");
    assert.equal(request.options.method, "GET");
    assert.equal(request.options.headers.Authorization, undefined);
    assert.equal(request.options.headers.Cookie, undefined);
  }
  const partial = await reader({failKind: "dependabot"});
  const missing = await partial.request({type: "read-github-counts", root});
  assert.deepEqual([missing.pulls, missing.issues, missing.dependabot], [4, 2, null]);
  assert.equal(missing.diagnostics.dependabot, "http-403");
  const signedOut = await reader({loggedIn: false});
  assert.equal((await signedOut.request({type: "read-github-counts", root})).reason, "signed-out");
  assert.equal(signedOut.requests.length, 0);
  const notSaved = await reader({saved: []});
  assert.equal((await notSaved.request({type: "read-github-counts", root})).reason, "not-saved");
  assert.equal(notSaved.requests.length, 0);
  const redirected = await reader({loginRedirect: true});
  const redirectResult = await redirected.request({type: "read-github-counts", root});
  assert.deepEqual([redirectResult.pulls, redirectResult.issues, redirectResult.dependabot], [null, null, null]);
  assert.equal(live.listener({type: "read-github-counts", root}, {id: "other", url: "https://github.com/"}, () => { throw Error("Unexpected reply"); }), undefined);
  assert.equal((await live.request({type: "read-github-counts", root: "https://evil.test/team/project"})).reason, "invalid-repository");
  console.log("PASS: exact counts, abbreviated and missing counters, explicit zero, open/closed filters, repository matching, saved-repository allowlist, session auth, read-only same-origin requests, partial failures, redirects and sender validation.");
})().catch(error => { console.error(error); process.exitCode = 1; });
