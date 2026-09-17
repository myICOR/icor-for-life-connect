/* THE SECRETS GATE (0.15.0): where the keys live.
 *
 * Connect used to keep its two OAuth tokens in plain text in data.json. Now
 * they live in ONE of two backends, chosen by the `secretsBackend` setting:
 * Obsidian's keychain (`app.secretStorage`, 1.11.4+) or an env file in the
 * vault. This gate proves the suite-wide contract for this plugin:
 *
 *   1. PURE: `parseEnvFile` reads KEY=value lines, `#` comments, no quotes,
 *      first occurrence wins; `upsertEnvLine` rewrites exactly one line or
 *      appends one and leaves every other byte alone, twice gives the same
 *      text, and never touches a comment.
 *   2. MIGRATION: an older data.json (the fixture in test/fixtures) has its
 *      tokens moved into the selected backend on load, the fields blanked,
 *      the rest of the file kept, and a second load moves nothing. Into the
 *      keychain when it exists, into the env file when it does not.
 *   3. NO FALLBACK: only the selected backend is read; a key that sits in the
 *      other one counts as not set.
 *   4. NO LEAK: no saveData payload, Notice or console line ever carries a
 *      token, and the source has no Notice or console call naming one.
 *   5. THE TAB: dropdown disabled without the API, password inputs with
 *      autocomplete off, the field cleared after Save, a "Move to ..."
 *      button exactly when the key sits in the other backend.
 *
 * Behaviour through the real plugin class, not a grep, except for the one
 * source gate in 4 that a behaviour test cannot see (every code path).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';

import { FakeEl } from './fake-dom.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(resolve(repo, 'main.js'), 'utf8');
const nodeRequire = createRequire(import.meta.url);
const fixture = JSON.parse(readFileSync(resolve(repo, 'test/fixtures/data-plaintext.json'), 'utf8'));
const FIX_ACCESS = fixture.tokens.access_token;
const FIX_REFRESH = fixture.tokens.refresh_token;
const clone = (v) => JSON.parse(JSON.stringify(v));

/* ------------------------------------------------------------- harness -- */

/* The Setting API surface the tab uses, recorded so a gate can read what
   was rendered and drive the components. */
class FakeSetting {
  constructor(el) {
    this.name = ''; this.desc = ''; this.heading = false;
    this.dropdowns = []; this.texts = []; this.buttons = [];
    el.settings.push(this);
  }
  setName(n) { this.name = n; return this; }
  setDesc(d) { this.desc = d; return this; }
  setHeading() { this.heading = true; return this; }
  setClass() { return this; }
  addDropdown(cb) {
    const d = {
      options: {}, value: null, disabled: false, change: null,
      addOption(k, v) { this.options[k] = v; return this; },
      setValue(v) { this.value = v; return this; },
      setDisabled(b) { this.disabled = b; return this; },
      onChange(fn) { this.change = fn; return this; },
    };
    this.dropdowns.push(d); cb(d); return this;
  }
  addText(cb) {
    const inputEl = new FakeEl('input');
    const t = {
      inputEl, value: '', placeholder: '', change: null,
      setPlaceholder(p) { this.placeholder = p; return this; },
      setValue(v) { this.value = v; inputEl.value = v; return this; },
      onChange(fn) { this.change = fn; return this; },
    };
    this.texts.push(t); cb(t); return this;
  }
  addButton(cb) {
    const b = {
      text: '', click: null,
      setButtonText(t) { this.text = t; return this; },
      setCta() { return this; },
      onClick(fn) { this.click = fn; return this; },
    };
    this.buttons.push(b); cb(b); return this;
  }
}

function fakeSecretStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map, sets: [],
    getSecret(id) { return map.has(id) ? map.get(id) : null; },
    setSecret(id, v) {
      if (!/^[a-z0-9-]+$/.test(id) || id.length > 64) throw new Error('invalid secret id');
      this.sets.push(id); map.set(id, String(v));
    },
    listSecrets() { return [...map.keys()]; },
  };
}

function fakeAdapter(files = {}) {
  const map = new Map(Object.entries(files));
  return {
    map, writes: [],
    async exists(p) { return map.has(p); },
    async read(p) { return map.get(p); },
    async write(p, t) { this.writes.push(p); map.set(p, t); },
  };
}

function loadModule({ notices, logs }) {
  const obsidian = {
    Plugin: class {
      constructor(app, manifest) { this.app = app; this.manifest = manifest; }
      addSettingTab() {}
      async loadData() { return null; }
      async saveData() {}
    },
    ItemView: class { constructor(leaf) { this.leaf = leaf; } },
    Notice: class { constructor(msg) { notices.push(String(msg)); } },
    requestUrl: async () => { throw new Error('no network in this gate'); },
    setIcon: () => {},
    Platform: { isDesktopApp: true, isMobileApp: false },
    PluginSettingTab: class { constructor(app, plugin) { this.app = app; this.plugin = plugin; } },
    Setting: FakeSetting,
  };
  const spyConsole = {};
  for (const k of ['log', 'warn', 'error', 'info', 'debug']) spyConsole[k] = (...a) => logs.push(a.map(String).join(' '));
  const sandbox = {
    require: (name) => (name === 'obsidian' ? obsidian : nodeRequire(name)),
    module: { exports: {} },
    document: { querySelector: () => null, querySelectorAll: () => [] },
    window: { setTimeout, clearTimeout },
    MutationObserver: class { observe() {} disconnect() {} },
    console: spyConsole, setTimeout, clearTimeout, URL, performance,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'main.js' });
  return sandbox.module.exports;
}

/* A plugin the way onload leaves it before initSecrets: data adopted,
   saveData recorded, no DOM. */
