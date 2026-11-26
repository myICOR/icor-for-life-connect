/* THE SIGN-IN GATE (0.18.1, the Obsidian directory pass).
 *
 * 1. PKCE is made with Web Crypto, never Node's `crypto` module: the plugin
 *    keeps isDesktopOnly false, and the directory's review flags a Node
 *    module that is not behind a desktop check. The challenge must still be
 *    the RFC 7636 S256 of the verifier.
 * 2. The page the loopback server sends to the browser escapes the error
 *    detail, which comes from the redirect's query string.
 * 3. No element gets an HTML string: the directory refuses innerHTML with
 *    anything but a literal, so the marks are drawn with createSvg.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { createHash, webcrypto } from 'node:crypto';
import vm from 'node:vm';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(resolve(repo, 'main.js'), 'utf8');
const nodeRequire = createRequire(import.meta.url);

function load() {
  const asked = [];
  const obsidian = {
    Plugin: class {}, ItemView: class {}, Notice: class {}, PluginSettingTab: class {}, Setting: class {},
    requestUrl: async () => { throw new Error('no network in this gate'); },
    setIcon: () => {}, Platform: { isDesktopApp: false, isMobileApp: true },
  };
  const sandbox = {
    require: (name) => {
      asked.push(name);
      if (name === 'obsidian') return obsidian;
      if (name === 'crypto' || name === 'node:crypto') throw new Error('Node crypto is not on a phone');
      return nodeRequire(name);
    },
    module: { exports: {} },
    document: { querySelector: () => null, querySelectorAll: () => [] },
    window: { setTimeout, clearTimeout },
    MutationObserver: class { observe() {} disconnect() {} },
    crypto: webcrypto, btoa, TextEncoder, Uint8Array,
    console, setTimeout, clearTimeout, URL,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'main.js' });
  return { M: sandbox.module.exports, asked };
}

const b64urlOf = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

test('PKCE comes from Web Crypto: an S256 challenge of a 64-character verifier, and Node crypto is never asked for', async () => {
  const { M, asked } = load();
  const a = await M.makePkce();
  const b = await M.makePkce();
  assert.match(a.verifier, /^[A-Za-z0-9_-]{64}$/, '48 random bytes, base64url without padding');
  assert.match(a.state, /^[A-Za-z0-9_-]{22}$/);
  assert.equal(a.challenge, b64urlOf(createHash('sha256').update(a.verifier).digest()));
  assert.notEqual(a.verifier, b.verifier);
  assert.ok(!asked.includes('crypto') && !asked.includes('node:crypto'), `asked for ${asked.join(', ')}`);
  assert.doesNotMatch(source, /require\(['"](node:)?crypto['"]\)/);
});

test('b64url matches Node base64url for every byte value', () => {
  const { M } = load();
  const all = new Uint8Array(256).map((_, i) => i);
  assert.equal(M.b64url(all), b64urlOf(all));
});

test('the browser page escapes the error detail from the redirect', () => {
  const { M } = load();
  const html = M.callbackHtml(false, '<img src=x onerror=alert(1)>"\'&');
  assert.ok(!html.includes('<img'), 'markup in the detail must not reach the page');
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;&quot;&#39;&amp;'));
  assert.ok(M.callbackHtml(true).includes('<svg'), 'the mark is still on the page');
});

test('no element is given an HTML string: no innerHTML, outerHTML or insertAdjacentHTML in main.js', () => {
  assert.doesNotMatch(source, /\.(innerHTML|outerHTML)\s*=/);
  assert.doesNotMatch(source, /insertAdjacentHTML\s*\(/);
});
