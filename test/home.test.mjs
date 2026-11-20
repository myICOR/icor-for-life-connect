/* THE HOME GATE (0.17.0).
 *
 * Connect's main view is app.myicor.com's Home, as far as the myICOR MCP can serve it (Tom, 2026-11-20: "a visual
 * overhaul and representation of the new 'home' on app.myicor.com"). This gate holds:
 *
 *   1. THE MODEL: one place card per product in the app's menu order, with the app's lines; a meter only where the MCP
 *      serves the number (the journey's four courses, ICOR Teams, ICOR Build's outline), a plain note elsewhere, never a
 *      made-up figure; the newest video, article and podcast by Tom and Paco; the course to pick up.
 *   2. THE PAGE: rendered on the real DashboardView over the fake DOM: the weekday and "Find your way back to clear",
 *      the up-next line, the six lit cards with their marks, the two lists, and the reflections sync still reachable.
 *   3. THE SHELL: data-ink-plugin on the root, one bar with four pages, no masthead or drawn stroke on Home, the old
 *      Your Loop page opening Home.
 *   4. THE DATA: one round of parallel calls; the courses are required, every other piece is optional; the Build
 *      outline comes back as text.
 *   5. THE LOOK: every place has its light; no aura over the view; the marker on no place card.
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
const css = readFileSync(resolve(repo, 'styles.css'), 'utf8');
const nodeRequire = createRequire(import.meta.url);
const clone = (v) => JSON.parse(JSON.stringify(v));

function load({ notices = [], opened = [] } = {}) {
  const obsidian = {
    Plugin: class { constructor(app, manifest) { this.app = app; this.manifest = manifest; } },
    ItemView: class { constructor(leaf) { this.leaf = leaf; this.contentEl = new FakeEl('div'); } },
    Notice: class { constructor(msg) { notices.push(String(msg)); } },
    requestUrl: async () => { throw new Error('no network in this gate'); },
    setIcon: (el, icon) => { el.attrs['data-icon'] = icon; },
    Platform: { isDesktopApp: true, isMobileApp: false },
    PluginSettingTab: class { constructor(app, plugin) { this.app = app; this.plugin = plugin; } },
    Setting: class {},
  };
  const sandbox = {
    require: (name) => (name === 'obsidian' ? obsidian : nodeRequire(name)),
    module: { exports: {} },
    document: { createElementNS: (ns, tag) => makeEl(tag), querySelector: () => null, querySelectorAll: () => [] },
    window: { setTimeout, clearTimeout, requestAnimationFrame: () => {}, open(url) { opened.push(url); } },
    IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
    MutationObserver: class { observe() {} disconnect() {} },
    performance: { now: () => 0 },
    console, setTimeout, clearTimeout, encodeURIComponent,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'main.js' });
  return sandbox.module.exports;
}

const course = (slug, name, done, total, pct) => ({
  id: slug + '-id', name, course_type: 'icor_journey', required_lesson_count: total, lesson_count: total + 2,
  completed_required_lessons: done, completed_lessons: done, progress_percent: pct != null ? pct : Math.round((done / total) * 100),
  url: 'https://app.myicor.com/courses/' + slug,
});
const COURSES = { courses: [
  course('digital-note-taking-like-a-pro', 'Digital Note-Taking Like a Pro', 10, 10, 100),
  course('pkm', 'PKM Like a Pro', 4, 12),
  course('task-management', 'Task Management Like a Pro', 0, 9),
  course('automation', 'Automation Like a Pro', 0, 8),
  course('icor-teams', 'ICOR Teams', 3, 20),
  course('project-management', 'Project Management Like a Pro', 1, 6),
  course('claude-mastery', 'Claude Mastery', 2, 5),
] };
const OUTLINE = [
  '# ICOR Build', 'The ICOR Implementation Journey.',
  '\n## Foundations (core, 3 lessons)',
  '- foundations/1 · Set up the app (built): you have an app [30 min]',
  '- foundations/2 · The data model (built): notes in a table [45 min]',
  '- foundations/3 · Holista: an assistant that answers [40 min]',
  '\n## Capture (core, 1 lessons)',
  '- capture/1 · Quick capture: a line from anywhere [35 min]',
  '\n## Moved to the myPKA journey (2026-10-23)',
  '- old/1 · A team of agents (built): now in the myPKA journey',
  '\n## The myPKA journey',
  '- Trust (core, 4 lessons) · 2 built: the folder you trust',
].join('\n');
const RESOURCES = { resources: [
  { title: 'A member writes', type: 'Article', author: 'Some Member', published_date: '2026-11-19', url: 'https://app.myicor.com/resources/a' },
  { title: 'The newest video', type: 'Video', author: 'Tom Solid', published_date: '2026-11-18', image_url: 'https://img/v.jpg', duration_minutes: 14, url: 'https://app.myicor.com/resources/v' },
  { title: 'An older video', type: 'Video', author: 'Tom Solid', published_date: '2026-11-01', url: 'https://app.myicor.com/resources/v0' },
  { title: 'Paco on PKM', type: 'Article', author: 'Paco Cantero', published_date: '2026-11-15', url: 'https://app.myicor.com/resources/p' },
  { title: 'Episode 120', type: 'Podcast Episode', author: null, published_date: '2026-11-12', url: 'https://app.myicor.com/resources/e' },
] };
const DATA = { courses: COURSES, journey: { journey_complete_percent: 31 }, latest: RESOURCES, buildOutline: OUTLINE, fetchedAt: new Date('2026-11-20T10:00:00') };

/* --------------------------------------------------------- 1. THE MODEL -- */