function makePlugin({ data, secretStorage, files } = {}) {
  const notices = [];
  const logs = [];
  const saves = [];
  const M = loadModule({ notices, logs });
  const adapter = fakeAdapter(files);
  const app = { workspace: {}, vault: { adapter, configDir: '.obsidian' }, setting: { open() {} } };
  if (secretStorage) app.secretStorage = secretStorage;
  const plugin = new M(app, { id: 'icor-for-life-connect', version: '0.0.0-gate' });
  plugin.data = Object.assign(
    { clientId: null, tokens: null, secretsBackend: null, envFilePath: M.DEFAULT_ENV_FILE_PATH },
    clone(data || {})
  );
  plugin.tokens = null;
  plugin.saveData = async (d) => { saves.push(clone(d)); };
  return { M, plugin, adapter, app, notices, logs, saves };
}

function assertNoLeak({ saves, notices, logs, adapter }, extra = [], { skipSaves = false } = {}) {
  const needles = [FIX_ACCESS, FIX_REFRESH, ...extra];
  const hay = [
    ...(skipSaves ? [] : saves.map((s) => JSON.stringify(s))),
    ...notices,
    ...logs,
    adapter.map.get('.gitignore') || '',
  ];
  for (const h of hay) for (const n of needles) assert.ok(!h.includes(n), 'a token reached a saveData payload, a Notice, the console or .gitignore');
}

/* ------------------------------------------------------------ 1. PURE -- */

const ENV_SAMPLE = [
  '# keys for the team',
  'OPENAI_API_KEY=sk-not-real',
  '',
  'CLICKUP_TEAM_ID = 12345',
  'QUOTED="keep the quotes"',
  'HASHY=abc#notacomment',
  'DUP=first',
  'DUP=second',
  'export NOT_A_KEY=1',
  'noequals',
  '# MYICOR_ACCESS_TOKEN=commented-out',
].join('\n');

test('parseEnvFile: KEY=value lines, # comments, no quotes stripped, no interpolation, first occurrence wins', () => {
  const { M } = makePlugin();
  const env = M.parseEnvFile(ENV_SAMPLE);
  assert.equal(env.OPENAI_API_KEY, 'sk-not-real');
  assert.equal(env.CLICKUP_TEAM_ID, '12345', 'spaces around = are trimmed');
  assert.equal(env.QUOTED, '"keep the quotes"', 'quotes are part of the value');
  assert.equal(env.HASHY, 'abc#notacomment', 'a # inside a value is not a comment');
  assert.equal(env.DUP, 'first');
  assert.ok(!('export NOT_A_KEY' in env) && !('NOT_A_KEY' in env), 'a key outside the shell alphabet is ignored');
  assert.ok(!('noequals' in env));
  assert.ok(!('MYICOR_ACCESS_TOKEN' in env), 'a commented-out key is not a key');
  assert.equal(Object.keys(M.parseEnvFile('')).length, 0);
  assert.equal(Object.keys(M.parseEnvFile(null)).length, 0);
});

test('parseEnvFile: CRLF files read the same as LF files', () => {
  const { M } = makePlugin();
  const lf = M.parseEnvFile('A=1\nB=2\n');
  const crlf = M.parseEnvFile('A=1\r\nB=2\r\n');
  assert.deepEqual(crlf, lf);
  assert.equal(crlf.B, '2', 'no trailing \\r on the value');
});

test('upsertEnvLine: an existing key is rewritten in place and every other byte stays', () => {
  const { M } = makePlugin();
  const out = M.upsertEnvLine(ENV_SAMPLE, 'OPENAI_API_KEY', 'sk-new');
  const before = ENV_SAMPLE.split('\n');
  const after = out.split('\n');
  assert.equal(after.length, before.length, 'no line added or removed');
  for (let i = 0; i < before.length; i++) {
    if (i === 1) assert.equal(after[i], 'OPENAI_API_KEY=sk-new');
    else assert.equal(after[i], before[i], 'line ' + i + ' must be byte-identical');
  }
});

test('upsertEnvLine: a missing key is appended as one line, after a line ending when the file has none', () => {
  const { M } = makePlugin();
  const noTrailing = 'A=1\nB=2';
  assert.equal(M.upsertEnvLine(noTrailing, 'C', '3'), 'A=1\nB=2\nC=3\n');
  const trailing = 'A=1\nB=2\n';
  assert.equal(M.upsertEnvLine(trailing, 'C', '3'), 'A=1\nB=2\nC=3\n');
  assert.equal(M.upsertEnvLine('', 'C', '3'), 'C=3\n', 'an empty file gets just the line');
  assert.equal(M.upsertEnvLine('A=1\r\nB=2', 'C', '3'), 'A=1\r\nB=2\r\nC=3\r\n', 'a CRLF file gets CRLF');
  assert.equal(M.upsertEnvLine('A=1\r\nC=old\r\n', 'C', '3'), 'A=1\r\nC=3\r\n', 'a CRLF line keeps its \\r when rewritten');
});

test('upsertEnvLine: applying it twice gives the same text (idempotent), for update and append alike', () => {
  const { M } = makePlugin();
  for (const [text, key] of [[ENV_SAMPLE, 'OPENAI_API_KEY'], [ENV_SAMPLE, 'MYICOR_REFRESH_TOKEN'], ['A=1', 'A'], ['', 'Z']]) {
    const once = M.upsertEnvLine(text, key, 'v');
    const twice = M.upsertEnvLine(once, key, 'v');
    assert.equal(twice, once, 'second application must change nothing for ' + key);
  }
});

test('upsertEnvLine: comment lines are never touched, even when they spell the key; a duplicate key is written at its first line', () => {
  const { M } = makePlugin();
  const out = M.upsertEnvLine(ENV_SAMPLE, 'MYICOR_ACCESS_TOKEN', 'tok');
  assert.ok(out.includes('# MYICOR_ACCESS_TOKEN=commented-out'), 'the comment stays as it was');
  assert.ok(out.endsWith('# MYICOR_ACCESS_TOKEN=commented-out\nMYICOR_ACCESS_TOKEN=tok\n'), 'the real key is appended after it');
  const dup = M.upsertEnvLine(ENV_SAMPLE, 'DUP', 'changed');
  const lines = dup.split('\n');
  assert.equal(lines[6], 'DUP=changed', 'the first occurrence, which is the one the reader returns');
  assert.equal(lines[7], 'DUP=second', 'the second occurrence stays');
  assert.equal(M.parseEnvFile(dup).DUP, 'changed', 'reader and writer agree on which line is the key');
});

