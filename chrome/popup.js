"use strict";

const list = document.querySelector("#repositories");
const form = document.querySelector("#add-form");
const input = document.querySelector("#repo-url");
const addButton = document.querySelector("#add-button");
const toggleAdd = document.querySelector("#toggle-add");
const status = document.querySelector("#status");
const search = document.querySelector("#repo-search");
let repositories = [];
let busy = true;
let draggedRepository = null;
let repositoryTitles = {};
let editingRepository = null;
let draftTitle = "";

function normalizeUrl(value) {
  const text = value.trim();
  const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(text) ? text : `https://${text}`);
  if (!["https:", "http:"].includes(url.protocol) || !url.hostname || url.username || url.password) {
    throw new Error("Enter an HTTP or HTTPS repository URL without credentials.");
  }
  if (url.pathname === "/") throw new Error("Include the repository path in the URL.");
  url.hash = "";
  url.pathname = url.pathname.replace(/\/+$/, "").replace(/\.git$/, "");
  if (!url.pathname || url.pathname === "/") throw new Error("Include the repository path in the URL.");
  return url.href;
}

function showStatus(message, error = false) {
  status.textContent = message;
  status.dataset.error = String(error);
}

function setAddFormOpen(open) {
  form.hidden = !open;
  toggleAdd.setAttribute("aria-expanded", String(open));
  toggleAdd.title = open ? "Close add repository" : "Add repository";
  toggleAdd.setAttribute("aria-label", toggleAdd.title);
  if (open) input.focus();
  else search.focus();
}

toggleAdd.addEventListener("click", () => {
  if (!busy) setAddFormOpen(form.hidden);
});

form.addEventListener("keydown", event => {
  if (event.key === "Escape" && !busy) {
    event.preventDefault();
    setAddFormOpen(false);
  }
});

async function openInCurrentTab(event, url) {
  event.preventDefault();
  try {
    const currentWindow = await chrome.windows.getCurrent();
    const [tab] = await chrome.tabs.query({ active: true, windowId: currentWindow.id });
    if (tab?.id === undefined) throw new Error("No active tab found.");
    await chrome.tabs.update(tab.id, { url });
    if (document.documentElement.dataset.view !== "panel") window.close();
  } catch {
    showStatus("Could not open the link in the current tab. Please try again.", true);
  }
}

function repositoryShortcuts(repository) {
  const url = new URL(repository);
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2) return [];
  const isGitLab = url.hostname === "gitlab.com" || url.hostname.startsWith("gitlab.");
  const isBitbucket = url.hostname === "bitbucket.org";
  const basePath = isGitLab ? url.pathname.split("/-/")[0] : `/${parts.slice(0, 2).join("/")}`;
  const routes = isGitLab
    ? [["PR", "Merge requests", "-/merge_requests"], ["Issues", "Issues", "-/issues"], ["Pipelines", "CI/CD pipelines", "-/pipelines"]]
    : isBitbucket
      ? [["PR", "Pull requests", "pull-requests"], ["Issues", "Issues", "issues"], ["Pipelines", "Pipelines", "pipelines"]]
      : [["PR", "Pull requests", "pulls"], ["Issues", "Issues", "issues"], ["Dependabot", "Dependabot alerts", "security/dependabot"]];
  return routes.map(([label, description, route]) => {
    const target = new URL(`${url.origin}${basePath.replace(/\/+$/, "")}/${route}`);
    const kind = label === "PR" ? "pulls" : label === "Dependabot" ? "dependabot" : null;
    if (url.hostname === "github.com" && kind) target.searchParams.set("q", GitHubCounts.QUERIES[kind]);
    return { label, description, url: target.href };
  });
}

