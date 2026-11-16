const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const firefox = process.argv.includes('--firefox');
const extensionDirectory = firefox ? 'firefox' : 'chrome';
const source = fs.readFileSync(`${extensionDirectory}/popup.js`, 'utf8');

class Element {
  constructor() {
    this.children = []; this.dataset = {}; this.listeners = {}; this.value = ''; this.scrollTop = 0;
    const classes = new Set();
    this.classList = {add: (...values) => values.forEach(value => classes.add(value)), remove: (...values) => values.forEach(value => classes.delete(value)), contains: value => classes.has(value)};
  }
  getBoundingClientRect() { return {top: 0, bottom: 40, height: 40}; }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = items; }
  setAttribute(name, value) { this[name] = value; }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  focus() {}
}

async function setup(saved = [], failRead = false, savedTitles = {}) {
  const elements = Object.fromEntries(['repositories', 'add-form', 'repo-url', 'add-button', 'toggle-add', 'status', 'count', 'empty-state', 'repo-search', 'no-results'].map(id => [id, new Element()]));
  elements['add-form'].hidden = true;
  let persisted = saved;
  let persistedTitles = savedTitles;
  let failWrite = false;
  let storageListener;
  const navigation = { queries: [], updates: [], closed: 0, fail: false, missingTab: false };
  const root = {dataset: {view: 'popup'}};
  const context = vm.createContext({
    URL,
    document: { documentElement: root, querySelector: selector => elements[selector.slice(1)], createElement: () => new Element(), createElementNS: () => new Element() },
    window: {close: () => { navigation.closed += 1; }},
    [firefox ? 'browser' : 'chrome']: {
      windows: {getCurrent: async () => ({id: 42})},
      tabs: {
        query: async options => { navigation.queries.push(options); return navigation.missingTab ? [] : [{id: 99}]; },
        update: async (id, options) => { if (navigation.fail) throw Error('Navigation failed'); navigation.updates.push({id, ...options}); }
      },
      storage: { onChanged: { addListener(callback) { storageListener = callback; } }, local: {
      get: async () => { if (failRead) throw Error('Read failure'); return { repositories: persisted, repositoryTitles: persistedTitles }; },
      set: async value => { if (failWrite) throw Error('Write failure'); persisted = value.repositories; persistedTitles = value.repositoryTitles; }
    } } }
  });
  vm.runInContext(fs.readFileSync(`${extensionDirectory}/github-counts.js`, 'utf8'), context);
  vm.runInContext(source, context);
  await new Promise(resolve => setImmediate(resolve));
  return {
    elements,
    navigation,
    setPanel: () => { root.dataset.view = 'panel'; },
    persisted: () => persisted,
    titles: () => persistedTitles,
    failWrite: value => { failWrite = value; },
    externalUpdate: value => storageListener({repositories: {newValue: value}}, 'local'),
    externalTitles: value => storageListener({repositoryTitles: {newValue: value}}, 'local'),
    search: value => {
      elements['repo-search'].value = value;
      elements['repo-search'].listeners.input();
    },
    submit: async value => {
      elements['repo-url'].value = value;
      await elements['add-form'].listeners.submit({ preventDefault() {} });
    }
  };
}

