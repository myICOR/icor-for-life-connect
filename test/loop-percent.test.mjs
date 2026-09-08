/* THE LOOP-PERCENT GATE.
 *
 * The Overview's hero says "Your loop is X% drawn." and the rail's ink runs
 * X% down the path. Until 0.15.0 X was the plugin's own mean over the five
 * journey courses' progress_percent, the same formula the app uses; the two
 * still disagreed (15% here, 98% in the app, reported in the Connect
 * channel 2026-09-08) because the MCP server computed progress_percent by a
 * different rule. The server now ships the app's number itself as
 * `get_my_journey.loop_percent` and the closed-course count as
 * `courses_completed`; the plugin reads those and keeps the mean only as
 * the fallback for a server that has not shipped them. This gate proves:
 *
 *   1. with loop_percent = 98 and five courses averaging 15, the hero
 *      heading, the gauge label and the rail ink all say 98;
 *   2. without loop_percent the mean is used;
 *   3. a loop_percent outside 0..100, or not a number, falls back to the
 *      mean rather than rendering nonsense;
 *   4. "COURSES CLOSED n OF m" takes n from courses_completed when it is
 *      there, else counts the courses at 100; m stays the course count;
 *   5. SOURCE: the mean is written exactly once in main.js, inside
 *      loopPercent, so the two call sites cannot drift apart again.
 *
 * Behaviour through renderOverview on the real DashboardView class over the
 * fake DOM, so the number is measured where the member reads it, not on
 * the helper alone.
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
  const frames = [];
  const obsidian = {
    Plugin: class { constructor(app, manifest) { this.app = app; this.manifest = manifest; } },
    ItemView: class { constructor(leaf) { this.leaf = leaf; this.contentEl = new FakeEl('div'); } },
    Notice: class { constructor() {} },
    requestUrl: async () => { throw new Error('no network in this gate'); },
    setIcon: (el, icon) => { el.attrs['data-icon'] = icon; },
    Platform: { isDesktopApp: true, isMobileApp: false },
    PluginSettingTab: class { constructor(app, plugin) { this.app = app; this.plugin = plugin; } },
    Setting: class {},
  };
  const doc = {
    createElementNS: (ns, tag) => makeEl(tag),
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  const sandbox = {
    require: (name) => (name === 'obsidian' ? obsidian : nodeRequire(name)),
    module: { exports: {} },
    document: doc,
    /* rAF callbacks are collected, not run: the gate flushes them itself
       and then reads the ink height the frame wrote. */
    window: { setTimeout, clearTimeout, requestAnimationFrame: (fn) => frames.push(fn), open() {} },
    IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
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
  const exported = sandbox.module.exports;
  const flush = () => { while (frames.length) frames.shift()(); };
  return { exported, flush };
}

function course(i, progress) {
  return {
    id: 'c' + i, name: 'Course ' + i, course_type: 'icor_journey', url: 'https://app.myicor.com/c' + i,
    progress_percent: progress, lesson_count: 10, completed_lessons: Math.round(progress / 10),
  };
}

/* Five journey courses whose progress_percent average exactly 15. */
const FIFTEEN = [45, 30, 0, 0, 0].map((p, i) => course(i + 1, p));

async function renderOverview(journey, courses) {
  const { exported, flush } = loadPlugin();
  const plugin = {
    data: {},
    isClaudeWired: async () => false,
    mcpCall: async () => { throw new Error('no network in this gate'); },
  };
  const view = new exported.DashboardView({}, plugin);
  view.root = view.contentEl;
  const body = view.root.createDiv({ cls: 'micor-body' });
  await view.renderOverview(body, {
    growth: {}, journey, byCategory: {}, courses: { courses, summary: {} }, fetchedAt: new Date(0),
  });
  flush();
  const text = (sel) => { const el = body.querySelector(sel); assert.ok(el, sel + ' missing'); return el.textContent; };
  const closedRow = body.querySelector('.micor-momentum-row');
  assert.ok(closedRow, '.micor-momentum-row missing');
  return {
    heading: text('.micor-loop-display'),
    gaugeLabel: body.querySelector('.micor-loop-gauge').getAttribute('aria-label'),
    railInk: body.querySelector('.micor-rail-ink').style.height,
    railTip: body.querySelector('.micor-rail-tip').style.top,
    closed: closedRow.children[1].textContent,
    exported,
  };
}

