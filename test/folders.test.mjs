/* THE FOLDERS GATE (0.18.0, ICOR for Life 3.0).
 *
 * The vault's folders are grouped by ICOR stage and renumbered:
 *   Input    00 Daily Notes, 01 Inbox
 *   Control  02 Inner World, 03 Outer World, 04 Assets, 05 Databases
 *   Output   06 Planner
 *   Refine   no folder: the AI and the plugins refine from outside.
 * There is no 03 WiP (the AI gets no area of its own in the vault). This
 * gate holds:
 *
 *   1. THE TABLE: the seven folders in folder order, each with its stage, the
 *      four stages in order, Refine with no folder and its one line.
 *   2. THE BINDING: by full name, never by number. A 3.0 vault binds the new
 *      names; a 2.x vault binds its old ones (04 Inner World, 05 Assets,
 *      02 Planner...) and nothing ever binds to 03 WiP or 06 AI Team, though
 *      06 AI Team and 06 Planner share the 06. A missing folder is announced
 *      as a folder; a plain vault hears nothing.
 *   3. THE PATHS: reflections go into the Inner World the vault really has,
 *      and a saved dashboard path from before the rename reopens the right
 *      folder.
 *   4. THE DASHBOARD: every folder page opens with the folders by stage, in
 *      order, with the stage as its kicker; no member-visible "room" anywhere.
 *   5. THE OUTER WORLD PAGE: renderOuter's counts, unchanged.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';

import { FakeEl, makeEl } from './fake-dom.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(resolve(repo, 'main.js'), 'utf8');
const nodeRequire = createRequire(import.meta.url);
const clone = (v) => JSON.parse(JSON.stringify(v));

/* A fresh module per call: resolveFolders writes the bound path into FOLDERS. */
function loadPlugin({ notices = [], logs = [] } = {}) {
  const obsidian = {
    Plugin: class { constructor(app, manifest) { this.app = app; this.manifest = manifest; } },
    ItemView: class { constructor(leaf) { this.leaf = leaf; this.contentEl = new FakeEl('div'); } },
    Notice: class { constructor(msg) { notices.push(String(msg)); } },
    requestUrl: async () => { throw new Error('no network in this gate'); },
    setIcon: (el, icon) => { el.attrs['data-icon'] = icon; },
    Platform: { isDesktopApp: true, isMobileApp: false },
    PluginSettingTab: class { constructor(app, plugin) { this.app = app; this.plugin = plugin; } },
    Setting: class {},
  };
  const spyConsole = {};
  for (const k of ['log', 'warn', 'error', 'info', 'debug']) spyConsole[k] = (...a) => logs.push(a.map(String).join(' '));
  const sandbox = {
    require: (name) => (name === 'obsidian' ? obsidian : nodeRequire(name)),
    module: { exports: {} },
    document: { createElementNS: (ns, tag) => makeEl(tag), querySelector: () => null, querySelectorAll: () => [] },
    window: { setTimeout, clearTimeout, requestAnimationFrame: () => {}, open() {} },
    IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
    MutationObserver: class { observe() {} disconnect() {} },
    performance: { now: () => 0 },
    createDiv: (opts) => makeEl('div', opts),
    createSpan: (opts) => makeEl('span', opts),
    console: spyConsole,
    setTimeout,
    clearTimeout,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'main.js' });
  return sandbox.module.exports;
}

/* A vault root with these top-level folders, for resolveFolders. */
function vaultWith(folders) {
  return {
    getRoot: () => ({ children: folders.map((name) => ({ name, children: [] })) }),
    getAbstractFileByPath: (p) => (folders.includes(p) ? { path: p, children: [] } : null),
  };
}

function bind(folders) {
  const notices = [];
  const logs = [];
  const M = loadPlugin({ notices, logs });
  const plugin = Object.create(M.prototype);
  plugin.app = { vault: vaultWith(folders) };
  plugin.resolveFolders();
  return { M, plugin, notices, logs, paths: Object.fromEntries(M.FOLDERS.map((f) => [f.key, f.path])) };
}

const NEW = ['00 Daily Notes', '01 Inbox', '02 Inner World', '03 Outer World', '04 Assets', '05 Databases', '06 Planner'];
const OLD = ['00 Daily Scratchpad', '01 Inbox', '02 Planner', '03 WiP', '04 Inner World', '05 Assets', '06 AI Team', '07 Databases'];

/* ------------------------------------------------------- 1. THE TABLE -- */

