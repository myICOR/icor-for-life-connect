/* THE TOOLBAR CREATION-BUTTON GATE.
 *
 * The file explorer's tool-button row carries four plugin-injected buttons:
 * today's daily note, the unique-note creator, a new scratchpad canvas, and
 * the graph view. They are a second route into the plugin's own commands,
 * present by explicit request, and the host recreates that row on its own
 * schedule - so "the code inserts them once" proves nothing about the build
 * the user runs. This gate loads the real main.js against a small DOM and
 * measures three behaviours:
 *
 *   1. the buttons exist after the attach pass, at the START of the row;
 *   2. they come BACK after the host rebuilds the row (the re-render path
 *      the explorer observer covers), without ever duplicating;
 *   3. unload removes them, and removes the retired classes an in-place
 *      upgrade can leave behind.
 *
 * Behaviour, not source text: a grep for the class name would stay green on
 * a button that is created and never inserted, or inserted and never
 * re-inserted. Both shapes have shipped in this codebase's family.
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

function loadPlugin() {
  const notices = [];
  const commandsRun = [];
  const icons = new Map();

  const body = new FakeEl('body');
  const explorer = body.createDiv({ cls: 'workspace-leaf-content', attr: { 'data-type': 'file-explorer' } });

  /* The host's own row, with the stock survivors in it. */
  const buildRow = () => {
    const old = explorer.querySelector('.nav-buttons-container');
    if (old) old.remove();
    const bar = explorer.createDiv({ cls: 'nav-buttons-container' });
    bar.createDiv({ cls: 'clickable-icon nav-action-button', attr: { 'aria-label': 'Change sort order' } });
    bar.createDiv({ cls: 'clickable-icon nav-action-button', attr: { 'aria-label': 'Collapse all' } });
    return bar;
  };
  buildRow();

  const doc = {
    body,
    querySelector: (sel) => body.querySelector(sel),
    querySelectorAll: (sel) => body.querySelectorAll(sel),
  };

  const obsidian = {
    Plugin: class { constructor(app, manifest) { this.app = app; this.manifest = manifest; } },
    ItemView: class { constructor(leaf) { this.leaf = leaf; } },
    Notice: class { constructor(msg) { notices.push(String(msg)); } },
    requestUrl: async () => { throw new Error('no network in this gate'); },
    setIcon: (el, icon) => { icons.set(el, icon); el.attrs['data-icon'] = icon; },
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
    commands: { executeCommandById: (id) => { commandsRun.push(id); return true; } },
    workspace: {},
    vault: {},
    setting: { open() {} },
  };
  const plugin = new PluginClass(app, { id: 'icor-for-life-connect', version: '0.0.0-gate' });
  plugin.data = {};
  return { plugin, body, explorer, buildRow, notices, commandsRun, icons, doc };
}

const rowLabels = (bar) => bar.children.map(
  (el) => el.getAttribute('aria-label') || [...el.classSet].join('.'));

/* --------------------------------------------------------------- gates -- */

/* The four buttons in row order, each with the command it drives. */
const BUTTONS = [
  ['micor-daily-note', 'icor-for-life-connect:open-daily-note'],
  ['micor-unique-note', 'icor-for-life-connect:new-unique-note'],
  ['micor-new-canvas', 'icor-for-life-connect:new-scratchpad-canvas'],
  ['micor-graph-view', 'icor-for-life-connect:open-graph-view'],
];

test('the four buttons exist at the start of the row, in order, after the attach pass', () => {
  const { plugin, explorer } = loadPlugin();
  plugin.attachRoomButtons();
  const bar = explorer.querySelector('.nav-buttons-container');
  BUTTONS.forEach(([cls], i) => {
    const btn = bar.querySelector('.' + cls);
    assert.ok(btn, cls + ' is not in the row: ' + JSON.stringify(rowLabels(bar)));
    assert.equal(bar.children.indexOf(btn), i, cls + ' is not control ' + (i + 1) + ' in the row: ' + JSON.stringify(rowLabels(bar)));
    assert.ok(btn.getAttribute('aria-label'), cls + ' has no accessible name');
  });
});

test('the buttons come back after the host rebuilds the row, and never duplicate', () => {
  const { plugin, explorer, buildRow } = loadPlugin();
  plugin.attachRoomButtons();

  /* The host recreates the row's contents on its own schedule; simulate the
     rebuild, then run the same pass the explorer observer runs. */
  buildRow();
  const bar = explorer.querySelector('.nav-buttons-container');
  assert.equal(bar.querySelectorAll('.micor-daily-note').length, 0, 'the simulated rebuild did not actually clear the row');
  plugin.attachRoomButtons();
  plugin.attachRoomButtons(); /* the observer fires more than once */

  for (const [cls] of BUTTONS) {
    assert.equal(bar.querySelectorAll('.' + cls).length, 1, cls + ' after rebuild: expected exactly one');
  }
  assert.equal(bar.children.indexOf(bar.querySelector('.micor-daily-note')), 0, 'daily note lost its place at the start of the row');
});

test('each button drives the plugin command that is its other route', () => {
  const { plugin, explorer, commandsRun } = loadPlugin();
  plugin.attachRoomButtons();
  const bar = explorer.querySelector('.nav-buttons-container');
  for (const [cls] of BUTTONS) bar.querySelector('.' + cls).click();
  assert.deepEqual(commandsRun, BUTTONS.map(([, id]) => id),
    'the buttons must run the registered commands, not a second implementation');
});

test('unload removes the four buttons and the retired classes alike', () => {
  const { plugin, explorer, body } = loadPlugin();
  plugin.attachRoomButtons();
  /* An in-place upgrade can leave a node from a build that no longer exists;
     plant one so the sweep has something old to prove itself on. */
  explorer.querySelector('.nav-buttons-container')
    .createDiv({ cls: 'clickable-icon nav-action-button micor-toolbar-extra' });

  plugin.onunload();

  for (const cls of [...BUTTONS.map(([c]) => c), 'micor-toolbar-extra']) {
    assert.equal(body.querySelectorAll('.' + cls).length, 0, cls + ' survived unload');
  }
});
