/* THE SCRATCHPAD CAPTURE COUNT GATE.
 *
 * The room 00 dashboard shows "daily notes" and "quick captures" side by
 * side. The capture count accepted fourteen bare digits and nothing else, a
 * shape the scaffold never writes: a quick capture is named
 * YYYY-MM-DD-HHmmss (Obsidian's Unique note creator, which the plugin's own
 * new-note button runs), the older YYYYMMDDHHmm shape is still accepted, and
 * each carries its tool's collision suffix. So the slab read 0 in every vault
 * that follows the naming rule while the daily-note count beside it was right
 * (issue #3).
 *
 * Behaviour through renderScratchpad on the real RoomDashboardView class over
 * the fake DOM, so the number is measured where the member reads it, not on
 * a regex alone. The file names are invented; the shapes are the scaffold
 * validator's.
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

const ROOM = '00 Daily Scratchpad';
const MONTH = ROOM + '/2026/03';

function loadPlugin() {
  const obsidian = {
    Plugin: class { constructor(app, manifest) { this.app = app; this.manifest = manifest; } },
    ItemView: class { constructor(leaf) { this.leaf = leaf; this.contentEl = new FakeEl('div'); } },
    Notice: class { constructor() {} },
    requestUrl: async () => { throw new Error('no network in this gate'); },
    setIcon: (el, icon) => { el.attrs['data-icon'] = icon; },
    Platform: { isDesktopApp: true, isMobileApp: false },
    PluginSettingTab: class { constructor(app, plugin) { this.app = app; this.plugin = plugin; } },
    Setting: class {},
  };
  const doc = {
    createElementNS: (ns, tag) => makeEl(tag),
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  const sandbox = {
    require: (name) => (name === 'obsidian' ? obsidian : nodeRequire(name)),
    module: { exports: {} },
    document: doc,
    window: { setTimeout, clearTimeout, requestAnimationFrame: () => {}, open() {} },
    IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
    MutationObserver: class { observe() {} disconnect() {} },
    performance: { now: () => 0 },
    createDiv: (opts) => makeEl('div', opts),
    createSpan: (opts) => makeEl('span', opts),
    console,
    setTimeout,
    clearTimeout,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'main.js' });
  return sandbox.module.exports;
}

/* A TFile with the fields the room view reads: path, name, basename,
   extension, stat. Nothing is stamped, so every note is "waiting". */
function file(path) {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return {
    path, name,
    basename: name.slice(0, dot),
    extension: name.slice(dot + 1),
    stat: { mtime: 0, ctime: 0 },
  };
}

/* Renders room 00 over the given files and reads the slab band back as
   { label: number }, the way the member reads it. */
function slabs(paths) {
  const exported = loadPlugin();
  const files = paths.map(file);
  const plugin = {
    app: {
      vault: { getFiles: () => files },
      metadataCache: { getFileCache: () => null },
      workspace: { getLeaf: () => ({ openFile() {} }) },
    },
  };
  const view = new exported.RoomDashboardView({}, plugin);
  const body = view.contentEl.createDiv({ cls: 'micor-page' });
  view.renderScratchpad(body);
  const out = {};
  for (const slab of body.querySelectorAll('.micor-slab')) {
    out[slab.querySelector('span').textContent] = Number(slab.querySelector('b').textContent);
  }
  return out;
}

/* ---------------------------------------------------------- BEHAVIOUR -- */

test('captures named YYYY-MM-DD-HHmmss are counted, with the -N collision suffix', () => {
  const s = slabs([
    ROOM + '/README.md',
    MONTH + '/2026-03-04.md',
    MONTH + '/2026-03-05.md',
    MONTH + '/2026-03-05-080232.md',
    MONTH + '/2026-03-05-143000.md',
    MONTH + '/2026-03-05-143000-1.md',
    MONTH + '/2026-03-05_canvas.canvas',
  ]);
  assert.equal(s['daily notes'], 2);
  assert.equal(s['quick captures'], 3);
});

test('the older YYYYMMDDHHmm shape still counts, with Obsidian\'s " 2" suffix and a " - title"', () => {
  const s = slabs([
    MONTH + '/202603051430.md',
    MONTH + '/202603051430 2.md',
    MONTH + '/202603051430 - standup.md',
  ]);
  assert.equal(s['daily notes'], 0);
  assert.equal(s['quick captures'], 3);
});

test('the fourteen-digit YYYYMMDDHHmmss shape keeps counting, so no existing count drops', () => {
  const s = slabs([
    MONTH + '/20260305143000.md',
    MONTH + '/20260305143000-1.md',
  ]);
  assert.equal(s['quick captures'], 2);
});

test('a daily note, a subject note, a canvas and the README are not captures', () => {
  const s = slabs([
    ROOM + '/README.md',
    MONTH + '/2026-03-05.md',
    MONTH + '/Untitled.md',
    MONTH + '/Untitled 2.md',
    MONTH + '/Omarchy.md',
    MONTH + '/2026-03-05_canvas.canvas',
  ]);
  assert.equal(s['daily notes'], 1);
  assert.equal(s['quick captures'], 0);
});

test('all three shapes add up, and the counts beside them are untouched', () => {
  const s = slabs([
    ROOM + '/README.md',
    MONTH + '/2026-03-03.md',
    MONTH + '/2026-03-04.md',
    MONTH + '/2026-03-05.md',
    MONTH + '/2026-03-05-080232.md',
    MONTH + '/2026-03-05-143000.md',
    MONTH + '/2026-03-05-143000-1.md',
    MONTH + '/202603051430.md',
    MONTH + '/202603051430 2.md',
    MONTH + '/20260305143000.md',
    MONTH + '/Omarchy.md',
  ]);
  assert.equal(s['daily notes'], 3);
  assert.equal(s['quick captures'], 6);
  assert.equal(s['waiting for processing'], 10, 'every note but the README is unstamped');
  assert.equal(s['processed and stamped'], 0);
});