test('the folders are 00 to 06 in folder order, each in its ICOR stage, with no WiP', () => {
  const M = loadPlugin();
  assert.deepEqual(clone(M.FOLDERS.map((f) => f.path)), NEW);
  assert.deepEqual(clone(M.FOLDERS.map((f) => f.stage)), ['input', 'input', 'control', 'control', 'control', 'control', 'output']);
  assert.deepEqual(clone(M.FOLDERS.map((f) => f.key)), ['daily', 'inbox', 'inner', 'outer', 'assets', 'databases', 'planner']);
  assert.deepEqual(clone(M.FOLDERS.map((f) => f.legacy)), [
    ['00 Daily Scratchpad'], ['01 INBOX'], ['04 Inner World'], ['06 Outer World'], ['05 Assets'], ['07 Databases'], ['02 Planner'],
  ]);
  assert.doesNotMatch(source, /03 WiP|renderWip|key: 'wip'|wip: \(\)/, 'no WiP folder, page or dispatch');
});

test('the stages are Input, Control, Output and Refine, and Refine has no folder, only a line', () => {
  const M = loadPlugin();
  assert.deepEqual(clone(M.STAGES.map((s) => s.label)), ['Input', 'Control', 'Output', 'Refine']);
  assert.equal(M.FOLDERS.filter((f) => f.stage === 'refine').length, 0);
  const refine = M.STAGES.find((s) => s.key === 'refine');
  assert.match(refine.about, /^No folder\. The AI and the plugins .* refine from outside/);
  assert.equal(M.folderKicker(M.FOLDERS[2]), 'CONTROL · 02 INNER WORLD');
  assert.equal(M.folderKicker(M.FOLDERS[6]), 'OUTPUT · 06 PLANNER');
});

/* ----------------------------------------------------- 2. THE BINDING -- */

test('a 3.0 vault binds every folder by its new name and hears nothing', () => {
  const b = bind(NEW);
  assert.deepEqual(Object.values(b.paths), NEW);
  assert.deepEqual(b.notices, []);
  assert.deepEqual(b.logs, []);
});

test('a 2.x vault binds its old names, hears nothing, and never binds to 03 WiP or 06 AI Team', () => {
  const b = bind(OLD);
  assert.deepEqual(b.paths, {
    daily: '00 Daily Scratchpad', inbox: '01 Inbox', inner: '04 Inner World', outer: '03 Outer World',
    assets: '05 Assets', databases: '07 Databases', planner: '02 Planner',
  }, 'the Outer World keeps its 3.0 default, which no folder matches, so no button lands anywhere');
  assert.deepEqual(b.notices, []);
  for (const p of Object.values(b.paths)) assert.ok(p !== '03 WiP' && p !== '06 AI Team', p);
});

test('a number is never a match: 06 AI Team beside 06 Planner, 04 Inner World beside 04 Assets', () => {
  const both = bind([...NEW, '06 AI Team', '03 WiP']);
  assert.deepEqual(Object.values(both.paths), NEW, 'leftover 2.x folders change nothing');
  const half = bind(['00 Daily Notes', '01 Inbox', '04 Assets', '06 AI Team']);
  assert.equal(half.paths.inner, '02 Inner World', 'no Inner World: the default, never 04 Assets');
  assert.equal(half.paths.planner, '06 Planner', 'no Planner: the default, never 06 AI Team');
  assert.equal(half.notices.length, 1);
  const renamed = bind(['00 Scratch', '01 Eingang', '02 Innenwelt', '04 Dateien', '06 Außenwelt']);
  assert.ok(!Object.values(renamed.paths).some((p) => ['00 Scratch', '02 Innenwelt', '04 Dateien', '06 Außenwelt'].includes(p)));
});

test('a missing folder is announced as a folder, and a plain vault still hears nothing', () => {
  const b = bind(['00 Daily Notes', '01 Inbox', '04 Assets']);
  assert.equal(b.notices.length, 1);
  assert.match(b.notices[0], /this vault has no 02 Inner World folder\. Its dashboard and folder button are unavailable/);
  assert.doesNotMatch(b.notices[0], /\broom/i);
  assert.deepEqual(bind(['Notes', 'Attachments']).notices, [], 'none of the folders: not an ICOR for Life vault, nothing said');
});

/* ------------------------------------------------------- 3. THE PATHS -- */

test('reflections sync into the Inner World the vault really has, and never into 04 Assets', () => {
  assert.equal(bind(NEW).plugin.reflectionsDir(), '02 Inner World/ICOR Journey Notes');
  assert.equal(bind(OLD).plugin.reflectionsDir(), '04 Inner World/ICOR Journey Notes');
  assert.throws(() => bind(['00 Daily Notes', '01 Inbox', '04 Assets']).plugin.reflectionsDir(), /no 02 Inner World folder/);
});

