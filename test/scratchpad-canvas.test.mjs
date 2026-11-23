/* THE DAILY NOTES CANVAS PATH GATE.
 *
 * "New canvas in Daily Notes" (command `new-scratchpad-canvas`, an id kept
 * for saved hotkeys, and the explorer toolbar button that drives it) creates
 * the canvas the member sketches on. ICOR for Life nests that folder by date,
 * `00 Daily Notes/YYYY/MM/`, and its validator rejects anything at the
 * folder root, so the canvas has to land inside the month folder and the
 * command has to create that folder when today is the first time it is
 * needed (issue #1). A 2.x vault still has `00 Daily Scratchpad`, and its
 * canvases keep landing there until it moves to 3.0 (0.18.0).
 *
 * This gate loads the real main.js against a small in-memory vault, runs the
 * registered command's own callback, and reads back what it created. It
 * pins the clock, so the expected path is a literal and not a second copy of
 * the date arithmetic under test.
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

const COMMAND = 'new-scratchpad-canvas';
const DAILY = '00 Daily Notes';
const OLD_DAILY = '00 Daily Scratchpad';

/* -------------------------------------------------------------- set-up -- */

/* A clock stuck on one local date. The command reads local date parts, so
   the fixture is built the same way and never crosses a UTC midnight. */
const FIXED = [2026, 2, 5, 14, 30, 0]; /* 5 March 2026, local time */

function loadPlugin({ existing = [] } = {}) {
  const notices = [];
  const commands = new Map();
  const files = new Set(existing);
  const created = [];
  const folders = [];
  const opened = [];

  const obsidian = {
    Plugin: class {
      constructor(app, manifest) { this.app = app; this.manifest = manifest; }
      addCommand(cmd) { commands.set(cmd.id, cmd); }
      addSettingTab() {}
      registerView() {}
      registerEvent() {}
      async loadData() { return null; }
      async saveData() {}
    },
    ItemView: class { constructor(leaf) { this.leaf = leaf; } },
    Notice: class { constructor(msg) { notices.push(String(msg)); } },
    requestUrl: async () => { throw new Error('no network in this gate'); },
    setIcon: () => {},
    Platform: { isDesktopApp: true, isMobileApp: false },
    PluginSettingTab: class { constructor(app, plugin) { this.app = app; this.plugin = plugin; } },
    Setting: class {},
  };

  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : FIXED)); }
  }

  const sandbox = {
    require: (name) => (name === 'obsidian' ? obsidian : nodeRequire(name)),
    module: { exports: {} },
    document: { querySelector: () => null, querySelectorAll: () => [] },
    window: { setTimeout, clearTimeout },
    MutationObserver: class { observe() {} disconnect() {} },
    performance: { now: () => 0 },
    console, setTimeout, clearTimeout, URL,
    Date: FixedDate,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'main.js' });

  const PluginClass = sandbox.module.exports;
  const vault = {
    getAbstractFileByPath: (p) => (files.has(p) ? { path: p } : null),
    /* The top-level folders, for the plugin's folder lookup by full name. */
    getRoot: () => ({ children: [...files].filter((p) => !p.includes('/') && !p.includes('.')).map((name) => ({ name, children: [] })) }),
    async createFolder(p) {
      if (files.has(p)) throw new Error('Folder already exists.');
      folders.push(p);
      files.add(p);
      return { path: p };
    },
    async create(p, data) {
      if (files.has(p)) throw new Error('File already exists.');
      created.push({ path: p, data });
      files.add(p);
      return { path: p };
    },
  };
  const app = {
    commands: { executeCommandById: () => true },
    workspace: {
      onLayoutReady() {},
      on() { return {}; },
      getLeaf: () => ({ async openFile(f) { opened.push(f.path); } }),
    },
    vault,
    setting: { open() {} },
  };
  const plugin = new PluginClass(app, { id: 'icor-for-life-connect', version: '0.0.0-gate' });
  /* Secrets have their own gate; this one is about a path. */
  plugin.initSecrets = async () => {};
  return { plugin, commands, notices, created, folders, opened, files };
}

