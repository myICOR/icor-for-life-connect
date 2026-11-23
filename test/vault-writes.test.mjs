/* THE VAULT-WRITES GATE (0.18.1, the Obsidian directory pass).
 *
 * 1. Reflections are notes, so syncReflections creates them through the
 *    Vault API (getFolderByPath, createFolder, cachedRead, create), never
 *    through the disk adapter, and still skips a reflection already there.
 * 2. wireClaude leaves a .mcp.json that is not valid JSON exactly as it is
 *    (rewriting it lost the member's other servers) and keeps the other
 *    servers of a valid one.
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

class TFile { constructor(path, text) { this.path = path; this.name = path.split('/').pop(); this.extension = this.name.split('.').pop(); this.text = text; } }
class TFolder { constructor(path) { this.path = path; this.children = []; } }

function load(notices) {
  const obsidian = {
    Plugin: class { constructor(app, manifest) { this.app = app; this.manifest = manifest; } },
    ItemView: class {}, PluginSettingTab: class {}, Setting: class {},
    Notice: class { constructor(msg) { notices.push(String(msg)); } },
    requestUrl: async () => { throw new Error('no network in this gate'); },
    setIcon: () => {}, Platform: { isDesktopApp: true, isMobileApp: false }, TFile,
  };
  const sandbox = {
    require: (name) => (name === 'obsidian' ? obsidian : nodeRequire(name)),
    module: { exports: {} },
    document: { querySelector: () => null, querySelectorAll: () => [] },
    window: { setTimeout, clearTimeout },
    MutationObserver: class { observe() {} disconnect() {} },
    console, setTimeout, clearTimeout, URL,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'main.js' });
  return sandbox.module.exports;
}

function fakeVault() {
  const files = new Map();
  const folders = new Map();
  const adapterCalls = [];
  const vault = {
    files, folders,
    getFolderByPath: (p) => folders.get(p) || null,
    getAbstractFileByPath: (p) => files.get(p) || folders.get(p) || null,
    createFolder: async (p) => { if (folders.has(p)) throw new Error('Folder already exists.'); const f = new TFolder(p); folders.set(p, f); return f; },
    create: async (p, text) => {
      if (files.has(p)) throw new Error('File already exists.');
      const f = new TFile(p, text); files.set(p, f);
      folders.get(p.slice(0, p.lastIndexOf('/'))).children.push(f);
      return f;
    },
    cachedRead: async (f) => f.text,
    adapter: new Proxy({}, { get: (_, k) => async (...a) => { adapterCalls.push([k, ...a]); return null; } }),
  };
  return { vault, adapterCalls };
}

const ID_OLD = '11111111-1111-4111-8111-111111111111';
const ID_NEW = '22222222-2222-4222-8222-222222222222';

test('reflections are created through the Vault API, and one already in the vault is not fetched again', async () => {
  const notices = [];
  const M = load(notices);
  const { vault, adapterCalls } = fakeVault();
  const dir = '02 Inner World/ICOR Journey Notes';
  /* A reflection synced before, already a note in the folder. */
  await vault.createFolder(dir);
  await vault.create(dir + '/2026-11-01_old.md', `---\nmyicor_id: ${ID_OLD}\n---\nmine now`);

  const plugin = Object.create(M.prototype);
  plugin.app = { vault };
  plugin.data = {};
  plugin.reflectionsDir = () => dir;
  plugin.saveSettings = async () => {};
  const asked = [];
  plugin.mcpCall = async (tool, args) => {
    asked.push([tool, args && args.note_id]);
    if (tool === 'get_my_notes') return { reflections: [{ id: ID_OLD }, { id: ID_NEW }], pagination: { hasMore: false } };
    return { reflection: { id: args.note_id, question_text: 'What did you learn?', answer: 'Plenty.', answered_at: '2026-11-20T10:00:00Z' } };
  };

  const res = await plugin.syncReflections();
  assert.equal(res.lastCreated, 1);
  assert.deepEqual(asked.filter(([t]) => t === 'get_note_details').map(([, id]) => id), [ID_NEW], 'only the new one is fetched');
  const made = [...vault.files.keys()].filter((p) => p.startsWith(dir + '/2026-11-20_'));
  assert.equal(made.length, 1, `a new note, got ${[...vault.files.keys()].join(', ')}`);
  assert.match(vault.files.get(made[0]).text, new RegExp(`myicor_id: ${ID_NEW}`));
  assert.deepEqual(adapterCalls, [], 'no disk-adapter call for notes');
});

test('the folder is created through the Vault API when it is missing', async () => {
  const M = load([]);
  const { vault, adapterCalls } = fakeVault();
  vault.folders.set('02 Inner World', new TFolder('02 Inner World'));
  const plugin = Object.create(M.prototype);
  plugin.app = { vault };
  plugin.data = {};
  plugin.reflectionsDir = () => '02 Inner World/ICOR Journey Notes';
  plugin.saveSettings = async () => {};
  plugin.mcpCall = async () => ({ reflections: [], pagination: { hasMore: false } });
  await plugin.syncReflections();
  assert.ok(vault.folders.has('02 Inner World/ICOR Journey Notes'));
  assert.deepEqual(adapterCalls, []);
});

function mcpAdapter(initial) {
  const disk = new Map(initial === undefined ? [] : [['.mcp.json', initial]]);
  return {
    disk,
    exists: async (p) => disk.has(p),
    read: async (p) => disk.get(p),
    write: async (p, t) => { disk.set(p, t); },
  };
}

test('a .mcp.json that is not valid JSON is left exactly as it is, with a notice', async () => {
  const notices = [];
  const M = load(notices);
  const broken = '{ "mcpServers": { "mine": { "url": "https://example.test" }, }\n';
  const adapter = mcpAdapter(broken);
  const plugin = Object.create(M.prototype);
  plugin.app = { vault: { adapter } };
  assert.equal(await plugin.wireClaude(), false);
  assert.equal(adapter.disk.get('.mcp.json'), broken);
  assert.equal(notices.length, 1);
  assert.match(notices[0], /not valid JSON/);
});

test('a valid .mcp.json keeps the member\'s other servers when myICOR is added', async () => {
  const M = load([]);
  const adapter = mcpAdapter(JSON.stringify({ mcpServers: { mine: { url: 'https://example.test' } } }));
  const plugin = Object.create(M.prototype);
  plugin.app = { vault: { adapter } };
  assert.equal(await plugin.wireClaude(), true);
  const cfg = JSON.parse(adapter.disk.get('.mcp.json'));
  assert.deepEqual(Object.keys(cfg.mcpServers).sort(), ['mine', 'myicor']);
});