test('a dashboard path saved before the rename reopens the same folder, by name', () => {
  const { M } = bind(NEW);
  assert.equal(M.folderFor('04 Inner World').path, '02 Inner World');
  assert.equal(M.folderFor('06 Outer World').path, '03 Outer World');
  assert.equal(M.folderFor('00 Daily Scratchpad').path, '00 Daily Notes');
  assert.equal(M.folderFor('04 Assets/Images/a.png').key, 'assets');
  assert.equal(M.folderFor('06 AI Team'), null);
  assert.equal(M.folderFor('03 WiP'), null);
});

/* --------------------------------------------------- 4. THE DASHBOARD -- */

const textOf = (el) => [el.textContent || '', ...(el.children || []).map(textOf)].join(' ');

function dashboard(folders, open) {
  const b = bind(folders);
  const plugin = {
    app: {
      vault: { ...vaultWith(folders), getFiles: () => [] },
      metadataCache: { getFileCache: () => null },
      workspace: { getLeaf: () => ({ openFile() {} }) },
    },
  };
  const view = new b.M.RoomDashboardView({}, plugin);
  view.root = view.contentEl;
  view.room = open;
  view.renderRoom();
  return { M: b.M, view };
}

test('every folder page opens with the folders by stage, in order, the open one marked', () => {
  const { view } = dashboard(NEW, '02 Inner World');
  assert.equal(view.root.querySelector('.micor-masthead-kicker').textContent, 'CONTROL · 02 INNER WORLD');
  const stages = view.root.querySelectorAll('.micor-stage').map((row) => ({
    stage: row.querySelector('.micor-stage-label').textContent,
    folders: row.querySelectorAll('.micor-stage-folder').map((c) => c.textContent),
  }));
  assert.deepEqual(stages, [
    { stage: 'Input', folders: ['00 Daily Notes', '01 Inbox'] },
    { stage: 'Control', folders: ['02 Inner World', '03 Outer World', '04 Assets', '05 Databases'] },
    { stage: 'Output', folders: ['06 Planner'] },
    { stage: 'Refine', folders: [] },
  ]);
  assert.match(view.root.querySelector('.micor-stage-refine').querySelector('.micor-stage-about').textContent, /refine from outside/);
  const current = view.root.querySelectorAll('.micor-stage-folder').filter((c) => c.hasClass('is-current'));
  assert.deepEqual(current.map((c) => c.textContent), ['02 Inner World']);
});

test('a click on a folder opens its page in the same view; a folder the vault lacks is shown but does nothing', () => {
  const { view } = dashboard(['00 Daily Notes', '01 Inbox', '02 Inner World', '04 Assets'], '00 Daily Notes');
  const chip = (name) => view.root.querySelectorAll('.micor-stage-folder').find((c) => c.textContent === name);
  assert.equal(chip('06 Planner').getAttribute('disabled'), 'true');
  assert.ok(chip('06 Planner').hasClass('is-missing'));
  chip('04 Assets').click();
  assert.equal(view.room, '04 Assets');
  assert.equal(view.root.querySelector('.micor-masthead-kicker').textContent, 'CONTROL · 04 ASSETS');
});

test('a 2.x vault\'s pages show its own folder names under the same stages', () => {
  const { view } = dashboard(OLD, '04 Inner World');
  assert.equal(view.root.querySelector('.micor-masthead-kicker').textContent, 'CONTROL · 04 INNER WORLD');
  const names = view.root.querySelectorAll('.micor-stage-folder').map((c) => c.textContent);
  assert.deepEqual(names, ['00 Daily Scratchpad', '01 Inbox', '04 Inner World', '03 Outer World', '05 Assets', '07 Databases', '02 Planner']);
  assert.ok(!names.includes('06 AI Team') && !names.includes('03 WiP'));
});

test('no member-visible "room": not on any folder page, not in any string the plugin shows', () => {
  for (const name of NEW) {
    const { view } = dashboard(NEW, name);
    const text = textOf(view.root);
    assert.doesNotMatch(text, /\brooms?\b/i, name + ' page says room');
    assert.doesNotMatch(text, /scaffold|harness|full stack|local folder|03 WiP/i, name + ' page uses a word members must not see');
  }
  /* Every string literal in main.js, comments skipped. Class names such as
     micor-room-btn are identifiers, not words, and are allowed. */
  const strings = [];
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '/' && source[i + 1] === '*') { i = source.indexOf('*/', i + 2) + 1; continue; }
    if (c === '/' && source[i + 1] === '/') { i = source.indexOf('\n', i); continue; }
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < source.length && source[j] !== c && source[j] !== '\n') j += source[j] === '\\' ? 2 : 1;
      strings.push(source.slice(i + 1, j));
      i = j;
    }
  }
  assert.ok(strings.length > 500, 'the scan found the strings');
  const said = strings.filter((t) => /(?<![\w-])rooms?\b(?!-)/i.test(t));
  assert.deepEqual(said, []);
  /* The CSS hook class is an identifier. The OAuth client name is shown on
     app.myicor.com's consent page and is left for Tom to rename there and
     here together. */
  const allowed = (t) => /icor-scaffold-chrome/.test(t) || t === 'ICOR for Life Scaffold (Obsidian)';
  assert.deepEqual(strings.filter((t) => /scaffold|harness|full stack|local folder/i.test(t) && !allowed(t)), []);
});