function shortcutIcon(label) {
  const namespace = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(namespace, "svg");
  for (const [name, value] of Object.entries({
    width: "14", height: "14", viewBox: "0 0 24 24", fill: "none",
    stroke: "currentColor", "stroke-width": "1.8", "stroke-linecap": "round",
    "stroke-linejoin": "round", "aria-hidden": "true", focusable: "false"
  })) svg.setAttribute(name, value);
  const shapes = label === "Rename"
    ? [["path", {d: "m16 3 5 5-12 12-6 1 1-6ZM14 5l5 5"}]]
    : label === "Dependabot"
      ? [["path", {d: "M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6ZM12 8v5M12 16h.01"}]]
      : label === "Save"
      ? [["path", {d: "m5 12 4 4L19 6"}]]
      : label === "PR"
    ? [["path", {d: "M6 7v10M9 4h3a6 6 0 0 1 6 6v7"}], ["circle", {cx: "6", cy: "4", r: "2"}], ["circle", {cx: "6", cy: "19", r: "2"}], ["circle", {cx: "18", cy: "19", r: "2"}]]
    : label === "Issues"
      ? [["circle", {cx: "12", cy: "12", r: "9"}], ["path", {d: "M12 7v6M12 17h.01"}]]
      : [["circle", {cx: "12", cy: "12", r: "9"}], ["path", {d: "m10 8 6 4-6 4Z"}]];
  for (const [tag, attributes] of shapes) {
    const shape = document.createElementNS(namespace, tag);
    for (const [name, value] of Object.entries(attributes)) shape.setAttribute(name, value);
    svg.append(shape);
  }
  return svg;
}

function visibleRepositories() {
  const query = search.value.trim().toLowerCase();
  return repositories.filter(repository => `${repository} ${repositoryTitles[repository] || ""}`.toLowerCase().includes(query));
}

function readTitles(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(repositories.flatMap(repository => {
    const title = Object.hasOwn(value, repository) && typeof value[repository] === "string" ? value[repository].trim().slice(0, 120) : "";
    return title ? [[repository, title]] : [];
  }));
}

function focusTitleEditor() {
  const row = Array.from(list.children).find(item => item.children[0].href === editingRepository);
  const editor = row && Array.from(row.children).find(child => child.className === "rename-input");
  editor?.focus();
}

async function saveTitle() {
  if (busy || !editingRepository) return;
  const nextTitles = { ...repositoryTitles };
  const title = draftTitle.trim().slice(0, 120);
  if (title) nextTitles[editingRepository] = title;
  else delete nextTitles[editingRepository];
  if (await save(repositories, title ? "Repository title saved." : "Default title restored.", nextTitles)) {
    editingRepository = null;
    render();
  } else {
    focusTitleEditor();
  }
}

function clearDrag() {
  draggedRepository = null;
  for (const row of list.children) row.classList.remove("dragging", "drop-before", "drop-after");
}

async function reorderRepository(repository, targetRepository, after) {
  if (busy) return;
  const visible = visibleRepositories();
  if (repository === targetRepository || !visible.includes(repository) || !visible.includes(targetRepository)) return;
  const reordered = visible.filter(value => value !== repository);
  reordered.splice(reordered.indexOf(targetRepository) + (after ? 1 : 0), 0, repository);
  if (reordered.every((value, index) => value === visible[index])) return;
  const matching = new Set(visible);
  let index = 0;
  const next = repositories.map(value => matching.has(value) ? reordered[index++] : value);
  if (await save(next, "Repository order saved.")) {
    const row = Array.from(list.children).find(item => item.children[0].href === repository);
    row?.children[0].focus();
  }
}

