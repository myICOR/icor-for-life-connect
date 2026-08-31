/* THE BANNER-ANCHOR GATE.
 *
 * INKLINE paints the ICOR for Life banner over the folder tree and cannot make
 * it clickable: a theme is CSS, and CSS has no way to make a `::before`
 * navigate. This plugin supplies the one thing only the DOM can - a real
 * anchor - and the theme recognises it by class name and stands its painted
 * copy down.
 *
 * A handover between two repos is exactly where a green test is worth least
 * and most. The class name `micor-banner` is a contract with a file that
 * ships separately and updates on its own schedule, so this gate measures the
 * plugin's whole half of it:
 *
 *   1. the anchor exists, points at the landing page, and is FIRST in the
 *      header, because the theme's geometry assumes the banner is what
 *      everything below it aligns to;
 *   2. it is NOT created when the active theme paints no banner, so a user on
 *      some other theme never gets an empty 4:1 box in their sidebar;
 *   3. it survives the host rebuilding the header, and never duplicates;
 *   4. unload takes it away.
 *
 * Behaviour, not source text. A grep for 'micor-banner' stays green on an
 * anchor that is created and never inserted.
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

/* `themePaints` is the whole point of the second gate: it stands in for the
   active theme's `.nav-header::before`. INKLINE reports a background image
   there; a theme that has never heard of this plugin reports 'none'. */
function loadPlugin({ themePaints = true } = {}) {
  const opened = [];

  const body = new FakeEl('body');
  const explorer = body.createDiv({
    cls: 'workspace-leaf-content', attr: { 'data-type': 'file-explorer' } });

  const buildHeader = () => {
    const old = explorer.querySelector('.nav-header');
    if (old) old.remove();
    const header = explorer.createDiv({ cls: 'nav-header' });
    header.createDiv({ cls: 'nav-buttons-container' });
    return header;
  };
  buildHeader();

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
  };

  const sandbox = {
    require: (name) => (name === 'obsidian' ? obsidian : nodeRequire(name)),
    module: { exports: {} },
    document: doc,
    window: {
      setTimeout,
      clearTimeout,
      open: (url, target) => opened.push([url, target]),
      getComputedStyle: (el, pseudo) => {
        if (pseudo !== '::before' || !el.classSet.has('nav-header')) {
          return { backgroundImage: 'none', content: 'none' };
        }
        return themePaints
          ? { backgroundImage: 'url("data:image/webp;base64,AAAA")', content: '""' }
          : { backgroundImage: 'none', content: 'none' };
      },
    },
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
  const plugin = new PluginClass(
    { commands: { executeCommandById: () => true }, workspace: {}, vault: {}, setting: { open() {} } },
    { id: 'icor-for-life-connect', version: '0.0.0-gate' });
  plugin.data = {};
  return { plugin, body, explorer, buildHeader, opened, doc };
}

const banner = (explorer) => explorer.querySelector('a.micor-banner');

test('the anchor is first in the header and points at the landing page', () => {
  const { plugin, explorer } = loadPlugin();
  plugin.attachBanner();

  const header = explorer.querySelector('.nav-header');
  const link = banner(explorer);
  assert.ok(link, 'no anchor was injected, so the banner INKLINE paints stays unclickable');
  assert.equal(header.children[0], link,
    'the anchor is not the first child of the header. The theme aligns everything below the '
    + 'banner to it, so a banner that is not first is a banner nothing lines up with.');
  assert.equal(link.tagName, 'A', 'the banner is not an anchor, which is the one thing CSS could not do');
  assert.equal(link.getAttribute('href'), 'https://myicor.com',
    'the banner points somewhere other than the public landing page');
  assert.match(link.getAttribute('aria-label') || '', /myicor\.com/,
    'the anchor has no accessible name, so it is an unlabelled link to a screen reader');
});

test('a click opens the landing page outside the vault window', () => {
  const { plugin, explorer, opened } = loadPlugin();
  plugin.attachBanner();

  const ev = banner(explorer).click();

  assert.deepEqual(opened, [['https://myicor.com', '_blank']],
    'the click did not open the landing page in a new window; a page opening INSIDE the vault '
    + 'is a trap the user has to find their way out of');
  assert.ok(ev.defaultPrevented,
    'the handler left the href to the host as well, so the page can open twice');
});

test('no anchor on a theme that paints no banner', () => {
  /* The failure this prevents is visible and silly: a 4:1 empty box at the top
     of the sidebar of someone who installed a different theme entirely. */
  const { plugin, explorer } = loadPlugin({ themePaints: false });
  plugin.attachBanner();
  assert.equal(banner(explorer), null,
    'an anchor was injected over a theme that paints no banner, so that user gets an empty box '
    + 'where the artwork would have been');
});

test('the anchor comes back after the host rebuilds the header, and never duplicates', () => {
  const { plugin, explorer, buildHeader } = loadPlugin();
  plugin.attachBanner();
  assert.ok(banner(explorer), 'no anchor after the first pass');

  buildHeader();
  assert.equal(banner(explorer), null, 'the fixture did not actually rebuild the header');

  plugin.attachBanner();
  assert.ok(banner(explorer), 'the anchor did not come back after the header was rebuilt');

  plugin.attachBanner();
  plugin.attachBanner();
  assert.equal(explorer.querySelectorAll('a.micor-banner').length, 1,
    'repeated attach passes stacked more than one banner in the header');
});

test('an anchor from an earlier plugin instance is replaced, not left holding a dead handler', () => {
  const { plugin, explorer } = loadPlugin();
  plugin.attachBanner();
  const first = banner(explorer);
  first.dataset.micorInstance = 'an-older-instance';

  plugin.attachBanner();
  const second = banner(explorer);
  assert.notEqual(second, first,
    'the stale anchor survived, and it still carries the click handler of a plugin instance '
    + 'that is gone');
  assert.equal(explorer.querySelectorAll('a.micor-banner').length, 1, 'the replacement duplicated instead');
});

test('unload takes the banner away', () => {
  const { plugin, explorer } = loadPlugin();
  plugin.attachBanner();
  assert.ok(banner(explorer), 'nothing to unload');
  plugin.onunload();
  assert.equal(banner(explorer), null,
    'the anchor outlived the plugin, so the theme keeps its painted banner suppressed by a link '
    + 'that no longer does anything');
});
