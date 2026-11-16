"use strict";

(() => {
  const PREFIX = `github-counts:${GitHubCounts.POLICY}:`;
  const fields = { PR: "pulls", Issues: "issues", Dependabot: "dependabot" };
  const targets = new Map();
  const cache = new Map();
  const refreshButton = document.querySelector("#refresh-counts");
  let running = false;
  let scheduled;
  let forceNext = false;

  function validCount(value) { return Number.isSafeInteger(value) && value >= 0; }
  function unknown(reason) { return { pulls: null, issues: null, dependabot: null, updatedAt: Date.now(), reason }; }
  function failureMessage(entry, field) {
    const reason = entry?.diagnostics?.[field] || entry?.reason;
    if (reason === "dependabot-disabled") return "Dependabot alerts are disabled for this repository. No count is available.";
    if (reason === "counter-not-found") return "GitHub page loaded, but the open counter could not be identified.";
    if (reason === "http-403") return "GitHub denied access to this page (403).";
    if (reason === "http-404") return "GitHub could not find this page, or this account cannot access it (404).";
    if (reason === "http-429") return "GitHub is rate limiting requests. Retry later.";
    if (reason === "signed-out" || reason === "redirected") return "The page requested sign-in or redirected. Check your GitHub session.";
    if (reason === "timeout") return "GitHub request timed out. Refresh to retry.";
    if (reason === "request-failed") return "The GitHub request failed. Check network access and refresh.";
    if (reason === "no-reader") return "The GitHub reader did not respond. Reload the GitHub tab and check extension site access.";
    if (reason === "reader-disconnected") return "The GitHub tab changed or the reader disconnected. Refresh to reconnect.";
    return "Keep a signed-in GitHub tab open in this window and allow access to this repository.";
  }

  function paint() {
    for (const [root, links] of targets) {
      const entry = cache.get(root);
      const fresh = entry && Date.now() - entry.updatedAt < GitHubCounts.TTL;
      for (const { link, badge, field, description, path } of links) {
        const count = fresh && validCount(entry[field]) ? entry[field] : null;
        const criteria = field === "pulls" ? "excluding Dependabot" : field === "dependabot" ? "Critical + High only" : "issues only";
        badge.textContent = count === null ? "—" : count > 99 ? "99+" : String(count);
        badge.hidden = count === 0;
        link.dataset.zero = String(count === 0);
        badge.dataset.unknown = String(count === null);
        const detail = count === null ? `Count unavailable: ${failureMessage(entry, field)}`
          : `${count} open (${criteria}) · Last checked ${new Date(entry.updatedAt).toLocaleTimeString()}`;
        link.title = `Open ${description} in current tab\n${detail}`;
        link.setAttribute("aria-label", `${path}: ${description}, ${count === null ? "count unavailable" : `${count} open`}`);
      }
    }
  }

  async function sessionTab() {
    const currentWindow = await chrome.windows.getCurrent();
    const tabs = await chrome.tabs.query({ windowId: currentWindow.id, url: "https://github.com/*", discarded: false });
    tabs.sort((left, right) => Number(right.active) - Number(left.active));
    let responded = false;
    for (const tab of tabs) {
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { type: "github-session-status" });
        if (typeof response?.signedIn === "boolean" && response.policy === GitHubCounts.POLICY) responded = true;
        if (response?.signedIn === true && response.policy === GitHubCounts.POLICY) return { id: tab.id };
      } catch { /* Existing GitHub tabs need a reload after installing the update. */ }
    }
    return { id: null, reason: responded ? "signed-out" : tabs.length ? "no-reader" : "no-session" };
  }

  async function store(root, entry) {
    cache.set(root, entry);
    paint();
    try { await chrome.storage.session.set({ [PREFIX + root]: entry }); } catch { /* Counts can still be shown without caching. */ }
  }

  async function refresh(force = false) {
    if (running) { forceNext ||= force; return; }
    running = true;
    refreshButton.disabled = true;
    refreshButton.setAttribute("aria-busy", "true");
    try {
      const roots = [...targets.keys()];
      if (!roots.length) return;
      const session = await sessionTab();
      const tabId = session.id;
      if (tabId === null) {
        for (const root of roots) await store(root, unknown(session.reason));
        refreshButton.title = "Open or reload a signed-in GitHub tab in this window, then refresh counts";
        return;
      }
      refreshButton.title = "Refresh GitHub counts using your browser session";
      for (const root of roots) {
        const entry = cache.get(root);
        const retryAfter = entry?.reason === "ok" ? GitHubCounts.TTL : 30000;
        if (!force && entry && Date.now() - entry.updatedAt < retryAfter && entry.reason !== "no-session") continue;
        try {
          const result = await chrome.tabs.sendMessage(tabId, { type: "read-github-counts", root });
          const safe = unknown("unreadable");
          for (const field of Object.values(fields)) safe[field] = validCount(result?.[field]) ? result[field] : null;
          safe.diagnostics = Object.fromEntries(Object.values(fields).flatMap(field => {
            const detail = result?.diagnostics?.[field];
            return typeof detail === "string" && /^(?:ok|counter-not-found|dependabot-disabled|not-html|signed-out|redirected|timeout|request-failed|http-\d{3})$/.test(detail) ? [[field, detail]] : [];
          }));
          safe.reason = result?.reason === "signed-out" ? "signed-out" : Object.values(fields).every(field => safe[field] !== null) ? "ok" : "unreadable";
          await store(root, safe);
          if (safe.reason === "signed-out") {
            for (const remaining of roots) await store(remaining, unknown("signed-out"));
            break;
          }
        } catch { await store(root, unknown("reader-disconnected")); }
        if (root !== roots[roots.length - 1]) await new Promise(resolve => setTimeout(resolve, 700));
      }
    } catch {
      for (const root of targets.keys()) await store(root, unknown("unreadable"));
      refreshButton.title = "Could not read GitHub counts. Open or reload a signed-in GitHub tab and retry.";
    } finally {
      running = false;
      refreshButton.disabled = false;
      refreshButton.setAttribute("aria-busy", "false");
      if (forceNext) { forceNext = false; schedule(true); }
    }
  }

  function schedule(force = false) {
    clearTimeout(scheduled);
    scheduled = setTimeout(() => refresh(force), 150);
  }

  window.repoBadges = {
    beginRender() { targets.clear(); },
    bind(link, repository, shortcut) {
      const root = GitHubCounts.rootFor(repository);
      const field = fields[shortcut.label];
      if (!field) return;
      const badge = document.createElement("span");
      badge.className = "count-badge";
      badge.dataset.kind = field;
      badge.setAttribute("aria-hidden", "true");
      link.append(badge);
      if (!root) {
        badge.textContent = "—";
        badge.dataset.unknown = "true";
        link.title += "\nCounts are currently supported only on github.com.";
        return;
      }
      if (!targets.has(root)) targets.set(root, []);
      targets.get(root).push({ link, badge, field, description: shortcut.description, path: new URL(repository).pathname.slice(1) });
    },
    endRender() { paint(); schedule(); }
  };

  chrome.storage.session.get(null).then(saved => {
    for (const [key, value] of Object.entries(saved)) {
      if (key.startsWith(PREFIX) && value && typeof value.updatedAt === "number") cache.set(key.slice(PREFIX.length), value);
    }
    paint();
    schedule();
  }).catch(() => schedule());
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "session") return;
    for (const [key, change] of Object.entries(changes)) {
      if (!key.startsWith(PREFIX)) continue;
      if (change.newValue) cache.set(key.slice(PREFIX.length), change.newValue);
      else cache.delete(key.slice(PREFIX.length));
    }
    paint();
  });
  refreshButton.addEventListener("click", () => refresh(true));
  setInterval(() => { paint(); if (!document.hidden) refresh(); }, 60000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) schedule(); });
})();