test('upsertEnvLine: blanking writes KEY= rather than deleting the line, and the reader then sees it as not set', () => {
  const { M } = makePlugin();
  const out = M.upsertEnvLine('A=1\nT=secret\nB=2\n', 'T', '');
  assert.equal(out, 'A=1\nT=\nB=2\n');
  assert.equal(M.parseEnvFile(out).T, '');
  assert.ok(!('secret' in M.parseEnvFile(out)));
});

test('secret ids: the plugin prefix, the API alphabet, at most 64 characters; env keys are shell names', () => {
  const { M } = makePlugin();
  const manifest = JSON.parse(readFileSync(resolve(repo, 'manifest.json'), 'utf8'));
  assert.equal(M.SECRET_ID_PREFIX, manifest.id + '-');
  assert.deepEqual(Object.keys(M.SECRET_FIELDS), ['access_token', 'refresh_token']);
  assert.equal(M.SECRET_FIELDS.access_token.id, 'icor-for-life-connect-access-token');
  assert.equal(M.SECRET_FIELDS.refresh_token.id, 'icor-for-life-connect-refresh-token');
  assert.equal(M.SECRET_FIELDS.access_token.env, 'MYICOR_ACCESS_TOKEN');
  assert.equal(M.SECRET_FIELDS.refresh_token.env, 'MYICOR_REFRESH_TOKEN');
  for (const f of Object.values(M.SECRET_FIELDS)) {
    assert.match(f.id, /^[a-z0-9-]+$/);
    assert.ok(f.id.length <= 64);
    assert.match(f.env, /^[A-Z_][A-Z0-9_]*$/);
  }
  assert.equal(M.DEFAULT_ENV_FILE_PATH, '06 AI Team/AI Team Knowledge/.env');
});

test('splitPlaintextTokens and persistableData: the two tokens leave, scope and expiry stay, nothing else moves', () => {
  const { M } = makePlugin();
  /* clone: the module's objects come from the vm realm, whose Object is
     not this realm's, and strict deep-equal compares prototypes too. */
  const split = clone(M.splitPlaintextTokens(fixture.tokens));
  assert.deepEqual(split.secrets, { access_token: FIX_ACCESS, refresh_token: FIX_REFRESH });
  assert.deepEqual(split.meta, { scope: fixture.tokens.scope, expires_at: fixture.tokens.expires_at });
  assert.equal(M.splitPlaintextTokens(null), null);
  assert.equal(M.splitPlaintextTokens({ scope: 'x', expires_at: 1 }), null, 'nothing to move once blanked');
  const p = clone(M.persistableData(fixture));
  assert.ok(!('access_token' in p.tokens) && !('refresh_token' in p.tokens));
  assert.equal(p.tokens.scope, fixture.tokens.scope);
  assert.equal(p.clientId, fixture.clientId);
  assert.deepEqual(p.reflectionSync, fixture.reflectionSync);
  assert.ok(!JSON.stringify(p).includes(FIX_ACCESS));
});

/* ------------------------------------------------------- 2. MIGRATION -- */

test('migration into the keychain: the fixture tokens move to the two ids, data.json is blanked and the rest kept, a second load moves nothing', async () => {
  const store = fakeSecretStorage();
  const h = makePlugin({ data: fixture, secretStorage: store, files: { '.gitignore': '# vault\n' } });
  const { M, plugin, saves, adapter } = h;

  await plugin.initSecrets();

  assert.equal(plugin.data.secretsBackend, 'secret-storage', 'the default is pinned into data.json where the API exists');
  assert.equal(store.map.get(M.SECRET_FIELDS.access_token.id), FIX_ACCESS);
  assert.equal(store.map.get(M.SECRET_FIELDS.refresh_token.id), FIX_REFRESH);
  assert.ok(saves.length >= 1, 'data.json was written back');
  const last = saves[saves.length - 1];
  assert.deepEqual(last.tokens, { scope: fixture.tokens.scope, expires_at: fixture.tokens.expires_at }, 'the secret fields are gone, the meta stays');
  assert.equal(last.clientId, fixture.clientId);
  assert.deepEqual(last.reflectionSync, fixture.reflectionSync, 'the rest of data.json is untouched');
  assert.equal(last.secretsBackend, 'secret-storage');
  assert.equal(last.envFilePath, M.DEFAULT_ENV_FILE_PATH);
  assert.ok(plugin.isConnected(), 'the connection survives the move');
  assert.equal(plugin.tokens.access_token, FIX_ACCESS);
  assert.equal(plugin.tokens.refresh_token, FIX_REFRESH);
  assert.equal(plugin.tokens.expires_at, fixture.tokens.expires_at);
  assert.ok(adapter.map.get('.gitignore').includes('.obsidian/plugins/icor-for-life-connect/data.json'), 'data.json stays git-ignored');
  assert.ok(!adapter.map.get('.gitignore').includes(M.DEFAULT_ENV_FILE_PATH), 'the env file is not the backend in use, so it is not added');
  assertNoLeak(h);

  /* Second load: the same data.json as it is now on disk. */
  const sets = store.sets.length;
  const savesBefore = saves.length;
  plugin.data = clone(last);
  await plugin.initSecrets();
  assert.equal(store.sets.length, sets, 'nothing written to the keychain on the second load');
  assert.equal(saves.length, savesBefore, 'data.json not rewritten on the second load');
  assert.ok(plugin.isConnected());
});

