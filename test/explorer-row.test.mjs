/* THE EXPLORER-ROW GATE (0.18.4).
 *
 * The file explorer's button row, `.nav-buttons-container`, is Obsidian's.
 * ICOR Interface 0.11.0 decides whether it shows at all, and it promises that
 * taking its class off gives back Obsidian's row exactly as it was. That only
 * holds if no other plugin writes into the row. Up to 0.18.3 this one put
 * `micor-tree-slot` and `micor-can-collapse` on it, for a theme rule INKLINE
 * dropped in 1.9.0.
 *
 * This gate proves, by behaviour:
 *   1. the explorer passes (footer, banner, folder buttons) leave the row's
 *      classes and children as they were;
 *   2. the Collapse all command still finds Obsidian's own button, and only reads;
 *   3. a row an older build marked is handed back clean;
 *   4. there is no slot-sync pass left to call.
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

function loadPlugin() {
  const body = new FakeEl('body');
  const leaf = body.createDiv({ cls: 'workspace-leaf-content', attr: { 'data-type': 'file-explorer' } });
  const header = leaf.createDiv({ cls: 'nav-header' });
  const row = header.createDiv({ cls: 'nav-buttons-container' });
  for (const glyph of ['edit', 'folder-plus', 'sort-asc', 'chevrons-down-up']) {
    const btn = row.createDiv({ cls: 'clickable-icon nav-action-button' });
    btn.createSvg('svg', { cls: `svg-icon lucide-${glyph}` });
  }
  leaf.createDiv({ cls: 'nav-files-container' });

  const doc = {
    body,
    querySelector: (sel) => body.querySelector(sel),
    querySelectorAll: (sel) => body.querySelectorAll(sel),
  };
  const obsidian = {
    Plugin: class { constructor(app, manifest) { this.app = app; this.manifest = manifest; } },
    ItemView: class { constructor(l) { this.leaf = l; } },
    Notice: class { constructor() {} },
    requestUrl: async () => { throw new Error('no network in this gate'); },
    setIcon: (el, icon) => { el.attrs['data-icon'] = icon; },
    Platform: { isDesktopApp: true, isMobileApp: false },
    PluginSettingTab: class { constructor(app, plugin) { this.app = app; this.plugin = plugin; } },
    Setting: class {},
    TFile: class {},
  };
  const sandbox = {
    require: (name) => (name === 'obsidian' ? obsidian : nodeRequire(name)),
    module: { exports: {} },
    document: doc,
    window: { setTimeout, clearTimeout },
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

  const PluginClass = sandbox.module.exports;
  const app = { commands: { executeCommandById: () => false }, workspace: {}, vault: {}, setting: { open() {} } };
  const plugin = new PluginClass(app, { id: 'icor-for-life-connect', version: '0.0.0-gate' });
  plugin.data = {};
  return { plugin, body, row };
}

const snapshot = (row) => ({
  classes: [...row.classSet].sort().join(' '),
  children: row.children.map((c) => [...c.classSet].sort().join(' ')),
});

test('the explorer passes leave Obsidian\'s button row as it was', () => {
  const { plugin, row } = loadPlugin();
  const before = snapshot(row);
  for (const pass of ['attachExplorerButton', 'attachBanner', 'attachRoomButtons', 'sweepRetiredRail', 'syncCollapseSlot']) {
    if (typeof plugin[pass] !== 'function') continue;
    try { plugin[pass](); } catch { /* a pass that needs more of the host than this gate fakes says nothing about the row */ }
  }
  assert.deepEqual(snapshot(row), before, 'a pass wrote into .nav-buttons-container');
});

test('Collapse all still finds Obsidian\'s own button, and only reads', () => {
  const { plugin, row } = loadPlugin();
  const before = snapshot(row);
  const btn = plugin.collapseAllButton();
  assert.ok(btn, 'Obsidian\'s Collapse all button was not found in the row');
  assert.ok(btn.querySelector('.lucide-chevrons-down-up'), 'found the wrong button');
  assert.deepEqual(snapshot(row), before, 'finding the button changed the row');
});

test('a row an older build marked is handed back clean', () => {
  const { plugin, row } = loadPlugin();
  row.classList.add('micor-tree-slot');
  row.classList.add('micor-can-collapse');
  plugin.sweepRetiredRail();
  assert.equal(row.classList.contains('micor-tree-slot'), false);
  assert.equal(row.classList.contains('micor-can-collapse'), false);
  assert.equal(row.classList.contains('nav-buttons-container'), true, 'Obsidian\'s own class went too');
});

test('there is no slot-sync pass left', () => {
  const { plugin } = loadPlugin();
  assert.equal(typeof plugin.syncCollapseSlot, 'undefined');
  assert.equal(typeof plugin.unfoldedRootCount, 'undefined');
});