/* ------------------------------------------ 5. THE OUTER WORLD PAGE -- */

const OUTER = '03 Outer World';
const NOW = new Date();
const THIS_MONTH = NOW.getFullYear() + '-' + String(NOW.getMonth() + 1).padStart(2, '0') + '-02T09:00:00';

function file(path, mtime = 0) {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return { path, name, basename: name.slice(0, dot), extension: name.slice(dot + 1), stat: { mtime, ctime: mtime } };
}

function renderOuter(entries) {
  const M = loadPlugin();
  const files = entries.map(([p, , mtime]) => file(p, mtime || 0));
  const fms = new Map(entries.map(([p, fm]) => [p, fm]));
  const plugin = {
    app: {
      vault: { getFiles: () => files },
      metadataCache: { getFileCache: (f) => (fms.get(f.path) ? { frontmatter: fms.get(f.path) } : null) },
      workspace: { getLeaf: () => ({ openFile() {} }) },
    },
  };
  const view = new M.RoomDashboardView({}, plugin);
  view.room = OUTER;
  const body = view.contentEl.createDiv({ cls: 'micor-page' });
  view.renderOuter(body);
  const slabs = {};
  for (const slab of body.querySelectorAll('.micor-slab')) slabs[slab.querySelector('span').textContent] = slab.querySelector('b').textContent;
  const text = (el) => [el.textContent || '', ...(el.children || []).map(text)].join(' ');
  return { M, slabs, text: text(body) };
}

test('the Outer World counts sources, the reading queue, this month and the linked ones, and skips the README', () => {
  const r = renderOuter([
    [OUTER + '/README.md', null],
    [OUTER + '/Readwise/README.md', null],
    [OUTER + '/Deep Work.md', { type: 'source', source_type: 'book', author: '[[Cal Newport]]', consumed: false, projects: ['[[Focus sprint]]'], captured: THIS_MONTH }, 3],
    [OUTER + '/Readwise/Some article.md', { type: 'source', source_type: 'article', consumed: 'false', topics: [] }, 2],
    [OUTER + '/A talk.md', { type: 'source', source_type: 'video', consumed: true, key_elements: '[[Health]]', captured: '2020-01-01T00:00:00' }, 1],
    [OUTER + '/Scratch thought.md', { type: 'note' }, 4],
  ]);
  assert.equal(r.slabs.sources, '3', 'only type: source counts, READMEs and a stray note do not');
  assert.equal(r.slabs['in the reading queue'], '2', 'consumed false as a checkbox and as text');
  assert.equal(r.slabs['captured this month'], '1');
  assert.equal(r.slabs['linked to what they serve'], '2', 'a project or a Key Element; an empty topics list does not count');
  assert.match(r.text, /THE READING QUEUE/);
  assert.match(r.text, /BOOK · CAL NEWPORT/, 'the kicker reads the type and the author without the link brackets');
  assert.match(r.text, /NOT CONNECTED YET/);
  assert.match(r.text, /Some article/);
  assert.doesNotMatch(r.text, /[–—]/, 'no dashes of either length in the new copy');
});

test('an empty Outer World says where sources come from', () => {
  const r = renderOuter([[OUTER + '/README.md', null]]);
  assert.equal(r.slabs.sources, '0');
  assert.match(r.text, /nothing waiting to be read/);
  assert.match(r.text, /clips from the Web Clipper and highlights from Readwise land here/);
});

test('outerUnread and outerLinked read the schema\'s fields and never nag about a note without them', () => {
  const M = loadPlugin();
  assert.equal(M.outerUnread({ consumed: false }), true);
  assert.equal(M.outerUnread({ consumed: ' False ' }), true);
  assert.equal(M.outerUnread({ consumed: true }), false);
  assert.equal(M.outerUnread({}), false, 'missing counts as read');
  assert.equal(M.outerUnread(null), false);
  assert.equal(M.outerLinked({ projects: ['[[P]]'] }), true);
  assert.equal(M.outerLinked({ topics: '[[T]]' }), true);
  assert.equal(M.outerLinked({ key_elements: [''], projects: [] }), false);
  assert.equal(M.outerLinked({ people: ['[[Someone]]'] }), false, 'people alone do not say what it serves');
  assert.equal(M.outerLinked(undefined), false);
});