test('migration into the env file: without the API the tokens move into the env file, the other lines stay byte-identical, and the path is git-ignored', async () => {
  const envBefore = ENV_SAMPLE; /* no trailing newline, like the real file */
  const h = makePlugin({ data: fixture, files: { [ 'x' ]: '' } });
  const { M, plugin, saves, adapter } = h;
  adapter.map.set(M.DEFAULT_ENV_FILE_PATH, envBefore);
  adapter.map.delete('x');

  await plugin.initSecrets();

  assert.equal(plugin.data.secretsBackend, 'env-file', 'the only choice without the API');
  const envAfter = adapter.map.get(M.DEFAULT_ENV_FILE_PATH);
  assert.ok(envAfter.startsWith(envBefore + '\n'), 'every byte of the old file is still there, in order');
  const env = M.parseEnvFile(envAfter);
  assert.equal(env.MYICOR_ACCESS_TOKEN, FIX_ACCESS);
  assert.equal(env.MYICOR_REFRESH_TOKEN, FIX_REFRESH);
  assert.equal(env.OPENAI_API_KEY, 'sk-not-real');
  const last = saves[saves.length - 1];
  assert.ok(!('access_token' in last.tokens) && !('refresh_token' in last.tokens), 'data.json blanked');
  assert.ok(plugin.isConnected());
  const gi = adapter.map.get('.gitignore');
  assert.ok(gi.includes('.obsidian/plugins/icor-for-life-connect/data.json'));
  assert.ok(gi.split('\n').includes(M.DEFAULT_ENV_FILE_PATH), 'the env file path is an exact line in .gitignore');
  assertNoLeak(h);

  const writes = adapter.writes.length;
  plugin.data = clone(last);
  await plugin.initSecrets();
  assert.equal(adapter.writes.length, writes, 'a second load writes nothing');
});

test('migration into the env file creates the file when it does not exist, and blanking keys never creates one', async () => {
  const h = makePlugin({ data: fixture });
  const { M, plugin, adapter } = h;
  await plugin.initSecrets();
  assert.equal(adapter.map.get(M.DEFAULT_ENV_FILE_PATH), 'MYICOR_ACCESS_TOKEN=' + FIX_ACCESS + '\nMYICOR_REFRESH_TOKEN=' + FIX_REFRESH + '\n');
  const h2 = makePlugin({});
  await h2.plugin.initSecrets();
  await h2.plugin.disconnect();
  assert.ok(!h2.adapter.map.has(h2.M.DEFAULT_ENV_FILE_PATH), 'no env file appears from blanking nothing');
});

test('a backend that refuses leaves the tokens in data.json, says so without a value, and never blanks first', async () => {
  const store = fakeSecretStorage();
  const acceptingSetSecret = store.setSecret;
  store.setSecret = () => { throw new Error('keychain locked'); };
  const h = makePlugin({ data: fixture, secretStorage: store });
  const { plugin, saves, notices } = h;
  await plugin.initSecrets();
  const last = saves[saves.length - 1];
  assert.ok(last, 'the pinned backend was still written');
  assert.equal(last.tokens.access_token, FIX_ACCESS, 'the plaintext stays on disk for the next load to try again: the strip must not lose a connection the backend refused');
  assert.equal(last.tokens.refresh_token, FIX_REFRESH);
  assert.equal(plugin.secretsUnmoved, true);
  assert.ok(!plugin.isConnected(), 'the backend in use holds nothing, so no fallback to the plaintext either');
  assert.equal(notices.length, 1);
  assert.match(notices[0], /could not move the keys into Obsidian's keychain/);
  assertNoLeak(h, [], { skipSaves: true });

  /* Once the backend accepts, the same load path finishes the move. */
  store.setSecret = acceptingSetSecret;
  plugin.data = clone(last);
  await plugin.initSecrets();
  assert.equal(plugin.secretsUnmoved, false);
  assert.equal(store.map.get(h.M.SECRET_FIELDS.refresh_token.id), FIX_REFRESH);
  assert.ok(!('access_token' in saves[saves.length - 1].tokens));
  assert.ok(plugin.isConnected());
});

/* ------------------------------------------------------ 3. NO FALLBACK -- */

test('only the selected backend is read: a key in the other backend counts as not set', async () => {
  const { M, plugin: p1, adapter: a1 } = makePlugin({ data: { secretsBackend: 'secret-storage' }, secretStorage: fakeSecretStorage() });
  a1.map.set(M.DEFAULT_ENV_FILE_PATH, 'MYICOR_ACCESS_TOKEN=' + FIX_ACCESS + '\nMYICOR_REFRESH_TOKEN=' + FIX_REFRESH + '\n');
  await p1.initSecrets();
  assert.ok(!p1.isConnected(), 'keychain selected, keys in the env file: not connected');

  const store = fakeSecretStorage({ [M.SECRET_FIELDS.access_token.id]: FIX_ACCESS, [M.SECRET_FIELDS.refresh_token.id]: FIX_REFRESH });
  const { plugin: p2 } = makePlugin({ data: { secretsBackend: 'env-file' }, secretStorage: store });
  await p2.initSecrets();
  assert.ok(!p2.isConnected(), 'env file selected, keys in the keychain: not connected');
  assert.equal(p2.data.secretsBackend, 'env-file', 'the choice is respected, not overwritten by the default');
});

test('secret-storage chosen on an Obsidian without the API resolves to the env file, and the choice is kept for when the API returns', async () => {
  const { M, plugin, adapter } = makePlugin({ data: { secretsBackend: 'secret-storage' } });
  adapter.map.set(M.DEFAULT_ENV_FILE_PATH, 'MYICOR_ACCESS_TOKEN=' + FIX_ACCESS + '\nMYICOR_REFRESH_TOKEN=' + FIX_REFRESH + '\n');
  await plugin.initSecrets();
  assert.equal(plugin.secretsBackend(), 'env-file');
  assert.equal(plugin.data.secretsBackend, 'secret-storage');
  assert.ok(plugin.isConnected());
});

/* ---------------------------------------------------------- 4. NO LEAK -- */

test('after connect, refresh and disconnect, no saveData payload carries a token; disconnect blanks the backend', async () => {
  const store = fakeSecretStorage();
  const h = makePlugin({ secretStorage: store });
  const { M, plugin, saves } = h;
  await plugin.initSecrets();

  plugin.storeTokens({ access_token: FIX_ACCESS, refresh_token: FIX_REFRESH, expires_in: 900 });
  await plugin.saveTokens();
  assert.ok(plugin.isConnected());
  assert.equal(store.map.get(M.SECRET_FIELDS.refresh_token.id), FIX_REFRESH);
  assert.deepEqual(Object.keys(saves[saves.length - 1].tokens).sort(), ['expires_at', 'scope']);

  await plugin.disconnect();
  assert.ok(!plugin.isConnected());
  assert.equal(store.map.get(M.SECRET_FIELDS.access_token.id), '');
  assert.equal(store.map.get(M.SECRET_FIELDS.refresh_token.id), '');
  assert.equal(saves[saves.length - 1].tokens, null);
  assertNoLeak(h);
});

test('source: saveData is called through persistableData only, and no Notice or console line names a token', () => {
  const calls = source.split('\n').filter((l) => l.includes('this.saveData(')).map((l) => l.trim().replace(/;$/, ''));
  assert.deepEqual(calls, ['await this.saveData(this.secretsUnmoved ? this.data : persistableData(this.data))']);
  const code = source.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l));
  for (const l of code) {
    if (!/new Notice\(|console\.(log|warn|error|info|debug)\(/.test(l)) continue;
    assert.doesNotMatch(l, /access_token|refresh_token|\.tokens\b|getSecret|MYICOR_/, 'a Notice or console call must not reach for a token: ' + l.trim());
  }
  /* And the one place a Notice message is assembled from a caught error is
     the settings tab, where the sentences are fixed: */
  assert.doesNotMatch(source, /Notice\([^)]*e\.message[^)]*(keychain|env file)/);
});