test('the model: six places in the menu order, the app lines, meters only where the MCP has the number', () => {
  const M = load();
  const m = clone(M.homeModel(DATA));
  assert.deepEqual(m.cards.map((c) => c.place), ['kickstart', 'journey', 'teams', 'aynic', 'coaching', 'build']);
  const by = Object.fromEntries(m.cards.map((c) => [c.place, c]));
  assert.equal(by.journey.line, 'Your own system: Input, Control, Output, Refine.');
  assert.equal(by.journey.count, '14 of 39 done', 'the four journey courses summed, required lessons only');
  assert.ok(Math.abs(by.journey.frac - 14 / 39) < 1e-9);
  assert.equal(by.teams.count, '3 of 20 done', 'ICOR Teams, not the old project course');
  assert.equal(by.build.count, '2 of 4 built', 'the Build path only: moved lessons and the next journey do not count');
  assert.equal(by.build.tag, 'Optional');
  assert.equal(by.coaching.tag, 'Inner Circle');
  assert.equal(by.aynic.tag, 'Soon');
  assert.equal(by.aynic.text, 'AI');
  assert.equal(by.aynic.frac, null, 'no ICOR AI progress over MCP: a note, never a figure');
  assert.equal(by.aynic.note, 'Opening soon: 49 lessons in seven modules');
  assert.equal(by.kickstart.frac, null);
  assert.equal(by.kickstart.note, 'Your steps are on app.myicor.com');
  assert.equal(by.coaching.note, 'The next sessions and every recording are on app.myicor.com');
  assert.deepEqual(m.cards.map((c) => c.url), ['/kickstart', '/journey', '/teams', '/icorai', '/coaching', '/build'].map((p) => 'https://app.myicor.com' + p));
  assert.deepEqual(m.elsewhere.map((e) => e.url), ['/inbox', '/events', '/polls'].map((p) => 'https://app.myicor.com' + p));
});

