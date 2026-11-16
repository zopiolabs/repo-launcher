"use strict";

// Shared by the popup and the isolated GitHub content script.
globalThis.GitHubCounts = (() => {
  const TTL = 5 * 60 * 1000;
  const POLICY = "exclude-dependabot-prs-critical-high-v1";
  const QUERIES = Object.freeze({
    pulls: "is:pr is:open -author:app/dependabot",
    issues: "is:issue is:open",
    dependabot: "is:open severity:critical,high"
  });
  const COUNTER = '[data-component="CounterLabel"], .Counter, [data-component="Counter"]';

  function rootFor(value) {
    try {
      const url = new URL(value);
      if (url.origin !== "https://github.com" || url.username || url.password) return null;
      const [owner, rawName] = url.pathname.split("/").filter(Boolean);
      const name = rawName?.replace(/\.git$/i, "");
      if (!/^[a-z\d-]+$/i.test(owner || "") || !/^[a-z\d_.-]+$/i.test(name || "") || [".", ".."].includes(name)) return null;
      return `https://github.com/${owner}/${name}`.toLowerCase();
    } catch { return null; }
  }

  function exactNumber(value) {
    if (typeof value !== "string") return null;
    const text = value.trim();
    if (!/^(?:\d+|\d{1,3}(?:[,\s\u00a0\u202f]\d{3})+)$/.test(text)) return null;
    const number = Number(text.replace(/[,\s\u00a0\u202f]/g, ""));
    return Number.isSafeInteger(number) && number >= 0 ? number : null;
  }

  function signedIn(doc) {
    return Boolean(doc.querySelector('meta[name="user-login"]')?.getAttribute("content")?.trim()
      || doc.body?.classList.contains("logged-in"));
  }

  function elementCount(element) {
    if (!element || element.hidden || element.getAttribute("aria-busy") === "true") return null;
    for (const value of [element.getAttribute("data-count"), element.getAttribute("title"), element.textContent]) {
      const count = exactNumber(value);
      if (count !== null) return count;
    }
    return null;
  }

  function matchesPath(element, root, suffix) {
    try {
      const url = new URL(element.getAttribute("href"), `${root}/${suffix}`);
      return url.origin === "https://github.com" && url.pathname.replace(/\/+$/, "").toLowerCase() === `${new URL(root).pathname}/${suffix}`;
    } catch { return false; }
  }

  function normalizedQuery(query) {
    return query.trim().toLowerCase().split(/\s+/).map(token => {
      if (token === "state:open") return "is:open";
      if (token.startsWith("severity:")) return `severity:${token.slice(9).split(",").sort().join(",")}`;
      return token;
    }).sort().join(" ");
  }

  function readOpenCount(doc, root, kind, query = null) {
    if (!signedIn(doc)) return null;
    const suffix = { pulls: "pulls", issues: "issues", dependabot: "security/dependabot" }[kind];
    if (!suffix) return null;
    if (query) {
      const filter = doc.querySelector(kind === "pulls"
        ? "#repo-pulls-dashboard-filter-input, #js-issues-search"
        : "#dependabot-alert-list-filterbar-input");
      const activeQuery = filter?.value || filter?.getAttribute("value") || "";
      if (normalizedQuery(activeQuery) !== normalizedQuery(query)) return null;
    }

    // Repository navigation counters represent open PRs and open issues.
    // Never use the Security tab's total: it includes other alert types.
    if (kind !== "dependabot" && !query) {
      const legacyTab = doc.querySelector(kind === "pulls" ? "#pull-requests-tab" : "#issues-tab");
      const tabs = legacyTab ? [legacyTab] : Array.from(doc.querySelectorAll('a[data-tab-item], a[data-react-nav="repo"], nav a[href]'));
      for (const tab of tabs) {
        if (!matchesPath(tab, root, suffix)) continue;
        const count = elementCount(tab.querySelector(COUNTER));
        if (count !== null) return count;
      }
    }

    const main = doc.querySelector("main");
    if (!main) return null;
    for (const element of main.querySelectorAll('a[href], button, [role="tab"]')) {
      if (element.hasAttribute("href")) {
        if (!matchesPath(element, root, suffix)) continue;
        const url = new URL(element.getAttribute("href"), `${root}/${suffix}`);
        const query = url.searchParams.get("q") || "";
        if (!/(?:^|\s)(?:is|state):open(?:\s|$)/i.test(query) && url.searchParams.get("state") !== "open") continue;
      }
      const text = (element.textContent || "").replace(/\s+/g, " ").trim();
      const label = element.getAttribute("aria-label") || "";
      const counter = element.querySelector(COUNTER);
      const visibleLabel = element.querySelector('[data-component="text"]')?.textContent?.trim();
      // React/Primer renders both a visible CounterLabel and a hidden copy
      // such as "Open0 (0)". Read the scoped counter instead of that text.
      if (counter && (visibleLabel === "Open" || /^Open(?=[\s\d(]|$)/i.test(text))) {
        const count = elementCount(counter);
        if (count !== null) return count;
      }
      for (const value of [text, label]) {
        const match = value.match(/^([\d,\s]+)\s+Open(?:\s+(?:issues|pull requests|alerts))?$/i)
          || value.match(/^Open(?:\s+(?:issues|pull requests|alerts))?\s*\(?([\d,\s]+)\)?$/i);
        if (match) {
          const count = exactNumber(match[1]);
          if (count !== null) return count;
        }
      }
    }
    // Missing or abbreviated counters are unknown, never implicitly zero.
    return null;
  }

  return Object.freeze({ TTL, POLICY, QUERIES, rootFor, exactNumber, signedIn, readOpenCount });
})();
