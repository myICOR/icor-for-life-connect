/* THE TOP-ROW BUTTON GATE.
 *
 * The right sidebar's tab-header row used to carry a plugin-injected
 * terminal shortcut alongside the settings gear, wired to the retired
 * third-party Terminal plugin's command
 * (`terminal:open-terminal.integrated.root`). That route is gone: the
 * terminal is ICOR for Life - Terminal now, launched from its own toolbar
 * entry under the ICOR for Life logo in the left side panel, not from this
 * row. This gate proves the removal is real and stays real:
 *
 *   1. attachTopButtons() never creates a `.micor-top-terminal` node, even
 *      though the row it targets exists;
 *   2. the settings gear is still there and still opens settings;
 *   3. re-running the attach pass never duplicates the gear (the guard used
 *      to key off the now-removed terminal button; it has to key off the
 *      gear itself once the terminal button is gone, or every reflow would
 *      insert a second gear);
 *   4. unload takes the gear away like every other `.micor-top-btn`.
 *
 * Behaviour, not source text: a grep for the class name would stay green on
 * a guard that still checks for a node nothing creates any more.
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
  const opened = [];

  const body = new FakeEl('body');
  const rightSplit = body.createDiv({ cls: 'workspace-split mod-right-split' });
  const header = rightSplit.createDiv({ cls: 'workspace-tab-header-container' });

  const doc = {
    body,
    querySelector: (sel) => body.querySelector(sel),
    querySelectorAll: (sel) => body.querySelectorAll(sel),
  };

  const obsidian = {
    Plugin: class { constructor(app, manifest) { this.app = app; this.manifest = manifest; } },
    ItemView: class { constructor(leaf) { this.leaf = leaf; } },
    Notice: class { constructor() {} },
    requestUrl: async () => { throw new Error('no network in this gate'); },
    setIcon: (el, icon) => { el.attrs['data-icon'] = icon; },
    Platform: { isDesktopApp: true, isMobileApp: false },
    /* 0.15.0: main.js declares a settings tab, which extends this at
       module load; a stub keeps this gate about its own subject. */
    PluginSettingTab: class { constructor(app, plugin) { this.app = app; this.plugin = plugin; } },
    Setting: class {},
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
  const app = {
    commands: { executeCommandById: () => false },
    workspace: {},
    vault: {},
    setting: { open: () => opened.push('settings') },
  };
  const plugin = new PluginClass(app, { id: 'icor-for-life-connect', version: '0.0.0-gate' });
  plugin.data = {};
  return { plugin, body, header, opened };
}

test('attachTopButtons never creates a terminal button', () => {
  const { plugin, header } = loadPlugin();
  plugin.attachTopButtons();
  assert.equal(
    header.querySelectorAll('.micor-top-terminal').length, 0,
    'a .micor-top-terminal node was created; the terminal lives in ICOR for '
    + 'Life - Terminal now, launched from its own toolbar entry, not here',
  );
});

test('the settings gear is in the row and still opens settings', () => {
  const { plugin, header, opened } = loadPlugin();
  plugin.attachTopButtons();
  const gear = header.querySelector('.micor-top-settings');
  assert.ok(gear, 'the settings gear is missing from the row');
  assert.equal(gear.getAttribute('aria-label'), 'Settings');
  gear.click();
  assert.deepEqual(opened, ['settings'], 'the gear did not call app.setting.open()');
});

test('re-running the attach pass never duplicates the gear', () => {
  const { plugin, header } = loadPlugin();
  plugin.attachTopButtons();
  plugin.attachTopButtons();
  plugin.attachTopButtons();
  assert.equal(
    header.querySelectorAll('.micor-top-settings').length, 1,
    'the guard let a second gear in once it stopped keying off the retired '
    + 'terminal button',
  );
});

test('unload removes the gear like every other .micor-top-btn', () => {
  const { plugin, header, body } = loadPlugin();
  plugin.attachTopButtons();
  plugin.onunload();
  assert.equal(body.querySelectorAll('.micor-top-settings').length, 0, 'the gear survived unload');
  assert.equal(header.children.length, 0, 'the row is not actually empty after unload');
});