test('the model: fallbacks are the server\'s own numbers, and missing data stays a note', () => {
  const M = load();
  const noCourses = clone(M.homeModel({ courses: { courses: [] }, journey: { journey_complete_percent: 31.4 } }));
  const j = noCourses.cards.find((c) => c.place === 'journey');
  assert.equal(j.count, '31% of the journey');
  assert.ok(Math.abs(j.frac - 0.314) < 1e-9);
  const teamsOld = clone(M.homeModel({ courses: { courses: [course('project-management', 'PM', 1, 6)] } }));
  assert.equal(teamsOld.cards.find((c) => c.place === 'teams').count, '1 of 6 done', 'before icor-teams exists, the old team course');
  const bare = clone(M.homeModel({}));
  for (const c of bare.cards) assert.ok(c.frac === null && c.note, c.place + ' says where its progress is instead');
  assert.deepEqual(bare.newest, []);
  assert.equal(bare.next, null);
  assert.equal(M.buildProgress('no lessons here'), null);
  assert.equal(M.courseSlugOf({ url: 'https://app.myicor.com/courses/pkm?x=1' }), 'pkm');
});

test('the newest by Tom and Paco: one video, one article, one podcast, newest first, members left out', () => {
  const M = load();
  const n = clone(M.newestFromUs(RESOURCES.resources));
  assert.deepEqual(n.map((r) => r.title), ['The newest video', 'Paco on PKM', 'Episode 120']);
  assert.equal(M.byUs({ author: null }), true, 'no author reads as Tom and Paco, as in the app');
  assert.equal(M.byUs({ author: 'Some Member' }), false);
});

test('the course to pick up: the first unfinished journey course, Input to Refine, then ICOR Teams', () => {
  const M = load();
  assert.equal(M.nextCourse(COURSES.courses).name, 'PKM Like a Pro');
  const done = COURSES.courses.map((c) => (M.JOURNEY_SLUGS.includes(M.courseSlugOf(c)) ? { ...c, progress_percent: 100 } : c));
  assert.equal(M.nextCourse(done).name, 'ICOR Teams');
  assert.equal(M.nextCourse([]), null);
});

/* ---------------------------------------------------------- 2. THE PAGE -- */

function view(M, { lessons, wired = true, sync } = {}) {
  const calls = [];
  const plugin = {
    data: { reflectionSync: sync || null },
    reflectionsDir: () => '04 Inner World/ICOR Journey Notes',
    isClaudeWired: async () => wired,
    mcpCall: async (name, args) => { calls.push([name, args]); return lessons || { lessons: [] }; },
    isConnected: () => true,
  };
  const v = new M.DashboardView({}, plugin);
  v.root = v.contentEl;
  return { v, plugin, calls };
}
const settle = () => new Promise((r) => setTimeout(r, 0));
const texts = (el) => [el.textContent, ...el.children.flatMap(texts)].filter(Boolean);