(async () => {
  const app = await setup();
  assert.equal(app.elements.count.textContent, '0');
  assert.equal(app.elements['empty-state'].hidden, false);
  assert.equal(app.elements['add-form'].hidden, true);
  app.elements['toggle-add'].listeners.click();
  assert.equal(app.elements['add-form'].hidden, false);
  assert.equal(app.elements['toggle-add']['aria-expanded'], 'true');
  app.elements['add-form'].listeners.keydown({key: 'Escape', preventDefault() {}});
  assert.equal(app.elements['add-form'].hidden, true);
  app.elements['toggle-add'].listeners.click();
  await app.submit(' github.com/owner/repo.git/ ');
  assert.equal(app.persisted()[0], 'https://github.com/owner/repo');
  assert.equal(app.elements.count.textContent, '1');
  assert.equal(app.elements['add-form'].hidden, true);
  assert.equal(app.elements['toggle-add']['aria-expanded'], 'false');
  const link = app.elements.repositories.children[0].children[0];
  assert.equal(link.href, 'https://github.com/owner/repo');
  assert.equal(link.target, undefined);
  let prevented = false;
  await link.listeners.click({preventDefault() { prevented = true; }});
  assert.equal(prevented, true);
  assert.deepEqual({...app.navigation.queries[0]}, {active: true, windowId: 42});
  assert.deepEqual(app.navigation.updates[0], {id: 99, url: 'https://github.com/owner/repo'});
  assert.equal(app.navigation.closed, 1);
  await app.submit('https://github.com/owner/repo/');
  assert.equal(app.persisted().length, 1);
  assert.match(app.elements.status.textContent, /already/);
  for (const value of ['javascript:alert(1)', 'file:///repo', 'https://user:secret@example.com/repo', 'https://github.com', 'not a url', 'git@github.com:owner/repo.git']) {
    await app.submit(value);
    assert.equal(app.persisted().length, 1, value);
    assert.equal(app.elements.status.dataset.error, 'true', value);
  }
  await app.submit('https://git.internal.example/team/project');
  assert.equal(app.persisted().length, 2);
  const reopened = await setup(app.persisted());
  assert.equal(reopened.elements.count.textContent, '2');
  await reopened.elements.repositories.children[0].children[1].listeners.click();
  assert.equal(reopened.persisted().length, 1);
  reopened.failWrite(true);
  reopened.elements['toggle-add'].listeners.click();
  await reopened.submit('https://gitlab.com/team/another');
  assert.equal(reopened.elements['add-form'].hidden, false);
  assert.equal(reopened.persisted().length, 1);
  assert.equal(reopened.elements.count.textContent, '1');
  assert.match(reopened.elements.status.textContent, /Could not save/);
  assert.equal(reopened.elements['repo-url'].disabled, false);
  const urls = ['https://github.com/team/first', 'https://gitlab.com/team/second', 'https://bitbucket.org/team/third'];
  const ordered = await setup(urls);
  const drag = async (app, sourceIndex, targetIndex, after = false) => {
    const source = app.elements.repositories.children[sourceIndex];
    const target = app.elements.repositories.children[targetIndex];
    const event = {clientY: after ? 30 : 10, preventDefault() {}, dataTransfer: {setData() {}}};
    source.listeners.dragstart(event);
    assert.equal(event.dataTransfer.effectAllowed, 'move');
    target.listeners.dragover(event);
    if (source !== target) assert.equal(target.classList.contains(after ? 'drop-after' : 'drop-before'), true);
    await target.listeners.drop(event);
    source.listeners.dragend();
    for (const row of app.elements.repositories.children) assert.equal(row.classList.contains('dragging'), false);
  };
  const currentOrder = app => Array.from(app.persisted());
  assert.equal(ordered.elements.repositories.children[0].draggable, true);
  assert.equal(ordered.elements.repositories.children[0].children[0].draggable, false);
  await drag(ordered, 1, 0);
  assert.deepEqual(currentOrder(ordered), [urls[1], urls[0], urls[2]]);
  await drag(ordered, 1, 2, true);
  assert.deepEqual(currentOrder(ordered), [urls[1], urls[2], urls[0]]);
  const reorderedReload = await setup(ordered.persisted());
  assert.deepEqual(reorderedReload.elements.repositories.children.map(item => item.children[0].href), [urls[1], urls[2], urls[0]]);
  ordered.failWrite(true);
  await drag(ordered, 1, 0);
  assert.deepEqual(currentOrder(ordered), [urls[1], urls[2], urls[0]]);
  assert.deepEqual(ordered.elements.repositories.children.map(item => item.children[0].href), [urls[1], urls[2], urls[0]]);
  assert.match(ordered.elements.status.textContent, /Could not save/);
  assert.equal(ordered.elements.repositories.children[1].draggable, true);
  const single = await setup([urls[0]]);
  await drag(single, 0, 0);
  assert.deepEqual(currentOrder(single), [urls[0]]);
  const distant = await setup(urls);
  await drag(distant, 0, 2, true);
  assert.deepEqual(currentOrder(distant), [urls[1], urls[2], urls[0]]);
  await drag(distant, 2, 0);
  assert.deepEqual(currentOrder(distant), urls);
  const canceled = distant.elements.repositories.children[0];
  canceled.listeners.dragstart({dataTransfer: {setData() {}}});
  canceled.listeners.dragend();
  assert.deepEqual(currentOrder(distant), urls);
  await distant.elements.repositories.children[1].children[0].listeners.keydown({altKey: true, key: 'ArrowUp', preventDefault() {}});
  assert.deepEqual(currentOrder(distant), [urls[1], urls[0], urls[2]]);
  const searchableUrls = ['https://github.com/team/client-one', 'https://gitlab.com/team/server', 'https://github.com/team/client-two'];
  const searchable = await setup(searchableUrls);
  searchable.search('  CLIENT  ');
  assert.equal(searchable.elements.count.textContent, '2 / 3');
  assert.deepEqual(searchable.elements.repositories.children.map(row => row.children[0].href), [searchableUrls[0], searchableUrls[2]]);
  await drag(searchable, 1, 0);
  assert.deepEqual(currentOrder(searchable), [searchableUrls[2], searchableUrls[1], searchableUrls[0]]);
  assert.equal(searchable.elements.repositories.children[0].children[0].href, searchableUrls[2]);
  searchable.search('missing-repository');
  assert.equal(searchable.elements.repositories.children.length, 0);
  assert.equal(searchable.elements['no-results'].hidden, false);
  assert.equal(searchable.elements['empty-state'].hidden, true);
  assert.equal(searchable.elements.count.textContent, '0 / 3');
  searchable.elements['repo-search'].listeners.keydown({key: 'Escape', preventDefault() {}});
  assert.equal(searchable.elements.repositories.children.length, 3);
  assert.equal(searchable.elements['no-results'].hidden, true);
  searchable.search('GITLAB.COM');
  assert.equal(searchable.elements.repositories.children.length, 1);
  await searchable.elements.repositories.children[0].children[1].listeners.click();
  assert.deepEqual(currentOrder(searchable), [searchableUrls[2], searchableUrls[0]]);
  assert.equal(searchable.elements['no-results'].hidden, false);
  searchable.search('');
  assert.equal(searchable.elements.count.textContent, '2');
  const emptySearch = await setup();
  emptySearch.search('client');
  assert.equal(emptySearch.elements['empty-state'].hidden, false);
  assert.equal(emptySearch.elements['no-results'].hidden, true);
  const sharedView = await setup([urls[0]]);
  sharedView.externalUpdate([urls[2], urls[1]]);
  assert.deepEqual(sharedView.elements.repositories.children.map(row => row.children[0].href), [urls[2], urls[1]]);
  sharedView.externalUpdate(undefined);
  assert.equal(sharedView.elements.repositories.children.length, 0);
  const shortcutsFor = app => app.elements.repositories.children[0].children[2].children;
  const github = await setup(['https://github.com/team/project/pulls?q=is%3Aopen']);
  const githubLinks = shortcutsFor(github);
  assert.deepEqual(githubLinks.map(link => link.title), ['Open Pull requests in current tab', 'Open Issues in current tab', 'Open Dependabot alerts in current tab']);
  assert.deepEqual(githubLinks.map(link => new URL(link.href).pathname), ['/team/project/pulls', '/team/project/issues', '/team/project/security/dependabot']);
  assert.equal(new URL(githubLinks[0].href).searchParams.get('q'), 'is:pr is:open -author:app/dependabot');
  assert.equal(new URL(githubLinks[1].href).search, '');
  assert.equal(new URL(githubLinks[2].href).searchParams.get('q'), 'is:open severity:critical,high');
  github.setPanel();
  for (const shortcut of githubLinks) await shortcut.listeners.click({preventDefault() {}});
  assert.deepEqual(github.navigation.updates.map(value => value.url), githubLinks.map(link => link.href));
  assert.equal(github.navigation.closed, 0);
  github.navigation.fail = true;
  await githubLinks[0].listeners.click({preventDefault() {}});
  assert.match(github.elements.status.textContent, /Could not open/);
  assert.equal(github.navigation.closed, 0);
  github.navigation.fail = false;
  github.navigation.missingTab = true;
  await githubLinks[1].listeners.click({preventDefault() {}});
  assert.equal(github.navigation.updates.length, 3);
  const gitlab = await setup(['https://gitlab.com/group/subgroup/project/-/issues/123']);
  assert.deepEqual(shortcutsFor(gitlab).map(link => link.href), ['https://gitlab.com/group/subgroup/project/-/merge_requests', 'https://gitlab.com/group/subgroup/project/-/issues', 'https://gitlab.com/group/subgroup/project/-/pipelines']);
  const bitbucket = await setup(['https://bitbucket.org/team/project/src/main']);
  assert.deepEqual(shortcutsFor(bitbucket).map(link => link.href), ['https://bitbucket.org/team/project/pull-requests', 'https://bitbucket.org/team/project/issues', 'https://bitbucket.org/team/project/pipelines']);
  const enterprise = await setup(['https://git.example.com/team/project/actions/runs/123']);
  assert.equal(shortcutsFor(enterprise)[2].href, 'https://git.example.com/team/project/security/dependabot');
  const renamed = await setup(urls);
  const firstRow = app => app.elements.repositories.children[0];
  const rowControl = (app, className) => firstRow(app).children.find(child => child.className === className);
  const displayedTitle = app => firstRow(app).children[0].children[0].children[0].textContent;
  await rowControl(renamed, 'rename').listeners.click();
  let editor = rowControl(renamed, 'rename-input');
  assert.equal(editor.value, 'first');
  assert.equal(firstRow(renamed).draggable, false);
  editor.value = 'Client fixture-€';
  editor.listeners.input();
  await editor.listeners.keydown({key: 'Enter', preventDefault() {}});
  assert.equal(displayedTitle(renamed), 'Client fixture-€');
  assert.equal(renamed.titles()[urls[0]], 'Client fixture-€');
  assert.deepEqual(currentOrder(renamed), urls);
  assert.equal(firstRow(renamed).children[0].href, urls[0]);
  assert.equal(firstRow(renamed).draggable, true);
  const renamedReload = await setup(renamed.persisted(), false, renamed.titles());
  assert.equal(displayedTitle(renamedReload), 'Client fixture-€');
  renamed.search('FIXTURE-€');
  assert.equal(renamed.elements.repositories.children.length, 1);
  renamed.search('');
  await rowControl(renamed, 'rename').listeners.click();
  editor = rowControl(renamed, 'rename-input');
  editor.value = 'Canceled title';
  editor.listeners.input();
  editor.listeners.keydown({key: 'Escape', preventDefault() {}});
  assert.equal(displayedTitle(renamed), 'Client fixture-€');
  await rowControl(renamed, 'rename').listeners.click();
  editor = rowControl(renamed, 'rename-input');
  editor.value = 'Failed title';
  editor.listeners.input();
  renamed.failWrite(true);
  await rowControl(renamed, 'rename').listeners.click();
  assert.equal(renamed.titles()[urls[0]], 'Client fixture-€');
  assert.equal(rowControl(renamed, 'rename-input').value, 'Failed title');
  assert.match(renamed.elements.status.textContent, /Could not save/);
  renamed.failWrite(false);
  editor = rowControl(renamed, 'rename-input');
  editor.value = '  ';
  editor.listeners.input();
  await rowControl(renamed, 'rename').listeners.click();
  assert.equal(displayedTitle(renamed), 'first');
  assert.equal(renamed.titles()[urls[0]], undefined);
  renamed.externalTitles({[urls[0]]: 'External title'});
  assert.equal(displayedTitle(renamed), 'External title');
  await drag(renamed, 0, 2, true);
  assert.equal(renamed.titles()[urls[0]], 'External title');
  renamed.search('External title');
  await firstRow(renamed).children[1].listeners.click();
  assert.equal(renamed.titles()[urls[0]], undefined);
  assert.equal(renamed.persisted().includes(urls[0]), false);
  const invalid = await setup(['javascript:alert(1)', null, 'https://github.com/owner/repo', 'https://github.com/owner/repo/']);
  assert.equal(invalid.elements.count.textContent, '1');
  const failed = await setup([], true);
  assert.match(failed.elements.status.textContent, /Could not load/);
  const manifest = JSON.parse(fs.readFileSync(`${extensionDirectory}/manifest.json`, 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  if (firefox) {
    assert.deepEqual(manifest.permissions, ['storage']);
    assert.equal(manifest.sidebar_action.default_panel, 'popup.html?view=panel');
    assert.equal(manifest.sidebar_action.open_at_install, false);
    assert.equal(manifest.minimum_chrome_version, undefined);
    assert.equal(manifest.side_panel, undefined);
    assert.ok(manifest.browser_specific_settings.gecko.id);
    assert.deepEqual(manifest.browser_specific_settings.gecko.data_collection_permissions.required, ['none']);
    assert.equal(source.includes('chrome.'), false);
  } else {
    assert.deepEqual(manifest.permissions, ['storage', 'sidePanel']);
    assert.equal(manifest.side_panel.default_path, 'popup.html?view=panel');
  }
  assert.deepEqual(manifest.host_permissions, ['https://github.com/*']);
  assert.equal(manifest.content_scripts.length, 1);
  assert.deepEqual(manifest.content_scripts[0].matches, ['https://github.com/*']);
  assert.deepEqual(manifest.content_scripts[0].js, ['github-counts.js', 'github-reader.js']);
  for (const name of ['github-counts.js', 'github-reader.js', 'badges.js']) assert.ok(fs.existsSync(`${extensionDirectory}/${name}`), name);
  for (const path of [manifest.action.default_popup, ...Object.values(manifest.icons)]) {
    assert.ok(fs.existsSync(`${extensionDirectory}/${path}`), path);
  }
  console.log('PASS: repository operations, drag reorder, rename save/cancel/reset/failure, persisted titles, title search and cross-view updates, title cleanup on delete, current-tab navigation, provider shortcuts, panel behavior, manifest assets.');
})().catch(error => { console.error(error); process.exitCode = 1; });