/* ------------------------------------------------------------ 5. TAB -- */

async function renderTab(h) {
  const { M, plugin, app } = h;
  const tab = new M.MyicorConnectSettingTab(app, plugin);
  const el = new FakeEl('div');
  el.settings = [];
  el.empty = () => { el.settings.length = 0; el.children.length = 0; };
  tab.containerEl = el;
  await tab.render(el);
  return { tab, el, rows: el.settings };
}

test('the tab: heading in sentence case without the plugin name; the dropdown is disabled and on env-file without the API', async () => {
  const h = makePlugin({});
  await h.plugin.initSecrets();
  const { rows } = await renderTab(h);
  const heading = rows.find((r) => r.heading);
  assert.equal(heading.name, 'Where your keys live');
  assert.ok(!/Connect|settings/i.test(heading.name));
  const backend = rows.find((r) => r.name === 'Keys are stored in');
  assert.equal(backend.dropdowns.length, 1);
  assert.equal(backend.dropdowns[0].disabled, true);
  assert.equal(backend.dropdowns[0].value, 'env-file');
  assert.deepEqual(Object.keys(backend.dropdowns[0].options), ['secret-storage', 'env-file']);
  assert.match(backend.desc, /1\.11\.4/);
  assert.ok(rows.some((r) => r.name === 'Env file'));
});