test('the page: the head, up next, the newest, six lit place cards with their marks, and the two lists', async () => {
  const opened = [];
  const M = load({ opened });
  const { v, calls } = view(M, { lessons: { lessons: [{ title: 'Done one', completed: true }, { title: 'The Capturing Beast', completed: false, url: 'https://app.myicor.com/lessons/beast' }] } });
  const page = v.root.createDiv({ cls: 'micor-page' });
  const head = v.pageHead(page, 'Friday', 'Find your way back to clear');
  const up = head.createDiv({ cls: 'micor-pagehead-actions' });
  const body = page.createDiv({ cls: 'micor-home' });
  v.renderHomeBody(body, up, DATA);
  await settle(); await settle();

  assert.equal(page.querySelector('.micor-pagehead-title').textContent, 'Find your way back to clear');
  assert.equal(page.querySelector('.micor-eyebrow').textContent, 'Friday');
  const line = up.querySelector('.micor-upnext');
  assert.equal(line.querySelector('.micor-upnext-tag').textContent, 'Up next');
  assert.equal(line.querySelector('.micor-upnext-title').textContent, 'The Capturing Beast', 'the next lesson once get_lessons answered');
  assert.equal(line.querySelector('.micor-upnext-sub').textContent, 'PKM Like a Pro');
  assert.deepEqual(clone(calls), [['get_lessons', { course_id: 'pkm-id' }]]);
  line.click();
  assert.equal(opened.pop(), 'https://app.myicor.com/lessons/beast');

  const heads = body.querySelectorAll('.micor-section-head').map((h) => h.children[0].textContent);
  assert.deepEqual(heads, ['New from Tom and Paco', 'Your progress', 'On app.myicor.com', 'In this vault']);
  assert.equal(body.querySelectorAll('.micor-libcard').length, 3);

  const cards = body.querySelectorAll('.micor-placecard');
  assert.deepEqual(cards.map((c) => c.attrs['data-place']), ['kickstart', 'journey', 'teams', 'aynic', 'coaching', 'build']);
  for (const c of cards) {
    const mark = c.querySelector('.micor-placemark');
    const img = mark.querySelector('img');
    if (c.attrs['data-place'] === 'aynic') {
      assert.equal(mark.textContent, 'ICOR AI', 'ICOR AI has no drawn mark yet: set as text, as in the app');
      assert.equal(img, null);
    } else {
      assert.equal(mark.textContent, 'ICOR', '"ICOR" set in type, the word drawn');
      assert.match(img.attrs.src, /^data:image\/svg\+xml;charset=utf-8,%3Csvg/);
      assert.equal(img.attrs.alt, '');
    }
  }
  const journey = cards[1];
  assert.equal(journey.querySelector('.micor-meter-fill').style['--micor-p'], String(14 / 39));
  assert.equal(journey.querySelector('small').textContent, '14 of 39 done');
  assert.equal(cards[3].querySelector('.micor-meter'), null, 'no meter where there is no number');
  assert.equal(cards[4].querySelector('.micor-chip--place').textContent, 'Inner Circle');
  cards[5].click();
  assert.equal(opened.pop(), 'https://app.myicor.com/build');

  const rows = body.querySelectorAll('.micor-row');
  assert.deepEqual(rows.map((r) => r.querySelector('.micor-row-title').textContent),
    ['Mentions and replies', 'Coming up', 'This week’s poll', 'Reflections', 'Search myICOR', 'Claude in this vault']);
  assert.ok(texts(body).some((t) => /refreshed/.test(t)));
  for (const t of texts(body)) assert.doesNotMatch(t, /[–—]/, 'no dashes of either length: ' + t);
});

test('the page: the reflections sync and the knowledge search stay one click away', async () => {
  const notices = [];
  const M = load({ notices });
  const { v, plugin } = view(M, { wired: false });
  let synced = 0;
  plugin.syncReflections = async (progress) => { progress(1, 2); synced += 1; plugin.data.reflectionSync = { totalLocal: 7, lastSyncAt: Date.UTC(2026, 10, 20) }; return { lastCreated: 2 }; };
  const list = v.root.createDiv({ cls: 'micor-list' });
  await v.renderVaultRows(list);
  const [refl, search, claude] = list.querySelectorAll('.micor-row');
  await refl.querySelector('.micor-btn').click();
  await settle();
  assert.equal(synced, 1);
  assert.match(refl.querySelector('.micor-row-sub').textContent, /^7 in 04 Inner World\/ICOR Journey Notes · last sync /);
  assert.equal(notices.pop(), 'myICOR: 2 new reflections synced.');
  let page = null;
  v.setPage = (p) => { page = p; };
  search.click();
  assert.equal(page, 'search');
  assert.equal(claude.querySelector('.micor-btn').textContent, 'Connect', 'Claude not wired: the row offers it');
});

/* --------------------------------------------------------- 3. THE SHELL -- */

