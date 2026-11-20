/* THE ROOMS GATE (0.17.0, ICOR for Life 3.0).
 *
 * Work in progress happens in the agent harness, not in the vault, so room
 * 03 is gone and only finished work comes in, as objects. Room 06 is the
 * Outer World: what others made, one `type: source` note per book, article,
 * video, podcast, post or paper. This gate holds:
 *
 *   1. THE TABLE: the five rooms in room order, no WiP, the Outer World after
 *      Assets with the copy the vault uses.
 *   2. THE BINDING: a 3.0 vault binds every room and hears nothing; a vault
 *      made before 3.0 (with 03 WiP and the retired 06 AI Team) hears nothing
 *      either, and the Outer World never binds to 06 AI Team; a missing room
 *      that is not optional is still announced.
 *   3. THE DASHBOARD: renderOuter counts sources, the reading queue
 *      (`consumed: false`), this month's captures and the linked ones, on the
 *      real RoomDashboardView over the fake DOM.
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

/* A fresh module per call: resolveRooms writes the bound path into ROOMS. */
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

/* A vault root with these top-level folders, for resolveRooms. */
function vaultWith(folders) {
  return { getRoot: () => ({ children: folders.map((name) => ({ name, children: [] })) }) };
}

function bind(folders) {
  const notices = [];
  const logs = [];
  const M = loadPlugin({ notices, logs });
  const plugin = Object.create(M.prototype);
  plugin.app = { vault: vaultWith(folders) };
  plugin.resolveRooms();
  return { M, notices, logs, paths: Object.fromEntries(M.ROOMS.map((r) => [r.key, r.path])) };
}

/* ------------------------------------------------------- 1. THE TABLE -- */

test('the rooms are 00, 01, 04, 05 and 06 in room order: no WiP, the Outer World after Assets', () => {
  const M = loadPlugin();
  assert.deepEqual(clone(M.ROOMS.map((r) => r.room)), ['00', '01', '04', '05', '06']);
  assert.deepEqual(clone(M.ROOMS.map((r) => r.key)), ['scratchpad', 'inbox', 'inner', 'assets', 'outer']);
  const outer = clone(M.ROOMS.find((r) => r.key === 'outer'));
  assert.deepEqual(
    { room: outer.room, path: outer.path, key: outer.key, title: outer.title, hand: outer.hand, kicker: outer.kicker },
    { room: '06', path: '06 Outer World', key: 'outer', title: 'The Outer World.', hand: 'what others made', kicker: 'ROOM 06 · OUTER WORLD' },
  );
  assert.equal(outer.optional, true);
  assert.deepEqual(clone(outer.retired), ['06 AI Team']);
  assert.doesNotMatch(source, /03 WiP|renderWip|key: 'wip'|wip: \(\)/);
  assert.match(source, /outer: \(\) => this\.renderOuter\(body\),/, 'the room view dispatches to the Outer World');
});

/* ----------------------------------------------------- 2. THE BINDING -- */

test('a 3.0 vault binds every room, the Outer World included, and hears nothing', () => {
  const b = bind(['00 Daily Scratchpad', '01 Inbox', '02 Planner', '04 Inner World', '05 Assets', '06 Outer World', '07 Databases']);
  assert.equal(b.paths.outer, '06 Outer World');
  assert.equal(b.paths.inner, '04 Inner World');
  assert.deepEqual(b.notices, []);
  assert.deepEqual(b.logs, []);
});

test('a vault made before 3.0 hears nothing, and the Outer World never binds to 06 AI Team', () => {
  const b = bind(['00 Daily Scratchpad', '01 Inbox', '02 Planner', '03 WiP', '04 Inner World', '05 Assets', '06 AI Team']);
  assert.deepEqual(b.notices, [], 'the missing Outer World is not announced');
  assert.equal(b.paths.outer, '06 Outer World', 'still the declared default, which no folder matches, so no button lands on 06 AI Team');
  const both = bind(['00 Daily Scratchpad', '01 Inbox', '04 Inner World', '05 Assets', '06 AI Team', '06 Outer World']);
  assert.equal(both.paths.outer, '06 Outer World', 'with both folders, the retired one is skipped');
  const renamed = bind(['00 Scratch', '01 Eingang', '04 Innenwelt', '05 Dateien', '06 Außenwelt']);
  assert.equal(renamed.paths.outer, '06 Außenwelt', 'a renamed Outer World is still found by its number');
  assert.deepEqual(renamed.notices, []);
});

test('a missing room that is not optional is still announced, and a plain vault still hears nothing', () => {
  const b = bind(['00 Daily Scratchpad', '01 Inbox', '05 Assets']);
  assert.equal(b.notices.length, 1);
  assert.match(b.notices[0], /this vault has no room 04\./, 'only the real gap, not 06');
  assert.deepEqual(bind(['Notes', 'Attachments']).notices, [], 'no numbered rooms at all: not an ICOR vault, nothing said');
});

/* --------------------------------------------------- 3. THE DASHBOARD -- */

const ROOM = '06 Outer World';
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
  view.room = ROOM;
  const body = view.contentEl.createDiv({ cls: 'micor-page' });
  view.renderOuter(body);
  const slabs = {};
  for (const slab of body.querySelectorAll('.micor-slab')) slabs[slab.querySelector('span').textContent] = slab.querySelector('b').textContent;
  const text = (el) => [el.textContent || '', ...(el.children || []).map(text)].join(' ');
  return { M, slabs, text: text(body) };
}

test('the Outer World counts sources, the reading queue, this month and the linked ones, and skips the README', () => {
  const r = renderOuter([
    [ROOM + '/README.md', null],
    [ROOM + '/Readwise/README.md', null],
    [ROOM + '/Deep Work.md', { type: 'source', source_type: 'book', author: '[[Cal Newport]]', consumed: false, projects: ['[[Focus sprint]]'], captured: THIS_MONTH }, 3],
    [ROOM + '/Readwise/Some article.md', { type: 'source', source_type: 'article', consumed: 'false', topics: [] }, 2],
    [ROOM + '/A talk.md', { type: 'source', source_type: 'video', consumed: true, key_elements: '[[Health]]', captured: '2020-01-01T00:00:00' }, 1],
    [ROOM + '/Scratch thought.md', { type: 'note' }, 4],
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
  const r = renderOuter([[ROOM + '/README.md', null]]);
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
