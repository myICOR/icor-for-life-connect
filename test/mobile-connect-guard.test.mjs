/* THE MOBILE-CONNECT-GUARD GATE (Flint's mobile audit, fix 3 / guard-swap half).
 *
 * doConnect()'s mobile guard used to be `try { http = require('http');
 * require('crypto'); } catch (e) { http = null; }` followed by `if (!http)`.
 * A try/catch around a Node require is not the guard shape the community
 * directory's automated scanner recognises for a plugin that keeps
 * isDesktopOnly false; the recognised shape is a Platform check as the very
 * first statement, before any require -- the same shape this suite's sibling
 * repo already uses for Planner's imapConnect (main.js, imap-transport
 * gate). This does NOT touch the token-storage design (that is Vex's gate,
 * running in parallel) and it does not touch anything past the guard.
 *
 * Two things to prove:
 *   1. SOURCE: Platform.isDesktopApp is checked as the first statement of
 *      doConnect, before any require() call anywhere in the function.
 *   2. BEHAVIOUR: with Platform.isDesktopApp false, doConnect() rejects with
 *      the same member-facing Notice and error it always has, and it does
 *      so without ever touching the loopback server (authServer stays
 *      unset) -- proving the guard is really the first thing that runs, not
 *      just the first thing SOURCE says.
 *
 * The desktop path itself (the real loopback server, PKCE, dynamic client
 * registration) is unchanged by this fix and is not re-exercised here:
 * doConnect() takes no injectable deps for http/crypto (unlike Planner's
 * imapConnect(opts, deps)), and refactoring it to take one would be a
 * change beyond the guard swap this fix is scoped to.
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

/* ------------------------------------------------------------- SOURCE -- */

test('doConnect checks Platform.isDesktopApp before the first require, first statement', () => {
  const code = source.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  const start = code.indexOf('async doConnect() {');
  assert.ok(start >= 0, 'doConnect must exist');
  const rest = code.slice(start);
  // the next method or the end of the class body ends the function's own text
  const endRel = rest.slice(1).search(/\n  [a-zA-Z_$][\w$]*\([^)]*\) \{|\n\}/);
  const fn = endRel >= 0 ? rest.slice(0, endRel + 1) : rest;
  const firstRequire = fn.indexOf('require(');
  assert.ok(firstRequire >= 0, 'doConnect asks for http/crypto');
  const guardAt = fn.indexOf('Platform.isDesktopApp');
  assert.ok(guardAt >= 0 && guardAt < firstRequire, 'Platform.isDesktopApp must be checked before the first require');
  assert.match(fn.slice(0, firstRequire), /if \(!Platform\.isDesktopApp\) \{/, 'the guard must be an early-exit as the first statement');
  assert.doesNotMatch(fn, /try\s*\{\s*http\s*=\s*require\(/, 'the old try/catch-require guard shape must be gone');
});

test('Platform is imported from obsidian (doConnect can only check what the module actually requires)', () => {
  assert.match(source, /const \{[^}]*\bPlatform\b[^}]*\} = require\('obsidian'\)/);
});

/* ----------------------------------------------------------- BEHAVIOUR -- */

function loadPlugin({ isDesktopApp } = {}) {
  const notices = [];
  const obsidian = {
    Plugin: class { constructor(app, manifest) { this.app = app; this.manifest = manifest; } },
    ItemView: class { constructor(leaf) { this.leaf = leaf; } },
    Notice: class { constructor(msg) { notices.push(String(msg)); } },
    requestUrl: async () => { throw new Error('no network in this gate'); },
    setIcon: () => {},
    Platform: { isDesktopApp, isMobileApp: !isDesktopApp },
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
  const PluginClass = sandbox.module.exports;
  const app = { workspace: {}, vault: {}, setting: { open() {} } };
  const plugin = new PluginClass(app, { id: 'icor-for-life-connect', version: '0.0.0-gate' });
  plugin.data = {};
  return { plugin, notices };
}

test('off the desktop app, doConnect rejects immediately with the member sentence, and no loopback server is ever created', async () => {
  const { plugin, notices } = loadPlugin({ isDesktopApp: false });
  await assert.rejects(plugin.doConnect(), /connecting requires the desktop app/);
  assert.equal(notices.length, 1, `expected exactly one Notice, got ${JSON.stringify(notices)}`);
  assert.match(notices[0], /Connecting needs the desktop app once\. Connect there and the connection syncs to this device with the vault\./);
  assert.ok(!plugin.authServer, 'a loopback server handle exists -- the guard let something past it before rejecting');
});

test('the mobile Notice carries no em dash or en dash', () => {
  assert.ok(!/Connecting needs the desktop app[^]*?vault\./.test(''), 'sanity: pattern compiles');
  const m = source.match(/'Connecting needs the desktop app once\. Connect there and the connection syncs to this device with the vault\.'/);
  assert.ok(m, 'the exact Notice string must be present, unchanged by this fix');
  assert.ok(!/[–—]/.test(m[0]));
});