test('the shell: data-ink-plugin, one bar with four pages, no masthead or stroke on Home, overview opens Home', async () => {
  const M = load();
  const { v, plugin } = view(M);
  plugin.fetchHomeData = async () => DATA;
  plugin.lastHome = null;
  v.renderHome = () => {};
  await v.onOpen();
  assert.equal(v.root.getAttribute('data-ink-plugin'), '', 'the theme\'s control skins stand down inside');
  assert.ok(v.root.hasClass('micor-dash'));
  const items = v.root.querySelectorAll('.micor-pages-item');
  assert.deepEqual(items.map((i) => i.querySelector('.micor-pages-label').textContent), ['Home', 'Search', 'Library', 'Announcements']);
  assert.ok(items[0].hasClass('is-active'));
  assert.equal(items[0].getAttribute('aria-current'), 'page');
  assert.equal(v.root.querySelector('.micor-masthead'), null);
  assert.equal(v.root.querySelector('.micor-masthead-stroke'), null);
  assert.equal(v.root.querySelectorAll('.micor-iconbtn').length, 3);
  v.setPage('overview');
  assert.equal(v.page, 'home', 'the old Your Loop page key opens Home');
  v.setPage('nonsense');
  assert.equal(v.page, 'home');
  assert.equal(M.pageFor('latest').label, 'Library');
  assert.equal(M.pageFor('trends').key, 'home', 'trend reports left Connect: the old key opens Home');
  assert.doesNotMatch(source, /trend|get_trend_reports/i, 'no trend reports anywhere in the plugin');
});

/* ---------------------------------------------------------- 4. THE DATA -- */

test('the data: one parallel round; the courses are required, the rest optional; the Build outline is text', async () => {
  const M = load();
  const answers = {
    get_courses: COURSES, get_my_journey: { journey_complete_percent: 1 },
    get_latest_resources: RESOURCES,
  };
  const p = Object.create(M.prototype);
  const seen = [];
  p.mcpRaw = async (name, args) => {
    seen.push([name, args]);
    if (name === 'get_aynic_course') return { text: OUTLINE, isError: false };
    if (name === 'get_latest_resources' && p.failLatest) throw new Error('not for this member');
    if (!(name in answers)) throw new Error('unknown tool');
    return { text: JSON.stringify(answers[name]), isError: false };
  };
  const d = await p.fetchHomeData();
  assert.deepEqual(clone(seen.map((s) => s[0])).sort(), ['get_aynic_course', 'get_courses', 'get_latest_resources', 'get_my_journey']);
  assert.deepEqual(clone(seen.find((s) => s[0] === 'get_latest_resources')[1]), { limit: 30 });
  assert.equal(d.buildOutline, OUTLINE);
  assert.equal(d.courses.courses.length, 7);
  p.failLatest = true;
  const d2 = await p.fetchHomeData();
  assert.equal(d2.latest, null, 'one optional piece failing costs that piece only');
  answers.get_courses = undefined;
  delete answers.get_courses;
  await assert.rejects(() => p.fetchHomeData(), /unknown tool/, 'without the courses there is no Home, and the error says so');
  await assert.rejects(() => (async () => { p.mcpRaw = async () => ({ text: 'Your plan: upgrade', isError: true }); return p.mcpText('get_aynic_course'); })(), /Your plan/);
});

/* ---------------------------------------------------------- 5. THE LOOK -- */

test('the look: every place has its light, no aura over the view, the marker on no place card', () => {
  for (const place of ['kickstart', 'journey', 'teams', 'aynic', 'coaching', 'build']) {
    assert.match(css, new RegExp('\\.micor-placecard\\[data-place="' + place + '"\\] \\{ --micor-glow: '), place);
  }
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ''), /aura/i, 'no aura rule anywhere');
  const placeRules = css.match(/\.micor-placecard[^{]*\{[^}]*\}/g) || [];
  assert.ok(placeRules.length > 5);
  for (const r of placeRules.filter((x) => !/:focus-visible/.test(x))) {
    assert.doesNotMatch(r, /--micor-marker(?!:)/, 'the marker belongs to an action, never to a place (the keyboard focus ring aside): ' + r.slice(0, 60));
  }
  assert.match(css, /\.micor-placecard \{[\s\S]*?var\(--micor-cover-ink\)/, 'a place card is ink in both themes');
  assert.equal(Object.keys(load().PLACE_MARK_SVG).sort().join(), 'build,coaching,journey,kickstart,teams');
  assert.doesNotMatch(source, /micor-masthead-stroke[\s\S]{0,200}renderHome/, 'no drawn stroke on the Home');
});
