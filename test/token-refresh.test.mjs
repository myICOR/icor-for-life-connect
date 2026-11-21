/* ONE REFRESH AT A TIME, AND ONLY A REAL "NO" SIGNS YOU OUT.
 *
 * The dashboard makes four MCP calls at once. With an expired access token,
 * 0.16 refreshed four times with the same rotating refresh token, the server
 * refused all but the first, and any non-200 threw the tokens away: members
 * were signed out at random, even by a 429 or a 5xx. These gates hold:
 *   1. concurrent callers share one refresh request and all get the new token;
 *   2. invalid_grant (or a bare 400/401) signs out;
 *   3. a 429, a 5xx or a network failure keeps the connection.
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

function loadPlugin(requestUrl) {
  const obsidian = {
    Plugin: class { constructor(app, manifest) { this.app = app; this.manifest = manifest; } },
    ItemView: class { constructor(leaf) { this.leaf = leaf; } },
    Notice: class { constructor() {} },
    requestUrl,
    setIcon: () => {},
    Platform: { isDesktopApp: true, isMobileApp: false },
    PluginSettingTab: class { constructor(app, plugin) { this.app = app; this.plugin = plugin; } },
    Setting: class {},
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
  const plugin = new sandbox.module.exports({ workspace: {}, vault: {} }, { id: 'icor-for-life-connect', version: '0.0.0-gate' });
  plugin.saved = 0;
  plugin.saveTokens = async () => { plugin.saved += 1; };
  plugin.refreshExplorerDot = () => {};
  plugin.tokens = { access_token: 'old-access', refresh_token: 'refresh-1', expires_at: Date.now() - 1000 };
  return plugin;
}

const answer = (status, json) => ({ status, get json() { if (json === undefined) throw new Error('not json'); return json; } });

test('four calls at once share one refresh, and all get the new token', async () => {
  const sent = [];
  const plugin = loadPlugin(async (req) => {
    sent.push(JSON.parse(req.body).refresh_token);
    await new Promise((r) => setTimeout(r, 10));
    return answer(200, { access_token: 'new-access', refresh_token: 'refresh-2', expires_in: 900 });
  });
  const tokens = await Promise.all([1, 2, 3, 4].map(() => plugin.ensureToken()));
  assert.deepEqual(tokens, ['new-access', 'new-access', 'new-access', 'new-access']);
  assert.deepEqual(sent, ['refresh-1'], 'exactly one refresh request');
  assert.equal(plugin.tokens.refresh_token, 'refresh-2');
  assert.equal(plugin.refreshing, null, 'the in-flight refresh is cleared');
});

test('invalid_grant signs out; so does a bare 401', async () => {
  const a = loadPlugin(async () => answer(400, { error: 'invalid_grant' }));
  await assert.rejects(a.ensureToken(), /session expired/);
  assert.equal(a.tokens, null);
  const b = loadPlugin(async () => answer(401, undefined));
  await assert.rejects(b.ensureToken(), /session expired/);
  assert.equal(b.tokens, null);
});

test('a rate limit, a server error or no network keeps the connection', async () => {
  for (const make of [
    async () => answer(429, { error: 'rate_limited' }),
    async () => answer(503, undefined),
    async () => answer(500, { error: 'server_error' }),
    async () => { throw new Error('offline'); },
  ]) {
    const plugin = loadPlugin(make);
    await assert.rejects(plugin.ensureToken(), /still connected/);
    assert.equal(plugin.tokens && plugin.tokens.refresh_token, 'refresh-1', 'tokens kept');
  }
});