async function runCanvasCommand(opts) {
  const h = loadPlugin(opts);
  await h.plugin.onload();
  const cmd = h.commands.get(COMMAND);
  assert.ok(cmd, `${COMMAND} is not registered: ${JSON.stringify([...h.commands.keys()])}`);
  await cmd.callback();
  return h;
}

/* --------------------------------------------------------------- gates -- */

test('the canvas lands in the YYYY/MM folder of 00 Daily Notes, named YYYY-MM-DD_canvas', async () => {
  const { created, opened, notices } = await runCanvasCommand();
  assert.deepEqual(notices, [], 'no notice on the happy path');
  assert.equal(created.length, 1, 'exactly one file is created');
  assert.equal(created[0].path, `${DAILY}/2026/03/2026-03-05_canvas.canvas`);
  assert.equal(created[0].data, '{"nodes":[],"edges":[]}');
  assert.deepEqual(opened, [created[0].path], 'the new canvas is opened');
});

test('the year and month folders are created, in order, when they do not exist yet', async () => {
  const { folders, created } = await runCanvasCommand();
  assert.deepEqual(folders, [`${DAILY}/2026`, `${DAILY}/2026/03`]);
  assert.equal(created[0].path, `${DAILY}/2026/03/2026-03-05_canvas.canvas`);
});

test('an existing month folder is reused, never re-created', async () => {
  const { folders, created, notices } = await runCanvasCommand({
    existing: [DAILY, `${DAILY}/2026`, `${DAILY}/2026/03`],
  });
  assert.deepEqual(folders, [], 'createFolder throws on an existing folder; the command must not call it');
  assert.deepEqual(notices, []);
  assert.equal(created[0].path, `${DAILY}/2026/03/2026-03-05_canvas.canvas`);
});

test('a second canvas on the same day takes the -N suffix inside the same folder', async () => {
  const { created } = await runCanvasCommand({
    existing: [
      DAILY, `${DAILY}/2026`, `${DAILY}/2026/03`,
      `${DAILY}/2026/03/2026-03-05_canvas.canvas`,
      `${DAILY}/2026/03/2026-03-05_canvas-1.canvas`,
    ],
  });
  assert.equal(created[0].path, `${DAILY}/2026/03/2026-03-05_canvas-2.canvas`);
});

test('nothing is written to the folder root', async () => {
  const { created, folders } = await runCanvasCommand();
  const parent = (p) => p.slice(0, p.lastIndexOf('/'));
  for (const c of created) {
    assert.equal(parent(c.path), DAILY + '/2026/03', c.path + ' is not inside the month folder');
  }
  for (const dir of folders) {
    assert.ok(dir.startsWith(DAILY + '/'), dir + ' is outside the folder');
    assert.notEqual(dir, DAILY, 'the folder itself is not for this command to create');
  }
});

test('a 2.x vault keeps its canvases in 00 Daily Scratchpad; with both folders, 00 Daily Notes wins', async () => {
  const old = await runCanvasCommand({ existing: [OLD_DAILY] });
  assert.equal(old.created[0].path, `${OLD_DAILY}/2026/03/2026-03-05_canvas.canvas`);
  assert.deepEqual(old.folders, [`${OLD_DAILY}/2026`, `${OLD_DAILY}/2026/03`]);
  const both = await runCanvasCommand({ existing: [OLD_DAILY, DAILY] });
  assert.equal(both.created[0].path, `${DAILY}/2026/03/2026-03-05_canvas.canvas`);
});

test('the command is named for the 3.0 folder and keeps its id for saved hotkeys', async () => {
  const h = loadPlugin();
  await h.plugin.onload();
  assert.equal(h.commands.get(COMMAND).name, 'New canvas in Daily Notes');
  assert.deepEqual(source.match(/.*Daily Scratchpad'.*/g).map((l) => /legacy: \['00 Daily Scratchpad'\]/.test(l)), [true],
    'the 2.x name appears once, as the folder table\'s older name, never in a path or a label');
});