function render() {
  window.repoBadges?.beginRender();
  clearDrag();
  const scrollTop = list.scrollTop;
  list.replaceChildren();
  const visible = visibleRepositories();
  document.querySelector("#count").textContent = search.value.trim()
    ? `${visible.length} / ${repositories.length}` : String(repositories.length);
  document.querySelector("#empty-state").hidden = repositories.length > 0;
  document.querySelector("#no-results").hidden = repositories.length === 0 || visible.length > 0;
  for (const repository of visible) {
    const url = new URL(repository);
    const path = url.pathname.slice(1);
    const separator = path.indexOf("/");
    const owner = separator < 0 ? "" : path.slice(0, separator);
    const name = separator < 0 ? path : path.slice(separator + 1);
    const item = document.createElement("li");
    item.draggable = !busy && editingRepository !== repository;
    item.addEventListener("dragstart", event => {
      if (busy || editingRepository === repository) { event.preventDefault(); return; }
      draggedRepository = repository;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", repository);
      item.classList.add("dragging");
    });
    item.addEventListener("dragover", event => {
      if (!draggedRepository || busy) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      for (const row of list.children) row.classList.remove("drop-before", "drop-after");
      const bounds = list.getBoundingClientRect();
      if (event.clientY < bounds.top + 24) list.scrollTop -= 12;
      else if (event.clientY > bounds.bottom - 24) list.scrollTop += 12;
      if (draggedRepository === repository) return;
      const rect = item.getBoundingClientRect();
      item.classList.add(event.clientY < rect.top + rect.height / 2 ? "drop-before" : "drop-after");
    });
    item.addEventListener("dragleave", () => item.classList.remove("drop-before", "drop-after"));
    item.addEventListener("drop", async event => {
      if (!draggedRepository || busy) return;
      event.preventDefault();
      const source = draggedRepository;
      const rect = item.getBoundingClientRect();
      const after = event.clientY >= rect.top + rect.height / 2;
      clearDrag();
      await reorderRepository(source, repository, after);
    });
    item.addEventListener("dragend", clearDrag);
    const link = document.createElement("a");
    link.className = "repo-link";
    link.href = repository;
    link.draggable = false;
    link.title = repository;
    link.setAttribute("aria-keyshortcuts", "Alt+ArrowUp Alt+ArrowDown");
    link.addEventListener("keydown", event => {
      if (!event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault();
      const matches = visibleRepositories();
      const direction = event.key === "ArrowUp" ? -1 : 1;
      return reorderRepository(repository, matches[matches.indexOf(repository) + direction], direction > 0);
    });
    link.addEventListener("click", event => openInCurrentTab(event, repository));
    const text = document.createElement("span");
    text.className = "repo-text";
    const title = document.createElement("span");
    title.className = "repo-name";
    title.textContent = repositoryTitles[repository] || name;
    title.title = title.textContent;
    const host = document.createElement("span");
    host.className = "repo-host";
    host.textContent = owner ? `${url.host}/${owner}` : url.host;
    text.append(title, host);
    link.append(text);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove";
    remove.textContent = "×";
    remove.title = `Remove ${path}`;
    remove.setAttribute("aria-label", `Remove ${path}`);
    remove.disabled = busy;
    remove.addEventListener("click", () => save(repositories.filter(value => value !== repository), "Repository removed."));
    item.append(link, remove);
    const shortcuts = repositoryShortcuts(repository);
    if (shortcuts.length) {
      const quickLinks = document.createElement("div");
      quickLinks.className = "quick-links";
      for (const shortcut of shortcuts) {
        const quickLink = document.createElement("a");
        quickLink.href = shortcut.url;
        quickLink.dataset.kind = shortcut.label;
        quickLink.draggable = false;
        quickLink.append(shortcutIcon(shortcut.label));
        quickLink.title = `Open ${shortcut.description} in current tab`;
        quickLink.setAttribute("aria-label", `${path}: ${shortcut.description}`);
        quickLink.addEventListener("click", event => openInCurrentTab(event, shortcut.url));
        window.repoBadges?.bind(quickLink, repository, shortcut);
        quickLinks.append(quickLink);
      }
      item.append(quickLinks);
    }
    const rename = document.createElement("button");
    const isEditing = editingRepository === repository;
    rename.type = "button";
    rename.className = "rename";
    rename.title = isEditing ? "Save title (Enter)" : "Rename repository";
    rename.setAttribute("aria-label", `${rename.title}: ${path}`);
    rename.disabled = busy;
    rename.append(shortcutIcon(isEditing ? "Save" : "Rename"));
    rename.addEventListener("click", () => {
      if (busy) return;
      if (editingRepository === repository) return saveTitle();
      editingRepository = repository;
      draftTitle = repositoryTitles[repository] || name;
      render();
      focusTitleEditor();
    });
    item.append(rename);
    if (isEditing) {
      const editor = document.createElement("input");
      editor.className = "rename-input";
      editor.type = "text";
      editor.maxLength = 120;
      editor.value = draftTitle;
      editor.placeholder = name;
      editor.disabled = busy;
      editor.setAttribute("aria-label", "Repository title");
      editor.title = "Enter to save, Escape to cancel. Leave empty to restore the default title.";
      editor.addEventListener("input", () => { draftTitle = editor.value; });
      editor.addEventListener("keydown", event => {
        if (event.isComposing) return;
        if (event.key === "Enter") {
          event.preventDefault();
          return saveTitle();
        }
        if (event.key === "Escape" && !busy) {
          event.preventDefault();
          editingRepository = null;
          render();
          const row = Array.from(list.children).find(item => item.children[0].href === repository);
          row?.children[0].focus();
        }
      });
      item.append(editor);
    }
    list.append(item);
  }
  list.scrollTop = scrollTop;
  window.repoBadges?.endRender();
}

search.addEventListener("input", () => {
  render();
  list.scrollTop = 0;
});

search.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    event.preventDefault();
    search.value = "";
    render();
    list.scrollTop = 0;
  }
});