test('the tab: with the API the dropdown is enabled, defaults to the keychain, and names the keychain by its settings path, never the OS', async () => {
  const h = makePlugin({ secretStorage: fakeSecretStorage() });
  await h.plugin.initSecrets();
  const { rows } = await renderTab(h);
  const backend = rows.find((r) => r.name === 'Keys are stored in');
  assert.equal(backend.dropdowns[0].disabled, false);
  assert.equal(backend.dropdowns[0].value, 'secret-storage');
  assert.match(backend.desc, /Obsidian's keychain \(Settings, General, Keychain\)/);
  assert.doesNotMatch(backend.desc + backend.dropdowns[0].options['secret-storage'], /OS keychain|Keychain Access|system keychain/i);
});

test('the tab: one row per key, a password input with autocomplete off and a label, status says not set, no Move button when nothing is elsewhere', async () => {
  const h = makePlugin({ secretStorage: fakeSecretStorage() });
  await h.plugin.initSecrets();
  const { rows } = await renderTab(h);
  for (const label of ['Access token', 'Refresh token']) {
    const row = rows.find((r) => r.name === label);
    assert.ok(row, label + ' row');
    assert.equal(row.texts.length, 1);
    const input = row.texts[0].inputEl;
    assert.equal(input.type, 'password');
    assert.equal(input.getAttribute('autocomplete'), 'off');
    assert.equal(input.getAttribute('aria-label'), label);
    assert.match(row.desc, /^Not set\./);
    assert.deepEqual(row.buttons.map((b) => b.text), ['Save']);
  }
  const refresh = rows.find((r) => r.name === 'Refresh token');
  assert.match(refresh.desc, /MYICOR_REFRESH_TOKEN/);
  assert.match(refresh.desc, /icor-for-life-connect-refresh-token/);
});

test('the tab: Save writes the pasted key to the backend in use, clears the field, connects, and the Notice carries no value', async () => {
  const store = fakeSecretStorage();
  const h = makePlugin({ secretStorage: store });
  const { M, plugin, notices } = h;
  await plugin.initSecrets();
  const { rows } = await renderTab(h);
  const row = rows.find((r) => r.name === 'Refresh token');
  const PASTED = 'PASTED-REFRESH-TOKEN-not-real';
  row.texts[0].change(PASTED);
  row.texts[0].setValue(PASTED);
  await row.buttons[0].click();
  assert.equal(store.map.get(M.SECRET_FIELDS.refresh_token.id), PASTED);
  assert.equal(row.texts[0].value, '', 'the field is cleared after Save');
  assert.ok(plugin.isConnected());
  assert.equal(plugin.tokens.expires_at, 0, 'the first call refreshes, which proves the pasted token');
  assert.equal(notices.length, 1);
  assert.match(notices[0], /refresh token saved to Obsidian's keychain/);
  assertNoLeak(h, [PASTED]);
});

test('the tab: a key that sits in the other backend gets a Move button that copies it over and blanks the source', async () => {
  const store = fakeSecretStorage();
  const h = makePlugin({ data: { secretsBackend: 'secret-storage' }, secretStorage: store });
  const { M, plugin, adapter, notices } = h;
  adapter.map.set(M.DEFAULT_ENV_FILE_PATH, '# team keys\nMYICOR_REFRESH_TOKEN=' + FIX_REFRESH + '\nOTHER=1\n');
  await plugin.initSecrets();
  assert.ok(!plugin.isConnected(), 'keychain selected, key in the env file');
  let { rows } = await renderTab(h);
  let row = rows.find((r) => r.name === 'Refresh token');
  assert.match(row.desc, /^Stored in the env file\. Not set in Obsidian's keychain, which is the backend in use\./);
  const move = row.buttons.find((b) => b.text === "Move to Obsidian's keychain");
  assert.ok(move, 'the Move button is offered');
  assert.ok(!rows.find((r) => r.name === 'Access token').buttons.some((b) => /^Move/.test(b.text)), 'no Move button for a key that is nowhere');

  await move.click();
  assert.equal(store.map.get(M.SECRET_FIELDS.refresh_token.id), FIX_REFRESH);
  assert.equal(adapter.map.get(M.DEFAULT_ENV_FILE_PATH), '# team keys\nMYICOR_REFRESH_TOKEN=\nOTHER=1\n', 'blanked in place, everything else identical');
  assert.ok(plugin.isConnected());
  assert.match(notices[notices.length - 1], /refresh token moved to Obsidian's keychain/);
  ({ rows } = await renderTab(h));
  row = rows.find((r) => r.name === 'Refresh token');
  assert.match(row.desc, /^Stored in Obsidian's keychain\./);
  assert.ok(!row.buttons.some((b) => /^Move/.test(b.text)), 'nothing left to move');
  assertNoLeak(h);
});

test('the tab: switching the dropdown moves nothing by itself and re-reads the new backend only', async () => {
  const store = fakeSecretStorage();
  const h = makePlugin({ secretStorage: store });
  const { M, plugin, saves } = h;
  await plugin.initSecrets();
  plugin.storeTokens({ access_token: FIX_ACCESS, refresh_token: FIX_REFRESH, expires_in: 900 });
  await plugin.saveTokens();
  const { rows, tab } = await renderTab(h);
  tab.display = () => {}; /* the re-render is not the subject here */
  await rows.find((r) => r.name === 'Keys are stored in').dropdowns[0].change('env-file');
  assert.equal(plugin.data.secretsBackend, 'env-file');
  assert.equal(saves[saves.length - 1].secretsBackend, 'env-file');
  assert.equal(store.map.get(M.SECRET_FIELDS.refresh_token.id), FIX_REFRESH, 'the keychain still holds the key');
  assert.ok(!h.adapter.map.has(M.DEFAULT_ENV_FILE_PATH), 'nothing was written to the env file');
  assert.ok(!plugin.isConnected(), 'the env file is empty, so the plugin is not connected: no fallback');
  assert.ok(h.adapter.map.get('.gitignore').split('\n').includes(M.DEFAULT_ENV_FILE_PATH), 'the env file path is git-ignored the moment it becomes the backend');
  assertNoLeak(h);
});

test('the mobile Notice names the way out under the keychain, and under the env file says when the file follows the vault and how to paste', () => {
  assert.match(source, /Connecting needs the desktop app once\. With the env file as the backend the connection follows the vault when your sync carries hidden files \(iCloud Drive, git and Dropbox do; Obsidian Sync skips files whose name starts with a dot\)\. With Obsidian Sync, paste the refresh token into the settings tab on this device\./);
  assert.match(source, /with Obsidian's keychain as the backend the connection stays on the device where you connect/);
  assert.doesNotMatch(source, /syncs to this device with the vault/);
});

/* --------------------------------------- 6. THE FIX PASS (Vex C-1 to C-4, Flint 1 and 3) -- */

test('C-1: upsertEnvLine refuses a value with a line break, so an upstream string can never become a second key', () => {
  const { M } = makePlugin();
  /* Vex's proof string, verbatim: it used to return "A=1\nMYICOR_ACCESS_TOKEN=x\nB=1\n". */
  assert.throws(() => M.upsertEnvLine('A=1\n', 'MYICOR_ACCESS_TOKEN', 'x\nB=1'), /line break/);
  assert.throws(() => M.upsertEnvLine('A=1\n', 'MYICOR_ACCESS_TOKEN', 'x\rB=1'), /line break/);
  assert.throws(() => M.upsertEnvLine('MYICOR_ACCESS_TOKEN=old\n', 'MYICOR_ACCESS_TOKEN', 'x\nB=1'), /line break/, 'the rewrite path refuses too');
  assert.equal(M.upsertEnvLine('A=1\n', 'MYICOR_ACCESS_TOKEN', 'x'), 'A=1\nMYICOR_ACCESS_TOKEN=x\n', 'a plain value still lands');
});

test('C-1: a token with a line break from the endpoint never reaches the env file; saveTokens rejects and the file is untouched', async () => {
  const h = makePlugin({ data: { secretsBackend: 'env-file' } });
  const { M, plugin, adapter } = h;
  const before = 'OTHER=1\n';
  adapter.map.set(M.DEFAULT_ENV_FILE_PATH, before);
  await plugin.initSecrets();
  plugin.storeTokens({ access_token: 'x\nEVIL=1', refresh_token: 'r', expires_in: 900 });
  await assert.rejects(plugin.saveTokens(), /line break/);
  assert.equal(adapter.map.get(M.DEFAULT_ENV_FILE_PATH), before, 'byte-identical');
  assert.ok(!adapter.writes.includes(M.DEFAULT_ENV_FILE_PATH), 'no write at all');
  assertNoLeak(h, ['EVIL=1']);
});

test('C-4: blanking a key the env file never had changes nothing, and a disconnect writes nothing to such a file', async () => {
  const h = makePlugin({ data: { secretsBackend: 'env-file' } });
  const { M, plugin, adapter } = h;
  /* Vex's proof string: it used to return "A=1\nMYICOR_ACCESS_TOKEN=\n". */
  assert.equal(M.upsertEnvLine('A=1\n', 'MYICOR_ACCESS_TOKEN', ''), 'A=1\n');
  assert.equal(M.upsertEnvLine('', 'MYICOR_ACCESS_TOKEN', ''), '');
  assert.equal(M.upsertEnvLine('A=1\nT=secret\n', 'T', ''), 'A=1\nT=\n', 'a key the file has is still blanked in place');
  const before = '# team keys\nOPENAI_API_KEY=sk-not-real\n';
  adapter.map.set(M.DEFAULT_ENV_FILE_PATH, before);
  await plugin.initSecrets();
  const writes = adapter.writes.length;
  await plugin.disconnect();
  assert.equal(adapter.map.get(M.DEFAULT_ENV_FILE_PATH), before, 'no empty MYICOR_ lines appended');
  assert.equal(adapter.writes.length, writes, 'the file was not written');
  assertNoLeak(h);
});

test('C-4: a disconnect never creates empty keychain ids; an existing id is cleared, through deleteSecret where the API has one', async () => {
  /* A store that never held the keys: nothing is written. */
  const fresh = fakeSecretStorage();
  const h1 = makePlugin({ secretStorage: fresh });
  await h1.plugin.initSecrets();
  await h1.plugin.disconnect();
  assert.deepEqual(fresh.sets, [], 'no setSecret call');
  assert.deepEqual(fresh.listSecrets(), [], 'no id created');

  /* A store without deleteSecret that holds the keys: '' is the only clear. */
  const held = fakeSecretStorage();
  const h2 = makePlugin({ secretStorage: held });
  const { M } = h2;
  await h2.plugin.initSecrets();
  h2.plugin.storeTokens({ access_token: FIX_ACCESS, refresh_token: FIX_REFRESH, expires_in: 900 });
  await h2.plugin.saveTokens();
  await h2.plugin.disconnect();
  assert.equal(held.map.get(M.SECRET_FIELDS.access_token.id), '');
  assert.equal(held.map.get(M.SECRET_FIELDS.refresh_token.id), '');

  /* A store with deleteSecret: the ids go away instead. */
  const deletable = fakeSecretStorage();
  deletable.deleted = [];
  deletable.deleteSecret = function (id) { this.deleted.push(id); this.map.delete(id); };
  const h3 = makePlugin({ secretStorage: deletable });
  await h3.plugin.initSecrets();
  h3.plugin.storeTokens({ access_token: FIX_ACCESS, refresh_token: FIX_REFRESH, expires_in: 900 });
  await h3.plugin.saveTokens();
  const setsBefore = deletable.sets.length;
  await h3.plugin.disconnect();
  assert.deepEqual(deletable.deleted.sort(), [M.SECRET_FIELDS.access_token.id, M.SECRET_FIELDS.refresh_token.id].sort());
  assert.deepEqual(deletable.listSecrets(), [], 'both ids gone');
  assert.equal(deletable.sets.length, setsBefore, 'no setSecret with an empty value');
  assert.ok(!h3.plugin.isConnected());
  assertNoLeak(h3);
});

test('C-3: normalizeEnvFilePath keeps a vault-relative file, tidies slashes and dots, and refuses absolute, home and ..', () => {
  const { M } = makePlugin();
  const n = (v) => clone(M.normalizeEnvFilePath(v));
  assert.deepEqual(n('keys/.env'), { ok: true, path: 'keys/.env', error: '' });
  assert.deepEqual(n('  ./keys//sub/./.env  '), { ok: true, path: 'keys/sub/.env', error: '' });
  assert.equal(n('keys\\.env').path, 'keys/.env', 'backslashes read as slashes');
  assert.equal(n(M.DEFAULT_ENV_FILE_PATH).path, M.DEFAULT_ENV_FILE_PATH);
  for (const bad of ['', '   ', null, undefined]) assert.equal(n(bad).ok, false, 'empty: ' + JSON.stringify(bad));
  for (const bad of ['/etc/.env', '/Users/tom/.env', 'C:/keys/.env', 'c:\\keys\\.env', '~/.env']) {
    const r = n(bad);
    assert.equal(r.ok, false, bad);
    assert.match(r.error, /relative to the vault root/);
  }
  for (const bad of ['../.env', 'keys/../../.env', '..', 'a/b/..']) {
    const r = n(bad);
    assert.equal(r.ok, false, bad);
    assert.match(r.error, /no "\.\."/);
  }
  for (const bad of ['.', './', '/']) assert.equal(n(bad).ok, false, bad);
  for (const v of ['keys/.env', '/etc/.env', '../.env', '']) assert.doesNotMatch(n(v).error, /FIX|token/i);
});

test('C-3: a stored env path that climbs out of the vault, or is absolute, is replaced by the default before anything is written', async () => {
  for (const bad of ['../../outside/.env', '/Users/tom/outside/.env']) {
    const h = makePlugin({ data: Object.assign({}, fixture, { secretsBackend: 'env-file', envFilePath: bad }) });
    const { M, plugin, adapter, saves } = h;
    await plugin.initSecrets();
    assert.equal(plugin.envFilePath(), M.DEFAULT_ENV_FILE_PATH, bad);
    assert.equal(plugin.data.envFilePath, M.DEFAULT_ENV_FILE_PATH, 'pinned into data.json');
    assert.equal(saves[saves.length - 1].envFilePath, M.DEFAULT_ENV_FILE_PATH);
    assert.deepEqual([...adapter.map.keys()].filter((k) => k !== '.gitignore'), [M.DEFAULT_ENV_FILE_PATH], 'the migration wrote the default file and nothing else');
    assert.ok(adapter.map.get('.gitignore').split('\n').includes(M.DEFAULT_ENV_FILE_PATH));
    assert.ok(!adapter.map.get('.gitignore').includes('outside'), 'the bad path never reached .gitignore');
    assert.ok(plugin.isConnected());
    assertNoLeak(h);
    /* And the read side on its own, after load: a bad value that reaches
       data.envFilePath by any route still resolves to the default. */
    plugin.data.envFilePath = bad;
    assert.equal(plugin.envFilePath(), M.DEFAULT_ENV_FILE_PATH, 'envFilePath() checks, not only initSecrets');
    assert.equal(plugin.secretsBackendFor('env-file').path, M.DEFAULT_ENV_FILE_PATH);
  }
});

test('C-2: typing keys/.env into the env path field touches nothing per keystroke; the settled value adds one line to .gitignore once, and a bad path is refused with the reason', async () => {
  const h = makePlugin({ data: { secretsBackend: 'env-file' }, files: { '.gitignore': '# vault\n' } });
  const { M, plugin, adapter, saves, notices } = h;
  await plugin.initSecrets();
  const giAfterLoad = adapter.map.get('.gitignore');
  const { rows, tab } = await renderTab(h);
  tab.display = () => {}; /* the re-render is not the subject here */
  const field = rows.find((r) => r.name === 'Env file').texts[0];
  assert.equal(field.change, null, 'no per-keystroke handler is wired');
  const handlers = field.inputEl.handlers.change || [];
  assert.equal(handlers.length, 1, 'one settled-value handler (blur or Enter)');
  const settle = handlers[0];

  const savesBefore = saves.length;
  const writesBefore = adapter.writes.length;
  const typed = 'keys/.env';
  for (let i = 1; i <= typed.length; i++) {
    field.inputEl.value = typed.slice(0, i);
    assert.equal(adapter.map.get('.gitignore'), giAfterLoad, 'no .gitignore write while typing "' + typed.slice(0, i) + '"');
  }
  assert.equal(saves.length, savesBefore, 'no data.json write while typing');
  assert.equal(adapter.writes.length, writesBefore);

  await settle();
  assert.equal(plugin.data.envFilePath, 'keys/.env');
  assert.equal(saves[saves.length - 1].envFilePath, 'keys/.env');
  const gi = adapter.map.get('.gitignore');
  const lines = gi.split('\n');
  assert.equal(lines.filter((l) => l === 'keys/.env').length, 1, 'exactly one line for the settled path');
  assert.equal(lines.filter((l) => l.startsWith('# ICOR for Life - Connect')).length, 2, 'one block from load (the default path), one from the settled value');
  for (const partial of ['k', 'ke', 'key', 'keys', 'keys/', 'keys/.', 'keys/.e', 'keys/.en']) assert.ok(!lines.includes(partial), 'no half-typed path: ' + partial);

  /* The same value settled again (a second blur) appends nothing. */
  await settle();
  assert.equal(adapter.map.get('.gitignore'), gi, 'already there, not appended again');

  /* A path that leaves the vault: refused with the reason, the setting keeps its last good value, the field is put back. */
  field.inputEl.value = '../outside/.env';
  await settle();
  assert.equal(plugin.data.envFilePath, 'keys/.env', 'unchanged');
  assert.equal(field.value, 'keys/.env', 'the field shows the value in force again');
  assert.match(notices[notices.length - 1], /must stay inside the vault/);
  assert.equal(adapter.map.get('.gitignore'), gi, 'nothing added for the refused path');

  /* Clearing the field returns to the default. */
  field.inputEl.value = '';
  await settle();
  assert.equal(plugin.data.envFilePath, M.DEFAULT_ENV_FILE_PATH);
  assertNoLeak(h);
});

test('Flint 1 and 3: the tab and the README say when the env file follows the vault, and the env file description is sentence case', async () => {
  const h = makePlugin({ secretStorage: fakeSecretStorage() });
  await h.plugin.initSecrets();
  const { rows } = await renderTab(h);
  const backend = rows.find((r) => r.name === 'Keys are stored in');
  assert.match(backend.desc, /Obsidian Sync skips files whose name starts with a dot/);
  assert.doesNotMatch(backend.desc, /follows the vault to every device\. /, 'the unqualified promise is gone');
  const env = rows.find((r) => r.name === 'Env file');
  assert.doesNotMatch(env.desc, /KEY=value/);
  assert.match(env.desc, /key=value/);
  /* THE README MOVED AND THIS PIN FOLLOWED IT (2026-09-17). Commit 4c8ec0b
     rewrote README.md for the person installing the plugin rather than the
     person rebuilding it, and the two sentences pinned here went with the
     mechanics. The GATE's subject is unchanged - the README still has to tell
     a member that one setting decides whether the connection stays on this
     device - so it pins the sentence the README now carries. The dot-file
     detail is still asserted above, on the settings tab, which is where a
     member meets it before choosing. */
  const readme = readFileSync(resolve(repo, 'README.md'), 'utf8');
  assert.match(readme, /follows\s+the vault to every device you sync/);
  assert.doesNotMatch(readme, /in every backup and sync of the vault/);
  assert.doesNotMatch(readme, /the connection follows the vault to every device;/);
  for (const text of [backend.desc, env.desc, readme]) assert.ok(!/[–—]/.test(text), 'no em or en dash');
});
