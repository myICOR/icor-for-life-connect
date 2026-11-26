/* THE RIBBON GATE (0.18.1).
 *
 * Tom, 2026-11-23: the row of icons under the logo goes, and every plugin's
 * launcher moves to Obsidian's own ribbon on the left, where a member can
 * reorder or hide it in Settings, Appearance, Ribbon menu. Up to 0.18.0 this
 * plugin put four buttons into the file explorer's tool-button row (today's
 * daily note, New unique note, a new canvas in Daily Notes, the graph view).
 * They are gone; the four commands stay, and Obsidian's own Daily notes,
 * Unique note creator, Canvas and Graph view plugins carry ribbon icons of
 * their own.
 *
 * Behaviour, not source text: the real main.js is loaded against the fake
 * DOM, onload runs with the layout ready, a layout change fires, the attach
 * pass runs again the way the explorer observer runs it, and then:
 *
 *   1. the host's row holds exactly what the host put there;
 *   2. exactly one ribbon icon is registered, with a tooltip, and it opens
 *      the dashboard through the same function as its command;
 *   3. unload still sweeps the four retired buttons an in-place upgrade from
 *      0.18.0 or earlier can leave behind.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(resolve(repo, 'main.js'), 'utf8');
const nodeRequire = createRequire(import.meta.url);

import { FakeEl, makeEl } from './fake-dom.mjs';

/* ------------------------------------------------------------- harness -- */

const HOST_ROW = ['Change sort order', 'Collapse all'];

function loadPlugin() {
  const commands = new Map();
  const ribbons = [];
  const layoutHandlers = [];

  const body = new FakeEl('body');
  const explorer = body.createDiv({ cls: 'workspace-leaf-content', attr: { 'data-type': 'file-explorer' } });
  const bar = explorer.createDiv({ cls: 'nav-buttons-container' });
  for (const label of HOST_ROW) bar.createDiv({ cls: 'clickable-icon nav-action-button', attr: { 'aria-label': label } });

  const doc = {
    body,
    querySelector: (sel) => body.querySelector(sel),
    querySelectorAll: (sel) => body.querySelectorAll(sel),
  };

  const obsidian = {
    Plugin: class {
      constructor(app, manifest) { this.app = app; this.manifest = manifest; }
      addCommand(cmd) { commands.set(cmd.id, cmd); }
      addRibbonIcon(icon, title, callback) {
        const el = makeEl('div', { cls: 'side-dock-ribbon-action', attr: { 'aria-label': title } });
        ribbons.push({ icon, title, callback, el });
        return el;
      }
      addSettingTab() {}
      registerView() {}
      registerEvent() {}
      async loadData() { return null; }
      async saveData() {}
    },
    ItemView: class { constructor(leaf) { this.leaf = leaf; } },
    Notice: class { constructor() {} },
    requestUrl: async () => { throw new Error('no network in this gate'); },
    setIcon: (el, icon) => { el.attrs['data-icon'] = icon; },
    Platform: { isDesktopApp: true, isMobileApp: false },
    PluginSettingTab: class { constructor(app, plugin) { this.app = app; this.plugin = plugin; } },
    Setting: class {},
  };

  const sandbox = {
    require: (name) => (name === 'obsidian' ? obsidian : nodeRequire(name)),
    module: { exports: {} },
    document: doc,
    window: { setTimeout, clearTimeout, open() {} },
    MutationObserver: class { observe() {} disconnect() {} },
    performance: { now: () => 0 },
    createDiv: (opts) => makeEl('div', opts),
    createSpan: (opts) => makeEl('span', opts),
    console, setTimeout, clearTimeout, URL,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'main.js' });

  const PluginClass = sandbox.module.exports;
  const app = {
    commands: { executeCommandById: () => true },
    workspace: {
      onLayoutReady: (cb) => cb(),
      on: (evt, cb) => { if (evt === 'layout-change') layoutHandlers.push(cb); return {}; },
    },
    vault: { getAbstractFileByPath: () => null, getRoot: () => ({ children: [] }) },
    setting: { open() {} },
  };
  const plugin = new PluginClass(app, { id: 'icor-for-life-connect', version: '0.0.0-gate' });
  /* Secrets have their own gate; this one is about where the entry points are. */
  plugin.initSecrets = async () => {};
  return { plugin, body, bar, commands, ribbons, layoutHandlers };
}

const rowLabels = (bar) => bar.children.map((el) => el.getAttribute('aria-label') || [...el.classSet].join('.'));

/* --------------------------------------------------------------- gates -- */

test('nothing is written into the file explorer\'s tool-button row', async () => {
  const { plugin, bar, layoutHandlers } = loadPlugin();
  await plugin.onload();
  for (const cb of layoutHandlers) cb();
  plugin.attachRoomButtons();
  plugin.attachRoomButtons(); /* the explorer observer fires more than once */
  assert.deepEqual(rowLabels(bar), HOST_ROW, 'the plugin put something into .nav-buttons-container');
});

test('exactly one ribbon icon, with a tooltip, opening the dashboard like its command', async () => {
  const { plugin, ribbons, commands } = loadPlugin();
  let opened = 0;
  plugin.activateDashboard = () => { opened += 1; };
  await plugin.onload();
  assert.equal(ribbons.length, 1, `addRibbonIcon was called ${ribbons.length} times`);
  assert.equal(ribbons[0].title, 'Open myICOR dashboard');
  assert.ok(ribbons[0].icon, 'the ribbon icon names a glyph');
  const command = commands.get('open-dashboard');
  assert.ok(command, 'the open-dashboard command is registered');
  assert.equal(command.name, ribbons[0].title, 'the ribbon tooltip and the command say the same thing');
  ribbons[0].callback({});
  command.callback();
  assert.equal(opened, 2, 'the ribbon icon and the command both open the dashboard');
});

test('the four vault actions stay as commands', async () => {
  const { plugin, commands } = loadPlugin();
  await plugin.onload();
  for (const id of ['open-daily-note', 'new-unique-note', 'new-scratchpad-canvas', 'open-graph-view']) {
    assert.ok(commands.has(id), id + ' is no longer a command');
  }
});

test('unload sweeps the retired row buttons an in-place upgrade leaves behind', () => {
  const { plugin, bar, body } = loadPlugin();
  const RETIRED = ['micor-daily-note', 'micor-unique-note', 'micor-new-canvas', 'micor-graph-view', 'micor-toolbar-extra'];
  for (const cls of RETIRED) bar.createDiv({ cls: 'clickable-icon nav-action-button ' + cls });
  plugin.onunload();
  for (const cls of RETIRED) assert.equal(body.querySelectorAll('.' + cls).length, 0, cls + ' survived unload');
  assert.deepEqual(rowLabels(bar), HOST_ROW, 'the host\'s own controls must survive the sweep');
});