/* ---------------------------------------------------------- BEHAVIOUR -- */

test('loop_percent from the server wins over the mean of course progress', async () => {
  const r = await renderOverview({ loop_percent: 98 }, FIFTEEN);
  assert.equal(r.heading, 'Your loop is 98% drawn.');
  assert.equal(r.gaugeLabel, 'Your loop: 98% drawn');
  assert.equal(r.railInk, '98%', 'the rail ink still runs its own mean');
  assert.equal(r.railTip, '98%');
});

test('without loop_percent the mean of the journey courses is used', async () => {
  const r = await renderOverview({}, FIFTEEN);
  assert.equal(r.heading, 'Your loop is 15% drawn.');
  assert.equal(r.gaugeLabel, 'Your loop: 15% drawn');
  assert.equal(r.railInk, '15%');
});

test('a loop_percent outside 0..100 or not a number falls back to the mean', async () => {
  for (const bad of [140, -1, '98', NaN, Infinity, null, {}]) {
    const r = await renderOverview({ loop_percent: bad }, FIFTEEN);
    assert.equal(r.heading, 'Your loop is 15% drawn.', 'loop_percent=' + String(bad) + ' rendered');
    assert.equal(r.railInk, '15%', 'loop_percent=' + String(bad) + ' reached the rail');
  }
});

test('a fractional loop_percent is rounded', async () => {
  const r = await renderOverview({ loop_percent: 97.6 }, FIFTEEN);
  assert.equal(r.heading, 'Your loop is 98% drawn.');
});

test('courses closed reads courses_completed when the server sends it', async () => {
  const twoDone = [100, 100, 40, 0, 0].map((p, i) => course(i + 1, p));
  const r = await renderOverview({ loop_percent: 98, courses_completed: 4 }, twoDone);
  assert.equal(r.closed, '4 OF 5');
});

test('courses closed counts the courses at 100 when courses_completed is missing or not a whole number', async () => {
  const twoDone = [100, 100, 40, 0, 0].map((p, i) => course(i + 1, p));
  for (const journey of [{}, { courses_completed: null }, { courses_completed: 2.5 }, { courses_completed: '4' }, { courses_completed: -1 }]) {
    const r = await renderOverview(journey, twoDone);
    assert.equal(r.closed, '2 OF 5', JSON.stringify(journey) + ' changed the count');
  }
});

test('the helpers alone: empty course list, no journey', () => {
  const { exported } = loadPlugin();
  assert.equal(exported.loopPercent(null, []), 0);
  assert.equal(exported.loopPercent(undefined, undefined), 0);
  assert.equal(exported.loopPercent({ loop_percent: 0 }, FIFTEEN), 0, 'a real 0 from the server is 0, not the mean');
  assert.equal(exported.loopPercent({ loop_percent: 100 }, FIFTEEN), 100);
  assert.equal(exported.coursesClosed(null, []), 0);
  assert.equal(exported.coursesClosed({ courses_completed: 0 }, [course(1, 100)]), 0, 'a real 0 from the server is 0, not the count');
});

/* ------------------------------------------------------------- SOURCE -- */

test('the mean over course progress is written once, inside loopPercent', () => {
  const formula = /reduce\(\(a, c\) => a \+ \(c\.progress_percent \|\| 0\), 0\)/g;
  const hits = [...source.matchAll(formula)].map((m) => m.index);
  assert.equal(hits.length, 1, 'the mean is written ' + hits.length + ' times; renderOverview and renderLoopPath used to each carry one');
  const fnStart = source.indexOf('function loopPercent(');
  const fnEnd = source.indexOf('\n}', fnStart);
  assert.ok(fnStart >= 0 && hits[0] > fnStart && hits[0] < fnEnd, 'the one copy is not inside loopPercent');
  assert.match(source, /const inkPct = loopPercent\(journey, journeyCourses\);/, 'renderOverview does not call loopPercent');
  assert.match(source, /renderLoopPath\(sec, journeyCourses, currentCourse, inkPct\)/, 'renderLoopPath does not take the value in');
});