async function save(next, message, nextTitles = repositoryTitles) {
  if (busy) return false;
  busy = true;
  addButton.disabled = true;
  toggleAdd.disabled = true;
  render();
  try {
    const titles = Object.fromEntries(Object.entries(nextTitles).filter(([url]) => next.includes(url)));
    await chrome.storage.local.set({ repositories: next, repositoryTitles: titles });
    repositories = next;
    repositoryTitles = titles;
    if (!repositories.includes(editingRepository)) editingRepository = null;
    showStatus(message);
    return true;
  } catch {
    showStatus("Could not save changes. Please try again.", true);
    return false;
  } finally {
    busy = false;
    addButton.disabled = false;
    toggleAdd.disabled = false;
    render();
  }
}

form.addEventListener("submit", async event => {
  event.preventDefault();
  if (busy) return;
  let url;
  try {
    url = normalizeUrl(input.value);
  } catch {
    showStatus("Enter a valid repository URL, such as github.com/owner/repo.", true);
    input.focus();
    return;
  }
  if (repositories.includes(url)) {
    showStatus("This repository is already in your list.", true);
    return;
  }
  input.disabled = true;
  const saved = await save([...repositories, url], "Repository added.");
  input.disabled = false;
  if (saved) {
    input.value = "";
    setAddFormOpen(false);
  } else input.focus();
});

async function initialize() {
  try {
    const saved = await chrome.storage.local.get({ repositories: [], repositoryTitles: {} });
    repositories = [...new Set((Array.isArray(saved.repositories) ? saved.repositories : []).flatMap(value => {
      try { return typeof value === "string" ? [normalizeUrl(value)] : []; }
      catch { return []; }
    }))];
    repositoryTitles = readTitles(saved.repositoryTitles);
    busy = false;
    input.disabled = false;
    addButton.disabled = false;
    toggleAdd.disabled = false;
    render();
  } catch {
    showStatus("Could not load repositories. Close and reopen the extension to retry.", true);
  }
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || busy || (!changes.repositories && !changes.repositoryTitles)) return;
  if (changes.repositories) {
    const saved = changes.repositories.newValue;
    repositories = [...new Set((Array.isArray(saved) ? saved : []).flatMap(value => {
      try { return typeof value === "string" ? [normalizeUrl(value)] : []; }
      catch { return []; }
    }))];
  }
  repositoryTitles = readTitles(changes.repositoryTitles ? changes.repositoryTitles.newValue : repositoryTitles);
  if (!repositories.includes(editingRepository)) editingRepository = null;
  render();
});

initialize();
