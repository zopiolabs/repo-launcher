"use strict";

(() => {
  const pending = new Map();
  const unknown = reason => ({ pulls: null, issues: null, dependabot: null, reason, updatedAt: Date.now() });

  async function readPage(root, kind) {
    const query = GitHubCounts.QUERIES[kind];
    const route = `${{ pulls: "pulls", issues: "issues", dependabot: "security/dependabot" }[kind]}?q=${encodeURIComponent(query)}`;
    try {
      const response = await fetch(`${root}/${route}`, {
        method: "GET", credentials: "same-origin", mode: "same-origin", redirect: "follow",
        cache: "no-cache", headers: { Accept: "text/html" }, signal: AbortSignal.timeout(10000)
      });
      if (!response.ok) return { count: null, reason: `http-${response.status}` };
      if (!response.headers.get("content-type")?.includes("text/html")) return { count: null, reason: "not-html" };
      const expectedPath = new URL(`${root}/${route}`).pathname.toLowerCase();
      const finalUrl = new URL(response.url);
      if (finalUrl.origin !== "https://github.com" || finalUrl.pathname.replace(/\/+$/, "").toLowerCase() !== expectedPath) return { count: null, reason: "redirected" };
      const doc = new DOMParser().parseFromString(await response.text(), "text/html");
      if (!GitHubCounts.signedIn(doc)) return { count: null, reason: "signed-out" };
      if (kind === "dependabot" && Array.from(doc.querySelectorAll("main h2, main h3"))
        .some(heading => heading.textContent.trim() === "Dependabot alerts are disabled.")) {
        return { count: null, reason: "dependabot-disabled" };
      }
      const count = GitHubCounts.readOpenCount(doc, root, kind, kind === "issues" ? null : query);
      return { count, reason: count === null ? "counter-not-found" : "ok" };
    } catch (error) { return { count: null, reason: error.name === "TimeoutError" ? "timeout" : "request-failed" }; }
  }

  async function readRepository(root) {
    const saved = await chrome.storage.local.get({ repositories: [] });
    if (!Array.isArray(saved.repositories) || !saved.repositories.some(value => GitHubCounts.rootFor(value) === root)) return unknown("not-saved");
    if (!GitHubCounts.signedIn(document)) return unknown("signed-out");
    const kinds = ["pulls", "issues", "dependabot"];
    const values = await Promise.all(kinds.map(kind => readPage(root, kind)));
    // The user may sign out while the requests are in progress.
    if (!GitHubCounts.signedIn(document)) return unknown("signed-out");
    return { pulls: values[0].count, issues: values[1].count, dependabot: values[2].count,
      diagnostics: Object.fromEntries(kinds.map((kind, index) => [kind, values[index].reason])),
      reason: values.some(value => value.reason === "signed-out") ? "signed-out" : values.some(value => value.count === null) ? "unreadable" : "ok", updatedAt: Date.now() };
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Some Chrome versions provide origin rather than url for extension
    // pages. A same-extension message without a tab is also an internal UI.
    const extensionOrigin = chrome.runtime.getURL("").replace(/\/$/, "");
    const extensionPage = sender.url?.startsWith(`${extensionOrigin}/`) || sender.origin === extensionOrigin;
    if (sender.id !== chrome.runtime.id || (!extensionPage && (sender.tab || sender.url || sender.origin))) return;
    if (message?.type === "github-session-status") {
      sendResponse({ signedIn: GitHubCounts.signedIn(document), policy: GitHubCounts.POLICY });
      return;
    }
    if (message?.type !== "read-github-counts") return;
    const root = GitHubCounts.rootFor(message.root);
    if (!root || root !== message.root) { sendResponse(unknown("invalid-repository")); return; }
    if (!pending.has(root)) {
      pending.set(root, readRepository(root).catch(() => unknown("unreadable")).finally(() => pending.delete(root)));
    }
    pending.get(root).then(sendResponse);
    return true;
  });
})();
