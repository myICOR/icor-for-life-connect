/*
 * ICOR for Life - Connect: the Obsidian plugin for the ICOR for Life Scaffold.
 *
 * What it does:
 *   1. Adds a myICOR button at the bottom of the folder tree (file explorer).
 *   2. The button opens an INKLINE-styled dashboard view.
 *   3. The dashboard talks to the official myICOR MCP server at
 *      https://app.myicor.com/api/mcp using OAuth 2.1 + PKCE. If the vault is
 *      not yet connected, the plugin opens the browser for login/consent and
 *      receives the callback on a temporary local loopback server.
 *   4. On successful connect it also registers the myICOR MCP server in the
 *      vault-root .mcp.json, so Claude sessions running inside this scaffold
 *      gain myICOR context (search, lessons, resources) via the same server.
 *
 * Security invariants (scaffold hard rule 9):
 *   - Tokens live ONLY in this plugin's data.json, which the plugin forces
 *     into .gitignore before ever saving a token.
 *   - .mcp.json receives the server URL only — never a token. Claude runs its
 *     own OAuth for that connection.
 *   - No secret is ever written into notes, session logs, or console output.
 */

'use strict';

const { Plugin, ItemView, Notice, requestUrl, setIcon } = require('obsidian');

const BASE_URL = 'https://app.myicor.com';
const MCP_URL = BASE_URL + '/api/mcp';
const AUTHORIZE_URL = BASE_URL + '/mcp/authorize';
const TOKEN_URL = BASE_URL + '/api/oauth/token';
const REGISTER_URL = BASE_URL + '/api/oauth/register';
const OAUTH_SCOPE = 'mcp:read mcp:tools mcp:progress mcp:inner-circle';
const VIEW_TYPE = 'myicor-dashboard';
const AUTH_TIMEOUT_MS = 5 * 60 * 1000;
/* Where synced reflections land. The room part is resolved at write time from
 * room 04's real folder (see `reflectionsDir`), because this is a path the
 * plugin CREATES: against a renamed room a literal would not fail, it would
 * quietly build a second Inner World beside the real one. */
const REFLECTIONS_ROOM = '04';
const REFLECTIONS_SUBDIR = 'ICOR Journey Notes';

/* The myICOR infinity mark (from 06 AI Team/AI Team Knowledge/Brand/). */
const MARK_SVG =
  '<svg viewBox="0 0 240 110" fill="none" xmlns="http://www.w3.org/2000/svg">' +
  '<path d="M50 55 C50 18 92 18 120 55 C148 92 190 92 190 55 C190 18 148 18 120 55 C92 92 50 92 50 55 Z" ' +
  'stroke="currentColor" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>';

/* The nav pages. 'latest' and 'announcements' call server tools that ship
 * in a later myICOR MCP wave; until then those pages render a pending state
 * and light up automatically once the server knows the tool. */
const PAGES = [
  { key: 'overview', icon: 'map', label: 'Your Loop', tab: 'OVERVIEW', title: 'ICOR Journey.', hand: 'the journey, drawn as one line', kicker: 'MYICOR · CONNECTED' },
  { key: 'search', icon: 'search', label: 'Search', tab: 'SEARCH', title: 'Search.', hand: 'lessons, resources, answers', kicker: 'MYICOR · EVERYTHING' },
  { key: 'trends', icon: 'trending-up', label: 'Trend Reports', tab: 'TRENDS', title: 'The Radar.', hand: "what's moving this week", kicker: 'MYICOR · TREND REPORTS' },
  { key: 'latest', icon: 'newspaper', label: 'Latest Releases', tab: 'LATEST', title: 'Fresh Ink.', hand: 'new on the shelf', kicker: 'MYICOR · LATEST RELEASES' },
  { key: 'announcements', icon: 'megaphone', label: 'Announcements', tab: 'ANNOUNCEMENTS', title: 'The Board.', hand: 'from the team', kicker: 'MYICOR · ANNOUNCEMENTS' },
];

/* THE drawn marker stroke, the one hand-drawn mark a view is allowed: inline
 * SVG so currentColor keeps it tokenized. Exactly one per view. */
function strokeEl(parent, cls) {
  const el = parent.createDiv({ cls });
  el.innerHTML = '<svg viewBox="0 0 170 9" aria-hidden="true"><path d="M2 6.5 C 40 2.5, 92 2, 128 4.5 C 146 5.8, 160 5.2, 168 4"/></svg>';
  return el;
}

/* "09 AUG 2026" — the Shelf's kicker date voice. */
function kickerDate(v) {
  try {
    return new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();
  } catch (e) {
    return '';
  }
}

const JOURNEY_STAGES = [
  { key: 'getting_started', label: 'Getting Started' },
  { key: 'level_1', label: 'Level 1' },
  { key: 'level_2', label: 'Level 2' },
  { key: 'level_3', label: 'Level 3' },
  { key: 'level_4', label: 'Level 4' },
  { key: 'level_5', label: 'Level 5' },
  { key: 'icor_master', label: 'ICOR Master' },
];

/* The six rooms and their dashboards. */
const ROOM_VIEW_TYPE = 'micor-room-dash';
/* A ROOM IS ITS NUMBER. THE WORDS AFTER IT ARE A LABEL.
 *
 * `path` used to be the contract. When `01 INBOX` was renamed `01 Inbox` to
 * match its title-case siblings, the literal here stopped matching in silence:
 * a `data-path` selector that finds nothing throws nothing, so the Inbox simply
 * lost its dashboard button and onboarding pointed at a folder that did not
 * exist. Correcting the literal would leave the same trap armed for the next
 * rename, and there will be one. The same two-character edit cost 27 files and
 * 21 CSS selectors elsewhere.
 *
 * `room` is the identity and it did not move: it is the sort key, and this
 * table's own copy already says so ("ROOM 01 - INBOX"). `path` is now a
 * DECLARATION of the shipped default, resolved against the vault's real folder
 * at load by `resolveRooms()`, so a room may be called anything its owner likes
 * - renamed, translated - and everything downstream keeps working. */
const ROOMS = [
  { room: '00', path: '00 Daily Scratchpad', key: 'scratchpad', title: 'The Scratchpad.', hand: 'raw thought, stamped later', kicker: 'ROOM 00 · DAILY SCRATCHPAD' },
  { room: '01', path: '01 Inbox', key: 'inbox', title: 'The Inbox.', hand: 'it empties, always', kicker: 'ROOM 01 · INBOX' },
  { room: '03', path: '03 WiP', key: 'wip', title: 'The Bench.', hand: 'work in progress', kicker: 'ROOM 03 · WIP' },
  { room: '04', path: '04 Inner World', key: 'inner', title: 'The Inner World.', hand: 'what you know and live', kicker: 'ROOM 04 · INNER WORLD' },
  { room: '05', path: '05 Assets', key: 'assets', title: 'The Shelves.', hand: 'files your notes lean on', kicker: 'ROOM 05 · ASSETS' },
  { room: '06', path: '06 AI Team', key: 'team', title: 'The Team.', hand: 'who did what, and how', kicker: 'ROOM 06 · AI TEAM' },
];

/* The leading room number of a folder name, or null when it carries none. */
function roomNumberOf(name) {
  const m = /^(\d{2})/.exec(String(name));
  return m ? m[1] : null;
}

/** The vault's own name for a room, by number. Null when the vault has no such room. */
function findRoomFolder(vault, number) {
  const root = vault && vault.getRoot ? vault.getRoot() : null;
  const children = (root && root.children) || [];
  for (const child of children) {
    if (child.children === undefined) continue;
    if (roomNumberOf(child.name) === number) return child.name;
  }
  return null;
}

/** The room a vault path sits in, by number. */
function roomOfPath(path) {
  const head = String(path).split('/')[0];
  return roomNumberOf(head);
}

/** The room a stored path names, matched by its number rather than its words. */
function roomFor(path) {
  if (!path) return null;
  const exact = ROOMS.find((r) => r.path === path);
  if (exact) return exact;
  const number = roomOfPath(path);
  return number ? ROOMS.find((r) => r.room === number) || null : null;
}

/* The Loop gauge geometry — verbatim from the app's Your Loop page. */
const LOOP_ARCS = [
  'M230 30 C 322 26 421 63 424 118',
  'M424 118 C 427 173 331 213 231 215',
  'M231 215 C 133 217 37 176 35 120',
  'M35 120 C 33 65 139 33 230 30',
];
const LOOP_STATIONS = [
  { x: 230, y: 30, lx: 230, ly: 12, anchor: 'middle', label: 'INPUT' },
  { x: 424, y: 118, lx: 448, ly: 122, anchor: 'start', label: 'CONTROL' },
  { x: 231, y: 215, lx: 231, ly: 242, anchor: 'middle', label: 'OUTPUT' },
  { x: 35, y: 120, lx: 12, ly: 124, anchor: 'end', label: 'REFINE' },
];
const LOOP_CX = 230, LOOP_CY = 122;
/* stage captions (G8: plugin copy until the server ships journey_level) */
const STAGE_CAPTIONS = {
  getting_started: 'The pen is in your hand.',
  level_1: 'The first station is behind you.',
  level_2: 'Station by station, the line grows.',
  level_3: 'Past the halfway bend.',
  level_4: 'The loop is taking shape.',
  level_5: 'One station from a closed loop.',
  icor_master: 'The loop closes, and keeps turning.',
};

/* ------------------------------------------------------------------------- *
 * PKCE helpers (Node crypto — desktop only, declared in manifest)
 * ------------------------------------------------------------------------- */

function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/* The OAuth consent MUST open in the system browser, never in Obsidian's
 * in-app Web Viewer: Turnstile and the user's existing login session live in
 * the real browser. shell.openExternal bypasses the Web Viewer intercept. */
function openInSystemBrowser(url) {
  /* macOS first tier: the system `open` command via LaunchServices. Electron's
   * shell.openExternal is flaky here — it can foreground the browser without
   * handing over the URL. `open <url>` always delivers. */
  if (typeof process !== 'undefined' && process.platform === 'darwin') {
    try {
      require('child_process').execFile('/usr/bin/open', [url]);
      return true;
    } catch (e) { /* fall through to Electron shell */ }
  }
  try {
    const electron = require('electron');
    const shell = electron.shell || (electron.remote && electron.remote.shell);
    if (shell && shell.openExternal) {
      const r = shell.openExternal(url);
      if (r && r.catch) r.catch(() => { try { window.open(url); } catch (e) { /* fallback below */ } });
      return true;
    }
  } catch (e) { /* fall through to window.open */ }
  try {
    return !!window.open(url);
  } catch (e) {
    return false;
  }
}

function makePkce() {
  const crypto = require('crypto');
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));
  return { verifier, challenge, state };
}

/* Minimal HTML shown in the browser tab after the OAuth redirect lands. */
function callbackHtml(ok, detail) {
  const title = ok ? 'Connected' : 'Not connected';
  const msg = ok
    ? 'Your vault is now connected to myICOR. You can close this tab and return to Obsidian.'
    : 'The connection was not completed' + (detail ? ' (' + detail + ')' : '') + '. You can close this tab and try again from Obsidian.';
  return '<!doctype html><html><head><meta charset="utf-8"><title>myICOR — ' + title + '</title>' +
    '<style>body{margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;' +
    'background:#0c0e12;color:#f6f3ec;font:16px/1.6 -apple-system,BlinkMacSystemFont,system-ui,sans-serif}' +
    '.card{max-width:26rem;padding:2.5rem;text-align:center}' +
    'svg{width:96px;color:' + (ok ? '#ff5a2d' : '#8e897d') + '}' +
    'h1{font-size:1.4rem;margin:.75rem 0 .5rem}p{color:#c9c4b8;margin:0}</style></head>' +
    '<body><div class="card">' + MARK_SVG + '<h1>' + title + '</h1><p>' + msg + '</p></div></body></html>';
}

/* ------------------------------------------------------------------------- *
 * Plugin
 * ------------------------------------------------------------------------- */

class MyicorConnectPlugin extends Plugin {
  async onload() {
    this.instanceId = Math.floor(performance.now());
    this.data = Object.assign({ clientId: null, tokens: null }, (await this.loadData()) || {});
    this.authInFlight = null;

    /* Never let the token store reach git — enforced before any token exists. */
    await this.ensureGitignore();

    this.registerView(VIEW_TYPE, (leaf) => new DashboardView(leaf, this));
    this.registerView(ROOM_VIEW_TYPE, (leaf) => new RoomDashboardView(leaf, this));

    /* The thin ribbon is hidden by the scaffold's own snippet, so this
     * plugin registers NO ribbon action: an icon on a hidden surface is
     * not an entry point. Its routes are the top row (gear + terminal,
     * attachTopButtons), the folder-tree footer button, and this command.
     * The four vault actions below are palette commands for the same
     * reason - see the block after this one. */
    this.addCommand({
      id: 'open-dashboard',
      name: 'Open myICOR dashboard',
      callback: () => this.activateDashboard(),
    });

    /* THE FOUR VAULT ACTIONS THAT USED TO BE TOOLBAR BUTTONS.
     *
     * They were injected into the file explorer's tool-button row while the
     * left ribbon was hidden and that row was where homeless controls went.
     * The row is now reduced to actions that are actually ON the file tree,
     * and none of these four is one: they create notes and canvases and open
     * the graph, which are actions on the VAULT.
     *
     * They become commands rather than rail stops, because the rail is for
     * plugin entry points and these are not entry points into anything. A
     * command is the discoverable home for a vault action anyway, and it is
     * hotkey-bindable for free.
     *
     * All four, and the evenness is the ruling rather than an oversight.
     * Three of them delegate to core plugins that carry their own palette
     * entries, so a wrapper looks redundant - until the core plugin is
     * DISABLED, at which point its command does not exist and the function
     * has no route and no explanation. These wrappers survive that and say
     * which plugin to turn on. Registering three of four would leave the
     * fourth as the odd one out, which is a shape nobody would choose.
     *
     * All four are ALSO toolbar buttons again, by explicit request:
     * `attachToolbarButtons` reinstates them as a second route. Each
     * button drives its command by id, so there is one implementation
     * with two surfaces and no way for them to disagree. */
    const runCore = (id, missing) => {
      if (!this.app.commands.executeCommandById(id)) new Notice('myICOR: ' + missing);
    };
    this.addCommand({
      id: 'new-unique-note',
      /* Named for what it DOES. The retired button said "New note in the
         Daily Scratchpad" while running the core Unique note creator, which
         files wherever that plugin is configured and not necessarily there.
         A label that promises a location the code does not choose is worse
         than a plain one. */
      name: 'New unique note',
      callback: () => runCore('zk-prefixer', 'enable the Unique note creator core plugin to use this.'),
    });
    this.addCommand({
      id: 'open-daily-note',
      name: "Open today's daily note",
      callback: () => runCore('daily-notes', 'enable the Daily notes core plugin to use this.'),
    });
    this.addCommand({
      id: 'open-graph-view',
      name: 'Open graph view',
      callback: () => runCore('graph:open', 'enable the Graph view core plugin to use this.'),
    });
    /* The only one of the four with logic of its own, and the only one that
       had no other route at all before this. Canvases land beside the notes
       they sketch: 00 Daily Scratchpad, named YYYY-MM-DD_canvas, with -N on
       collisions. */
    this.addCommand({
      id: 'new-scratchpad-canvas',
      name: 'New canvas in the Daily Scratchpad',
      callback: async () => {
        const d = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const base = '00 Daily Scratchpad/' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '_canvas';
        let path = base + '.canvas';
        let i = 1;
        while (this.app.vault.getAbstractFileByPath(path)) path = base + '-' + i++ + '.canvas';
        try {
          const file = await this.app.vault.create(path, '{"nodes":[],"edges":[]}');
          await this.app.workspace.getLeaf(true).openFile(file);
        } catch (e) {
          new Notice('myICOR: could not create the canvas: ' + e.message);
        }
      },
    });
    /* The conditional control's discovery route. `checkCallback` rather than
     * `callback`, so the command is absent from the palette in exactly the
     * state the button is absent from the slot: one condition, two surfaces,
     * and no way for them to disagree. */
    this.addCommand({
      id: 'collapse-all-folders',
      name: 'Collapse all folders',
      checkCallback: (checking) => {
        const btn = this.collapseAllButton();
        if (!btn) return false;
        if (!checking) btn.click();
        return true;
      },
    });
    this.addCommand({
      id: 'connect',
      name: 'Connect to myICOR',
      callback: () => this.connect().catch((e) => new Notice('myICOR: ' + e.message)),
    });
    this.addCommand({
      id: 'sync-reflections',
      name: 'Sync myICOR reflections into Inner World',
      callback: async () => {
        try {
          const r = await this.syncReflections();
          new Notice('myICOR: ' + r.lastCreated + ' new reflection' + (r.lastCreated === 1 ? '' : 's') + ' synced.');
        } catch (e) {
          new Notice('myICOR: sync failed: ' + e.message);
        }
      },
    });

    /* Folder-tree button: attach once the layout exists, re-attach whenever
     * the file explorer leaf is rebuilt. */
    this.app.workspace.onLayoutReady(() => {
      this.resolveRooms();
      this.sweepRetiredRail();
      this.attachExplorerButton();
      this.attachRoomButtons();
      this.syncCollapseSlot();
      /* the explorer re-renders folder rows on collapse/expand and vault
       * changes; keep the room buttons present without leaking observers */
      const explorer = document.querySelector('.workspace-leaf-content[data-type="file-explorer"]');
      if (explorer && !this.roomObserver) {
        this.roomObserver = new MutationObserver(() => {
          /* The slot is synced UNDEBOUNCED and the room buttons are not.
             Collapsing a room is a direct result of a click, so a quarter
             second of lag between the click and the control reacting reads as
             the control being broken. Re-attaching room buttons is repair work
             nobody is watching, so it keeps its debounce. */
          this.syncCollapseSlot();
          window.clearTimeout(this.roomObserverTimer);
          this.roomObserverTimer = window.setTimeout(() => this.attachRoomButtons(), 250);
        });
        this.roomObserver.observe(explorer, { childList: true, subtree: true });
      }
    });
    this.registerEvent(this.app.workspace.on('layout-change', () => {
      this.attachExplorerButton();
      this.syncCollapseSlot();
    }));
  }

  onunload() {
    if (this.explorerButtonEl) this.explorerButtonEl.remove();
    if (this.roomObserver) this.roomObserver.disconnect();
    /* The slot classes are ours and the container is Obsidian's, so they come
       off on the way out. Left behind they would outlive the CSS that reads
       them and hide a control the host still owns. */
    for (const row of document.querySelectorAll('.micor-tree-slot')) {
      row.classList.remove('micor-tree-slot', 'micor-can-collapse');
    }
    /* Every class here but the last is LIVE - room buttons, top buttons,
       and the four vault-action buttons back on the explorer toolbar - and
       their nodes come off on the way out like anything else this plugin
       owns. Only `.micor-toolbar-extra` is RETIRED: it was the shared class
       of the old canvas and graph buttons, which came back under their own
       classes, so nothing creates it any more. Its sweep outlives the code
       that made it on purpose, because an in-place upgrade from a build
       that still injected it leaves the nodes behind with nothing left to
       take them out. */
    for (const el of document.querySelectorAll('.micor-room-btn, .micor-top-btn, .micor-unique-note, .micor-daily-note, .micor-new-canvas, .micor-graph-view, .micor-toolbar-extra')) el.remove();
    this.sweepRetiredRail();
    this.closeAuthServer();
  }

  /* THE RETIRED LEFT-RAIL NODES.
   *
   * The rail grouped Obsidian's ribbon actions into two containers behind a
   * fold. It is gone: the ribbon is hidden again and every entry point it
   * carried is back on a surface the user can see. Nothing in this build
   * creates these nodes, and an in-place upgrade from the rail build is the
   * only way they can exist - which is exactly why the sweep has to outlive
   * the code that made them, and why it runs at LOAD as well as at unload.
   * At unload alone it would only ever clean up after itself.
   *
   * The order is the whole rule. `.micor-rail-behind` holds OBSIDIAN'S OWN
   * ribbon actions, so its children go back into the host's container BEFORE
   * the container is removed. This sweep may never be the reason another
   * plugin's icon is missing. */
  sweepRetiredRail() {
    for (const behind of document.querySelectorAll('.micor-rail-behind')) {
      const host = behind.parentElement;
      if (!host) continue;
      for (const el of Array.from(behind.children)) host.appendChild(el);
    }
    for (const el of document.querySelectorAll('.micor-rail-fold, .micor-rail-behind, .micor-rail-vault, .micor-rail-mark')) el.remove();
    /* The body class, not the dashboard's own `.micor-rail` path element:
       only the rail build ever put this on <body>. */
    document.body.classList.remove('micor-rail');
  }

  async saveSettings() {
    await this.saveData(this.data);
  }

  /* ---------------------------------------------------------------- views */

  async activateDashboard(page) {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE);
    let leaf;
    if (existing.length > 0) {
      leaf = existing[0];
    } else {
      leaf = this.app.workspace.getLeaf(true);
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    this.app.workspace.revealLeaf(leaf);
    if (page && leaf.view && leaf.view.setPage) leaf.view.setPage(page);
  }

  /* ------------------------------------------------- folder tree button -- */

  /* ---------------------------------------------------------------- *
   * THE FILE-TREE HEADER SLOT
   *
   * The toolbar row under the banner is reduced to the controls that are
   * actually file-tree actions. Two survive: "change sort order", which is
   * permanent because Obsidian registers no command for it and that button is
   * its ONLY route (measured against the app bundle: eight file-explorer
   * command ids, none of them sort), and "collapse all", which is made
   * CONDITIONAL because it is only ever worth a click when more than one room
   * is open.
   *
   * The slot is Obsidian's own `.nav-buttons-container`. We do not build one
   * beside it: the collapse-all button is already the right glyph with the
   * right accessible name and a working handler, so making it conditional is a
   * class toggle rather than a reimplementation.
   *
   * THE CLASS GOES ON THE CONTAINER, NEVER ON THE BUTTON. Obsidian re-creates
   * those buttons on its own schedule, so a class on the button is lost on the
   * next re-render and has to be chased; a class on the container is inherited
   * by whatever the host puts inside it.
   * ---------------------------------------------------------------- */

  /* How many TOP-LEVEL rooms are open.
   *
   * Top-level only, and depth is never counted. The condition has to have the
   * same shape as the effect: collapse-all collapses to the roots, so a count
   * taken at any other depth produces a control that can be offered when its
   * click would do nothing, or withheld when its click would do a lot. It also
   * means drilling in and out inside one room never crosses the threshold, so
   * the control does not twitch while somebody is working. */
  unfoldedRootCount() {
    const container = document.querySelector('.nav-files-container');
    if (!container) return 0;
    const rootChildren =
      container.querySelector('.nav-folder.mod-root > .nav-folder-children')
      || container.querySelector(':scope > .nav-folder-children');
    if (!rootChildren) return 0;
    let open = 0;
    for (const child of rootChildren.children) {
      if (!child.classList.contains('nav-folder')) continue;
      if (!child.classList.contains('is-collapsed')) open += 1;
    }
    return open;
  }

  /* Threshold is 2. One open room is collapsed with one click on the room
   * itself, and a second control for that is a marking on a one. */
  syncCollapseSlot() {
    const row = document.querySelector(
      '.workspace-leaf-content[data-type="file-explorer"] .nav-buttons-container');
    if (!row) return;
    row.classList.add('micor-tree-slot');
    row.classList.toggle('micor-can-collapse', this.unfoldedRootCount() >= 2);
  }

  /* The discovery affordance, and it is a command rather than a tooltip.
   * A first-run hint would fire in the instant the user just opened a second
   * room, which is the instant they are doing something else. The command
   * palette is where an Obsidian user looks for a function they suspect
   * exists, and it makes the function hotkey-bindable for free.
   *
   * It drives Obsidian's OWN button rather than reimplementing the collapse:
   * one implementation, and the glyph the command names is the glyph that
   * moves. `chevrons-down-up` is the collapse direction; when the tree is
   * already collapsed the host swaps in `chevrons-up-down` and the command
   * correctly reports that it has nothing to do. */
  collapseAllButton() {
    const row = document.querySelector(
      '.workspace-leaf-content[data-type="file-explorer"] .nav-buttons-container');
    if (!row) return null;
    for (const btn of row.querySelectorAll('.clickable-icon')) {
      if (btn.querySelector('svg.lucide-chevrons-down-up')) return btn;
    }
    return null;
  }

  attachExplorerButton() {
    const explorer = document.querySelector('.workspace-leaf-content[data-type="file-explorer"]');
    if (!explorer) return;

    /* Rebuild instead of early-return: a footer left behind by an earlier
     * plugin instance would keep its OLD click handler forever. */
    const stale = explorer.querySelector('.micor-explorer-footer');
    const wasOpen = stale ? stale.classList.contains('is-open') : false;
    if (stale) {
      if (stale.dataset.micorVersion === this.manifest.version && stale.dataset.micorInstance === String(this.instanceId)) return;
      stale.remove();
    }

    const footer = explorer.createDiv({ cls: 'micor-explorer-footer' });
    footer.dataset.micorVersion = this.manifest.version;
    footer.dataset.micorInstance = String(this.instanceId);
    if (wasOpen) footer.classList.add('is-open');

    /* The nav sits ABOVE the button and unfolds upward when connected. */
    const nav = footer.createDiv({ cls: 'micor-nav' });
    const navInner = nav.createDiv({ cls: 'micor-nav-inner' });
    for (const page of PAGES) {
      const item = navInner.createDiv({ cls: 'micor-nav-item' });
      setIcon(item.createDiv({ cls: 'micor-nav-icon' }), page.icon);
      item.createSpan({ text: page.label });
      item.addEventListener('click', () => {
        footer.classList.remove('is-open');
        this.activateDashboard(page.key);
      });
    }

    const btn = footer.createDiv({ cls: 'micor-explorer-button' });
    const mark = btn.createDiv({ cls: 'micor-explorer-mark' });
    mark.innerHTML = MARK_SVG;
    btn.createSpan({ cls: 'micor-explorer-label', text: 'myICOR' });
    const chevron = btn.createDiv({ cls: 'micor-explorer-chevron' });
    setIcon(chevron, 'chevron-up');
    const status = btn.createDiv({ cls: 'micor-explorer-dot' });
    if (this.isConnected()) status.addClass('is-connected');
    btn.setAttribute('aria-label', 'myICOR');
    btn.addEventListener('click', () => {
      /* Not connected: straight to the connect screen. Connected: the
       * button is the fold/unfold toggle for the nav. */
      if (!this.isConnected()) {
        this.activateDashboard();
        return;
      }
      const open = footer.classList.toggle('is-open');
      btn.setAttribute('aria-expanded', String(open));
    });

    this.explorerButtonEl = footer;
  }

  /* The explorer toolbar's four vault-action buttons: today's daily note,
   * the unique-note creator, a new scratchpad canvas, and the graph view,
   * in that order at the start of the row, ahead of the host's file-tree
   * survivors. Reinstated by explicit request after a round as palette-only
   * commands. The commands STAY: each button drives its command by id, so
   * there is one implementation with two surfaces, and the command's own
   * Notice still names the core plugin to enable when that plugin is off.
   *
   * The canvas and graph buttons carry their own classes now. The old
   * build gave both one shared class, and that class stays on the RETIRED
   * sweep list below to clean up in-place upgrades from that build; a
   * class cannot be both swept as retired and created as live, so the
   * revived pair could not inherit it.
   *
   * This runs from the attach pass the explorer observer re-triggers, so
   * the guard below is load-bearing: when the buttons are already present
   * it must return WITHOUT touching the DOM. A callback that mutates
   * unconditionally under a MutationObserver feeds itself; that runaway has
   * blanked this window once already. */
  attachToolbarButtons() {
    const bar = document.querySelector('.workspace-leaf-content[data-type="file-explorer"] .nav-buttons-container');
    if (!bar || bar.querySelector('.micor-unique-note')) return;

    const runOwn = (suffix) => this.app.commands.executeCommandById(this.manifest.id + ':' + suffix);

    const unique = createDiv({ cls: 'clickable-icon nav-action-button micor-unique-note', attr: { 'aria-label': 'New unique note' } });
    setIcon(unique, 'file-clock');
    unique.addEventListener('click', () => runOwn('new-unique-note'));

    const daily = createDiv({ cls: 'clickable-icon nav-action-button micor-daily-note', attr: { 'aria-label': "Open today's daily note" } });
    setIcon(daily, 'calendar-check');
    daily.addEventListener('click', () => runOwn('open-daily-note'));

    const canvas = createDiv({ cls: 'clickable-icon nav-action-button micor-new-canvas', attr: { 'aria-label': 'New canvas in the Daily Scratchpad' } });
    setIcon(canvas, 'layout-dashboard');
    canvas.addEventListener('click', () => runOwn('new-scratchpad-canvas'));

    const graph = createDiv({ cls: 'clickable-icon nav-action-button micor-graph-view', attr: { 'aria-label': 'Open graph view' } });
    setIcon(graph, 'git-fork');
    graph.addEventListener('click', () => runOwn('open-graph-view'));

    /* Daily leftmost, then unique, canvas, graph: the order the row used
     * to read. The theme assigns flex order only to sort and collapse and
     * leaves zero for the rest, so plain insertion at the front is
     * placement enough. */
    bar.insertBefore(graph, bar.firstChild);
    bar.insertBefore(canvas, graph);
    bar.insertBefore(unique, canvas);
    bar.insertBefore(daily, unique);
  }

  /* Terminal + settings live together in the right sidebar's top row
   * (the left header stays stock - injecting there raced Obsidian's
   * own sidebar toggle and shuffled the order on collapse/reopen). */
  attachTopButtons() {
    const right = document.querySelector('.workspace-split.mod-right-split .workspace-tab-header-container');
    if (!right || right.querySelector('.micor-top-terminal')) return;

    const term = createDiv({ cls: 'clickable-icon micor-top-btn micor-top-terminal', attr: { 'aria-label': 'Open terminal' } });
    setIcon(term, 'terminal');
    term.addEventListener('click', () => {
      const ran = this.app.commands.executeCommandById('terminal:open-terminal.integrated.root');
      if (!ran) new Notice('myICOR: enable the Terminal plugin to use this button.');
    });

    const gear = createDiv({ cls: 'clickable-icon micor-top-btn micor-top-settings', attr: { 'aria-label': 'Settings' } });
    setIcon(gear, 'settings');
    gear.addEventListener('click', () => this.app.setting.open());

    right.appendChild(term);
    right.appendChild(gear);
  }

  /* Bind every room to the folder the vault ACTUALLY has for its number, and
   * say so out loud when one is missing.
   *
   * The failure this closes is not a crash, it is a shrug: a `data-path`
   * selector that matches nothing throws nothing, so a renamed room lost its
   * dashboard button and its onboarding entry without a single line in the
   * console, and the plugin just quietly did less. A contract keyed on a value
   * somebody else can change has to announce it when it breaks. Said once, at
   * load, and never again. */
  resolveRooms() {
    const missing = [];
    for (const room of ROOMS) {
      const found = findRoomFolder(this.app.vault, room.room);
      if (found) room.path = found;
      else missing.push(room.room);
    }
    /* A vault with no numbered rooms at all is not a scaffold, and telling
     * somebody their plain vault is broken would be the louder wrong answer. */
    if (missing.length === ROOMS.length) return;
    if (missing.length === 0) return;
    const message = 'ICOR for Life - Connect: this vault has no room ' + missing.join(', ')
      + '. Those dashboards and their folder buttons are unavailable until the rooms are there.';
    console.warn(message);
    new Notice(message, 12000);
  }

  /** Where synced reflections land, under room 04's real folder. */
  reflectionsDir() {
    const room = ROOMS.find((r) => r.room === REFLECTIONS_ROOM);
    const base = (room && room.path) || findRoomFolder(this.app.vault, REFLECTIONS_ROOM);
    if (!base) throw new Error('this vault has no room ' + REFLECTIONS_ROOM + ', so there is nowhere to sync reflections into');
    return base + '/' + REFLECTIONS_SUBDIR;
  }

  attachRoomButtons() {
    this.attachToolbarButtons();
    this.attachTopButtons();
    for (const room of ROOMS) {
      const title = document.querySelector('.nav-folder-title[data-path="' + room.path + '"]');
      if (!title || title.querySelector('.micor-room-btn')) continue;
      const btn = title.createDiv({ cls: 'micor-room-btn', attr: { 'aria-label': room.path + ' dashboard' } });
      setIcon(btn, 'gauge');
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        ev.preventDefault();
        this.openRoomDashboard(room.path);
      });
    }
  }

  async openRoomDashboard(roomPath) {
    const existing = this.app.workspace.getLeavesOfType(ROOM_VIEW_TYPE);
    const leaf = existing.length ? existing[0] : this.app.workspace.getLeaf(true);
    await leaf.setViewState({ type: ROOM_VIEW_TYPE, active: true, state: { room: roomPath } });
    this.app.workspace.revealLeaf(leaf);
  }


  refreshExplorerDot() {
    /* Cosmetic only — must never mask a real error on the auth path. */
    try {
      const dot = document.querySelector('.micor-explorer-dot');
      if (dot) dot.toggleClass('is-connected', this.isConnected());
    } catch (e) { /* no DOM (tests) or dot not mounted: nothing to update */ }
  }

  /* ------------------------------------------------------------- oauth --- */

  isConnected() {
    return !!(this.data.tokens && this.data.tokens.refresh_token);
  }

  closeAuthServer() {
    if (this.authServer) {
      try { this.authServer.close(); } catch (e) { /* already closed */ }
      this.authServer = null;
    }
    if (this.authTimer) {
      clearTimeout(this.authTimer);
      this.authTimer = null;
    }
  }

  /* Full connect flow: loopback server -> dynamic registration -> browser
   * consent -> code exchange -> persist tokens -> wire Claude. */
  async connect() {
    if (this.authInFlight) return this.authInFlight;
    this.authInFlight = this.doConnect().finally(() => {
      this.authInFlight = null;
      this.lastAuthUrl = null;
      this.closeAuthServer();
    });
    return this.authInFlight;
  }

  async doConnect() {
    /* The loopback callback server and PKCE need node http/crypto, which the
     * mobile webview does not have. The token itself syncs with the vault
     * (data.json rides iCloud/Obsidian Sync), so one desktop connect covers
     * every device. */
    let http = null;
    try { http = require('http'); require('crypto'); } catch (e) { http = null; }
    if (!http) {
      new Notice('Connecting needs the desktop app once. Connect there and the connection syncs to this device with the vault.', 8000);
      throw new Error('connecting requires the desktop app');
    }
    const pkce = makePkce();

    const codePromise = new Promise((resolve, reject) => {
      this.authServer = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        if (url.pathname !== '/callback') {
          res.writeHead(404).end();
          return;
        }
        const err = url.searchParams.get('error');
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        const ok = !err && code && state === pkce.state;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(callbackHtml(!!ok, err || (state !== pkce.state ? 'state mismatch' : '')));
        if (ok) resolve(code);
        else reject(new Error(err === 'access_denied' ? 'access was denied in the browser' : (err || 'state mismatch')));
      });
      this.authServer.on('error', reject);
      this.authTimer = setTimeout(
        () => reject(new Error('timed out waiting for the browser login (5 minutes)')),
        AUTH_TIMEOUT_MS
      );
    });

    await new Promise((resolve, reject) => {
      this.authServer.listen(0, '127.0.0.1', resolve);
      this.authServer.on('error', reject);
    });
    const port = this.authServer.address().port;
    const redirectUri = 'http://127.0.0.1:' + port + '/callback';

    /* Dynamic client registration (RFC 7591; stateless on the server, PKCE
     * carries the security). Registered fresh per connect so the redirect
     * port always matches. */
    const reg = await requestUrl({
      url: REGISTER_URL,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: 'ICOR for Life Scaffold (Obsidian)',
        redirect_uris: [redirectUri],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      }),
      throw: false,
    });
    if (reg.status !== 201 && reg.status !== 200) {
      throw new Error('client registration failed (HTTP ' + reg.status + ')');
    }
    this.data.clientId = reg.json.client_id;

    const authUrl =
      AUTHORIZE_URL +
      '?client_id=' + encodeURIComponent(this.data.clientId) +
      '&redirect_uri=' + encodeURIComponent(redirectUri) +
      '&response_type=code' +
      '&code_challenge=' + encodeURIComponent(pkce.challenge) +
      '&code_challenge_method=S256' +
      '&scope=' + encodeURIComponent(OAUTH_SCOPE) +
      '&state=' + encodeURIComponent(pkce.state);

    this.lastAuthUrl = authUrl;
    const opened = openInSystemBrowser(authUrl);
    new Notice(
      opened
        ? 'myICOR: finish the login in your browser…'
        : 'myICOR: could not open the browser — use the manual link in the dashboard.',
      8000
    );

    const code = await codePromise;

    const tok = await requestUrl({
      url: TOKEN_URL,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code: code,
        code_verifier: pkce.verifier,
        redirect_uri: redirectUri,
        client_id: this.data.clientId,
      }),
      throw: false,
    });
    if (tok.status !== 200 || !tok.json.access_token) {
      throw new Error('token exchange failed (HTTP ' + tok.status + ')');
    }
    this.storeTokens(tok.json);
    await this.saveSettings();

    /* Give the Claude sessions in this vault the same context. */
    await this.wireClaude();

    this.refreshExplorerDot();
    new Notice('myICOR: connected.');
  }

  storeTokens(body) {
    this.data.tokens = {
      access_token: body.access_token,
      refresh_token: body.refresh_token,
      scope: body.scope || OAUTH_SCOPE,
      /* refresh one minute early so a call never rides an expiring token */
      expires_at: Date.now() + Math.max(60, (body.expires_in || 900) - 60) * 1000,
    };
  }

  async ensureToken() {
    if (!this.data.tokens) throw new Error('not connected');
    if (Date.now() < this.data.tokens.expires_at) return this.data.tokens.access_token;

    const resp = await requestUrl({
      url: TOKEN_URL,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: this.data.tokens.refresh_token,
      }),
      throw: false,
    });
    if (resp.status !== 200 || !resp.json.access_token) {
      /* Refresh token revoked or expired: drop to disconnected cleanly. */
      this.data.tokens = null;
      await this.saveSettings();
      this.refreshExplorerDot();
      throw new Error('session expired — please reconnect');
    }
    this.storeTokens(resp.json); /* rotation: the refresh token is replaced */
    await this.saveSettings();
    return this.data.tokens.access_token;
  }

  async disconnect() {
    this.data.tokens = null;
    await this.saveSettings();
    this.refreshExplorerDot();
    new Notice('myICOR: disconnected. Your account is untouched; this vault just forgot its keys.');
  }

  /* --------------------------------------------------------- mcp calls --- */

  async mcpCall(toolName, args) {
    const token = await this.ensureToken();
    const resp = await requestUrl({
      url: MCP_URL,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Authorization': 'Bearer ' + token,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'tools/call',
        params: { name: toolName, arguments: args || {} },
      }),
      throw: false,
    });
    if (resp.status === 401) throw new Error('session expired — please reconnect');
    const body = resp.json;
    if (!body || body.error) {
      throw new Error((body && body.error && body.error.message) || 'MCP call failed (HTTP ' + resp.status + ')');
    }
    const content = body.result && body.result.content && body.result.content[0];
    if (!content || content.type !== 'text') throw new Error('unexpected MCP response shape');
    const parsed = JSON.parse(content.text);
    if (body.result.isError) throw new Error(parsed.message || parsed.error || 'tool error');
    return parsed;
  }

  async fetchDashboardData() {
    const [growth, journey, byCategory, courses] = await Promise.all([
      this.mcpCall('get_my_growth_assignment_progress'),
      this.mcpCall('get_my_journey'),
      this.mcpCall('get_my_reflections_by_category'),
      this.mcpCall('get_courses'),
    ]);
    return { growth, journey, byCategory, courses, fetchedAt: new Date() };
  }

  /* ------------------------------------------------- reflection sync ---- */

  /* Escape a string for a double-quoted YAML scalar, flattened to one line. */
  yamlString(v) {
    return '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\s+/g, ' ').trim() + '"';
  }

  reflectionSlug(question) {
    const base = String(question || 'reflection')
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 60)
      .replace(/-+$/, '');
    return base || 'reflection';
  }

  reflectionNote(refl, nowIso) {
    const when = refl.answered_at || refl.completed_at || refl.created_at || nowIso;
    const date = String(when).slice(0, 10);
    const lines = [
      '---',
      'type: icor-reflection',
      'created: ' + nowIso.slice(0, 10),
      'myicor_id: ' + refl.id,
      'category: ' + this.yamlString(refl.question_category || 'Uncategorized'),
      'reflected_at: ' + date,
    ];
    if (typeof refl.quality_score === 'number' && refl.quality_score > 0) {
      lines.push('quality_score: ' + refl.quality_score);
    }
    if (refl.is_pinned === true) lines.push('pinned: true');
    lines.push('synced_at: ' + nowIso, '---', '');

    lines.push('# ' + String(refl.question_text || 'Reflection').replace(/\s+/g, ' ').trim(), '');
    lines.push('> Growth assignment reflection, synced from your myICOR account.', '');
    /* The answer is the user's own text: written VERBATIM, never edited. */
    lines.push('## My answer', '', String(refl.answer).trim(), '');
    if (refl.notes && String(refl.notes).trim()) {
      lines.push('## My notes', '', String(refl.notes).trim(), '');
    }
    const subs = this.renderSubAnswers(refl.question_answers, refl.question_notes);
    if (subs.length) {
      lines.push('## Sub-question answers', '', ...subs, '');
    }
    if (refl.ai_summary && String(refl.ai_summary).trim()) {
      lines.push('## AI summary (from myICOR)', '', String(refl.ai_summary).trim(), '');
    }
    return lines.join('\n');
  }

  /* question_answers is loosely-shaped JSON from the app; render what we can
   * recognize and silently skip the rest rather than dumping raw JSON. */
  renderSubAnswers(answers, notes) {
    const out = [];
    const push = (label, text) => {
      const t = String(text || '').trim();
      if (!t) return;
      if (label) out.push('- **' + String(label).replace(/\s+/g, ' ').trim() + '**', '', '  ' + t, '');
      else out.push('- ' + t, '');
    };
    const walk = (val) => {
      if (Array.isArray(val)) {
        for (const item of val) {
          if (typeof item === 'string') push(null, item);
          else if (item && typeof item === 'object') {
            push(item.question || item.q || item.title || null, item.answer || item.a || item.text || item.value);
          }
        }
      } else if (val && typeof val === 'object') {
        for (const [k, v] of Object.entries(val)) {
          if (typeof v === 'string') push(k, v);
        }
      }
    };
    walk(answers);
    walk(notes);
    return out;
  }

  async syncReflections(progressCb) {
    if (this.syncInFlight) throw new Error('a sync is already running');
    this.syncInFlight = true;
    try {
      const adapter = this.app.vault.adapter;
      const reflectionsDir = this.reflectionsDir();
      if (!(await adapter.exists(reflectionsDir))) await adapter.mkdir(reflectionsDir);

      /* Which reflections already live in the vault? The myicor_id in
       * frontmatter is the sync key; the note content is never compared,
       * because local notes belong to the user once created. */
      const existing = new Set();
      const listing = await adapter.list(reflectionsDir);
      for (const f of listing.files || []) {
        if (!f.endsWith('.md')) continue;
        const head = String(await adapter.read(f)).slice(0, 800);
        const m = head.match(/^myicor_id:\s*([0-9a-f-]{36})\s*$/m);
        if (m) existing.add(m[1]);
      }

      /* Page through every answered reflection remotely. */
      const remote = [];
      let offset = 0;
      for (;;) {
        const page = await this.mcpCall('get_my_notes', { answered_only: true, limit: 100, offset });
        remote.push(...(page.reflections || []));
        if (!page.pagination || !page.pagination.hasMore) break;
        offset += 100;
        if (offset > 5000) break; /* runaway guard */
      }

      /* Reflections with no usable answer are remembered so later syncs do
       * not refetch them forever. */
      const skipped = new Set((this.data.reflectionSync && this.data.reflectionSync.skippedIds) || []);
      const fresh = remote.filter((r) => r.id && !existing.has(r.id) && !skipped.has(r.id));
      const nowIso = new Date().toISOString();
      let created = 0;
      for (const r of fresh) {
        const detail = await this.mcpCall('get_note_details', { note_id: r.id });
        const refl = detail.reflection;
        if (!refl || !refl.answer || !String(refl.answer).trim()) { skipped.add(r.id); continue; }
        const when = refl.answered_at || refl.completed_at || refl.created_at || nowIso;
        let path = reflectionsDir + '/' + String(when).slice(0, 10) + '_' + this.reflectionSlug(refl.question_text) + '.md';
        if (await adapter.exists(path)) {
          path = path.replace(/\.md$/, '-' + String(refl.id).slice(0, 8) + '.md');
        }
        if (await adapter.exists(path)) continue; /* same reflection, same day: already there */
        await adapter.write(path, this.reflectionNote(refl, nowIso));
        created++;
        if (progressCb) progressCb(created, fresh.length);
      }

      this.data.reflectionSync = {
        lastSyncAt: nowIso,
        lastCreated: created,
        totalLocal: existing.size + created,
        totalRemote: remote.length,
        skippedIds: [...skipped].slice(-500),
      };
      await this.saveSettings();
      return this.data.reflectionSync;
    } finally {
      this.syncInFlight = false;
    }
  }

  /* ---------------------------------------------- Claude context wiring -- */

  async wireClaude() {
    const adapter = this.app.vault.adapter;
    let cfg = {};
    if (await adapter.exists('.mcp.json')) {
      try { cfg = JSON.parse(await adapter.read('.mcp.json')); } catch (e) { cfg = {}; }
    }
    if (!cfg.mcpServers || typeof cfg.mcpServers !== 'object') cfg.mcpServers = {};
    /* URL only — Claude Code runs its own OAuth against the same server. */
    cfg.mcpServers.myicor = { type: 'http', url: MCP_URL };
    await adapter.write('.mcp.json', JSON.stringify(cfg, null, 2) + '\n');
  }

  async isClaudeWired() {
    const adapter = this.app.vault.adapter;
    if (!(await adapter.exists('.mcp.json'))) return false;
    try {
      const cfg = JSON.parse(await adapter.read('.mcp.json'));
      return !!(cfg.mcpServers && cfg.mcpServers.myicor);
    } catch (e) {
      return false;
    }
  }

  async ensureGitignore() {
    const adapter = this.app.vault.adapter;
    /* The ignored path is read from the host at call time, never written
       down: the plugin's folder FOLLOWS the manifest id, and the config
       dir itself can be renamed in Obsidian's settings. A literal here
       survives a rename of either and then guards the wrong path. */
    const line = this.app.vault.configDir + '/plugins/' + this.manifest.id + '/data.json';
    let gi = '';
    if (await adapter.exists('.gitignore')) gi = await adapter.read('.gitignore');
    if (gi.split('\n').some((l) => l.trim() === line)) return;
    const sep = gi === '' || gi.endsWith('\n') ? '' : '\n';
    await adapter.write(
      '.gitignore',
      gi + sep + '\n# ICOR for Life - Connect token store (hard rule 9: secrets never reach git)\n' + line + '\n'
    );
  }
}

/* ------------------------------------------------------------------------- *
 * Dashboard view
 * ------------------------------------------------------------------------- */

class DashboardView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.lessonCache = new Map();
  }

  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return 'myICOR'; }
  getIcon() { return 'infinity'; }

  async onOpen() {
    this.root = this.contentEl;
    this.root.addClass('micor-dash');
    await this.render();
  }

  openLink(url) {
    if (url) window.open(url);
  }

  setPage(page) {
    if (!PAGES.some((p) => p.key === page)) return;
    this.page = page;
    this.render();
  }

  async render() {
    this.root.empty();
    if (!this.plugin.isConnected()) {
      this.renderConnectHero();
      return;
    }
    this.renderShell();
  }

  /* ------------------------------------------------------------- shell -- */

  renderShell() {
    const current = PAGES.find((p) => p.key === (this.page || 'overview')) || PAGES[0];

    const header = this.root.createDiv({ cls: 'micor-header' });
    const brand = header.createDiv({ cls: 'micor-header-brand' });
    const m = brand.createDiv({ cls: 'micor-header-mark' });
    m.innerHTML = MARK_SVG;
    const t = brand.createDiv();
    t.createDiv({ cls: 'micor-header-title', text: 'myICOR' });
    t.createDiv({ cls: 'micor-header-sub', text: 'LIVE FROM APP.MYICOR.COM' });

    const actions = header.createDiv({ cls: 'micor-header-actions' });
    const openBtn = actions.createEl('button', { cls: 'micor-icon-btn', attr: { 'aria-label': 'Open app.myicor.com' } });
    setIcon(openBtn, 'external-link');
    openBtn.addEventListener('click', () => this.openLink(BASE_URL));
    const refreshBtn = actions.createEl('button', { cls: 'micor-icon-btn', attr: { 'aria-label': 'Refresh this page' } });
    setIcon(refreshBtn, 'refresh-cw');
    refreshBtn.addEventListener('click', () => {
      this.plugin.lastData = null;
      this.pageCache && this.pageCache.delete(current.key === 'latest' ? 'get_latest_resources' : current.key === 'announcements' ? 'get_announcements' : current.key);
      this.render();
    });
    const dcBtn = actions.createEl('button', { cls: 'micor-icon-btn', attr: { 'aria-label': 'Disconnect this vault' } });
    setIcon(dcBtn, 'log-out');
    dcBtn.addEventListener('click', async () => {
      await this.plugin.disconnect();
      this.plugin.lastData = null;
      this.render();
    });

    const tabs = this.root.createDiv({ cls: 'micor-tabs' });
    for (const page of PAGES) {
      const tab = tabs.createEl('button', { cls: 'micor-tab' + (page.key === current.key ? ' is-active' : ''), text: page.tab });
      tab.addEventListener('click', () => this.setPage(page.key));
    }

    /* masthead: the page's name. The stroke lives here on every page
     * except Announcements, where the billboard hero owns it. */
    const mast = this.root.createDiv({ cls: 'micor-masthead' });
    mast.createDiv({ cls: 'micor-masthead-kicker', text: current.kicker });
    const h1 = mast.createEl('h1', { cls: 'micor-masthead-title', text: current.title });
    const hand = h1.createSpan({ cls: 'micor-masthead-hand', text: current.hand });
    hand.setAttribute('aria-hidden', 'true');
    /* one-marker law: on Announcements the billboard hero owns the stroke,
     * on Overview the loop gauge IS the stroke */
    if (current.key !== 'announcements' && current.key !== 'overview') strokeEl(mast, 'micor-masthead-stroke');

    const body = this.root.createDiv({ cls: 'micor-page' });
    this.renderPage(body, current.key);
  }

  async renderPage(body, page) {
    if (page === 'search') { this.renderSearch(body, true); return; }
    if (page === 'trends') { await this.renderTrendsPage(body); return; }
    if (page === 'latest') { await this.renderLatestPage(body); return; }
    if (page === 'announcements') { await this.renderBoardPage(body); return; }
    await this.renderOverviewPage(body);
  }

  /* ------------------------------------------------- shared page bits --- */

  skeletonRows(parent, n) {
    const box = parent.createDiv({ cls: 'micor-skeleton', attr: { role: 'status', 'aria-live': 'polite', 'aria-label': 'Loading' } });
    for (let i = 0; i < n; i++) {
      const row = box.createDiv({ cls: 'micor-skeleton-row' });
      row.createDiv({ cls: 'micor-track micor-track-kicker' });
      row.createDiv({ cls: 'micor-track micor-track-title' });
    }
    return box;
  }

  skeletonTiles(parent, n) {
    const box = parent.createDiv({ cls: 'micor-skeleton micor-tile-grid', attr: { role: 'status', 'aria-live': 'polite', 'aria-label': 'Loading' } });
    for (let i = 0; i < n; i++) {
      const tile = box.createDiv({ cls: 'micor-skeleton-tile' });
      tile.createDiv({ cls: 'micor-track micor-track-thumb' });
      tile.createDiv({ cls: 'micor-track micor-track-title' });
      tile.createDiv({ cls: 'micor-track micor-track-kicker' });
    }
    return box;
  }

  emptyState(parent, icon, text, hand) {
    const box = parent.createDiv({ cls: 'micor-blank' });
    setIcon(box.createDiv({ cls: 'micor-blank-icon' }), icon);
    box.createDiv({ cls: 'micor-blank-text', text });
    if (hand) box.createDiv({ cls: 'micor-hand-note', text: hand });
    return box;
  }

  renderPageError(body, err) {
    const box = body.createDiv({ cls: 'micor-blank' });
    setIcon(box.createDiv({ cls: 'micor-blank-icon' }), 'unplug');
    box.createDiv({ cls: 'micor-blank-text', text: 'Could not load this page.' });
    box.createDiv({ cls: 'micor-error-note', text: String(err.message || err) });
    const retry = box.createEl('button', { cls: 'micor-connect-btn', text: 'Try again' });
    retry.addEventListener('click', () => this.render());
  }

  /* Fetch a page tool with cache; 'pending' when the server has not
   * shipped the tool yet. */
  async fetchTool(toolName, args) {
    if (!this.pageCache) this.pageCache = new Map();
    if (this.pageCache.has(toolName)) return this.pageCache.get(toolName);
    try {
      const payload = await this.plugin.mcpCall(toolName, args || {});
      this.pageCache.set(toolName, payload);
      return payload;
    } catch (e) {
      if (/unknown tool|not found|unrecognized|-32601/i.test(String(e.message))) return { pending: true };
      throw e;
    }
  }

  section(parent, index, title) {
    const sec = parent.createDiv({ cls: 'micor-card' });
    const head = sec.createDiv({ cls: 'micor-card-head' });
    head.createSpan({ cls: 'micor-card-index', text: index + ' ·' });
    head.createSpan({ cls: 'micor-card-title', text: title });
    return sec;
  }

  stat(parent, value, label) {
    const s = parent.createDiv({ cls: 'micor-stat' });
    s.createDiv({ cls: 'micor-stat-value', text: String(value) });
    s.createDiv({ cls: 'micor-stat-label', text: label });
    return s;
  }

  bar(parent, pct, lens) {
    const wrap = parent.createDiv({ cls: 'micor-bar' + (lens ? ' micor-lens-' + lens : '') });
    const track = wrap.createDiv({ cls: 'micor-bar-track' });
    const fill = track.createDiv({ cls: 'micor-bar-fill' });
    fill.style.width = Math.max(0, Math.min(100, pct)) + '%';
    return wrap;
  }

  /* ---------------------------------------------------------- overview -- */

  async renderOverviewPage(body) {
    if (this.plugin.lastData) {
      await this.renderOverview(body, this.plugin.lastData);
      this.plugin.fetchDashboardData().then(async (data) => {
        this.plugin.lastData = data;
        if (body.isConnected && (this.page || 'overview') === 'overview') {
          body.empty();
          await this.renderOverview(body, data);
        }
      }).catch(() => { /* stale-but-rendered beats an error flash */ });
      return;
    }
    this.skeletonRows(body, 4);
    try {
      const data = await this.plugin.fetchDashboardData();
      this.plugin.lastData = data;
      body.empty();
      await this.renderOverview(body, data);
    } catch (e) {
      body.empty();
      this.renderPageError(body, e);
    }
  }

  async renderOverview(body, data) {
    const { growth, journey, byCategory, courses } = data;
    const all = (courses && courses.courses) || [];
    const isJourney = (c) => c.course_type === 'icor_journey';
    const journeyCourses = all.filter(isJourney);
    const otherCourses = all.filter((c) => !isJourney(c));
    const inkPct = journeyCourses.length
      ? Math.round(journeyCourses.reduce((a, c) => a + (c.progress_percent || 0), 0) / journeyCourses.length)
      : 0;
    const closed = journeyCourses.filter((c) => c.progress_percent >= 100).length;
    const currentCourse = journeyCourses.find((c) => c.progress_percent < 100) || null;

    if (this.sectionIO) this.sectionIO.disconnect();
    this.sectionIO = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) { e.target.addClass('in'); this.sectionIO.unobserve(e.target); }
      }
    }, { threshold: 0.12 });
    const reveal = (el) => { this.sectionIO.observe(el); return el; };

    this.renderLoopHero(body, { journey, inkPct, closed, journeyCourses, currentCourse });
    this.renderLoopPath(reveal(body.createDiv({ cls: 'micor-sect' })), journeyCourses, currentCourse);
    if (otherCourses.length) this.renderOffTheLine(reveal(body.createDiv({ cls: 'micor-sect' })), otherCourses, courses.summary);
    this.renderLoopSlabs(reveal(body.createDiv({ cls: 'micor-sect' })), { growth, byCategory, journeyCourses });
    this.renderGapRows(reveal(body.createDiv({ cls: 'micor-sect' })), growth, byCategory);
    await this.renderVaultCard(reveal(body.createDiv({ cls: 'micor-sect' })));
    this.renderTieOff(reveal(body.createDiv({ cls: 'micor-sect micor-tieoff-sect' })), currentCourse);

    const footer = body.createDiv({ cls: 'micor-footer' });
    footer.createSpan({ text: 'CONNECTED VIA THE OFFICIAL MYICOR MCP SERVER · REFRESHED ' + data.fetchedAt.toLocaleTimeString() });

    /* resume derivation (G1 degrade): first incomplete lesson of the
     * current course, cached; CTA labels upgrade in place when it lands */
    this.deriveResume(currentCourse);
  }

  sectHead(sec, kicker, display, bodyText) {
    sec.createSpan({ cls: 'micor-sect-kicker', text: kicker });
    if (display) sec.createEl('h2', { cls: 'micor-sect-display', text: display });
    if (bodyText) sec.createDiv({ cls: 'micor-sect-body', text: bodyText });
  }

  /* ------------------------------------------------------- loop hero ---- */

  renderLoopHero(body, ctx) {
    const { journey, inkPct, closed, journeyCourses, currentCourse } = ctx;
    const hero = body.createDiv({ cls: 'micor-loop-hero in' });

    const stageKey = journey.current_stage || 'getting_started';
    const stage = JOURNEY_STAGES.find((s) => s.key === stageKey) || JOURNEY_STAGES[0];
    const note = hero.createDiv({ cls: 'micor-loop-note' });
    note.setAttribute('aria-hidden', 'true');
    note.setText(stage.label.toLowerCase() + (journey.stage_changed_at ? ' · since ' + new Date(journey.stage_changed_at).toLocaleDateString() : ''));

    const grid = hero.createDiv({ cls: 'micor-loop-grid' });
    const content = grid.createDiv({ cls: 'micor-loop-content' });
    content.createDiv({ cls: 'micor-loop-kicker', text: 'THE LOOP, DRAWN BY YOU' });
    content.createEl('h2', { cls: 'micor-loop-display', text: 'Your loop is ' + inkPct + '% drawn.' });
    content.createDiv({ cls: 'micor-loop-caption', text: STAGE_CAPTIONS[stageKey] || STAGE_CAPTIONS.getting_started });

    const momentum = content.createDiv({ cls: 'micor-momentum' });
    const mrow = momentum.createDiv({ cls: 'micor-momentum-row' });
    mrow.createSpan({ text: 'COURSES CLOSED' });
    mrow.createSpan({ text: closed + ' OF ' + journeyCourses.length });
    const mbar = momentum.createDiv({ cls: 'micor-momentum-bar' });
    const mfill = mbar.createDiv({ cls: 'micor-momentum-fill' });
    window.requestAnimationFrame(() => {
      mfill.style.width = (journeyCourses.length ? Math.round((closed / journeyCourses.length) * 100) : 0) + '%';
    });

    const cta = content.createDiv({ cls: 'micor-loop-cta' });
    const btn = cta.createEl('button', { cls: 'micor-btn micor-btn-marker micor-resume-cta', text: 'Pick up the pen' });
    btn.addEventListener('click', () => this.openLink(this.resumeUrl || (currentCourse && currentCourse.url) || BASE_URL));
    if (currentCourse) cta.createSpan({ cls: 'micor-hand-note', text: 'the line waits where you left it' });
    else { btn.remove(); cta.createSpan({ cls: 'micor-hand-note', text: 'every station closed — keep looping' }); }

    this.buildLoopGauge(grid.createDiv({ cls: 'micor-loop-gauge-wrap' }), journeyCourses, inkPct);

    const ms = (journey.milestones || []).slice(-3).reverse();
    if (ms.length) {
      const foot = hero.createDiv({ cls: 'micor-loop-milestones' });
      for (const m of ms) {
        const row = foot.createDiv({ cls: 'micor-loop-milestone' });
        row.createSpan({ text: String(m.label || m.stage).toUpperCase() });
        if (m.achievedAt) row.createSpan({ text: kickerDate(m.achievedAt) });
      }
    }
  }

  /* Map journey courses onto the four arcs by name fragment (G10 degrade). */
  arcPercents(journeyCourses) {
    const pct = [0, 0, 0, 0];
    const seen = [false, false, false, false];
    let taskAcc = [];
    const leftovers = [];
    for (const c of journeyCourses) {
      const n = String(c.name || '').toLowerCase();
      if (/note/.test(n)) { pct[0] = c.progress_percent; seen[0] = true; }
      else if (/pkm/.test(n)) { pct[1] = c.progress_percent; seen[1] = true; }
      else if (/task|project/.test(n)) { taskAcc.push(c.progress_percent); seen[2] = true; }
      else leftovers.push(c);
    }
    if (taskAcc.length) pct[2] = Math.round(taskAcc.reduce((a, b) => a + b, 0) / taskAcc.length);
    if (leftovers.length) { pct[3] = leftovers[0].progress_percent; seen[3] = true; }
    /* order fallback for anything unmapped */
    journeyCourses.forEach((c, i) => { if (i < 4 && !seen[i] && pct[i] === 0) pct[i] = c.progress_percent || 0; });
    return pct;
  }

  buildLoopGauge(wrap, journeyCourses, inkPct) {
    const pcts = this.arcPercents(journeyCourses);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '-20 -14 500 288');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Your loop: ' + inkPct + '% drawn');
    svg.classList.add('micor-loop-gauge');

    const inkPaths = [];
    LOOP_ARCS.forEach((d, i) => {
      const track = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      track.setAttribute('d', d);
      track.classList.add('micor-gauge-track');
      svg.appendChild(track);
      const ink = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      ink.setAttribute('d', d);
      ink.classList.add('micor-gauge-ink');
      ink.style.transitionDelay = (250 + i * 260) + 'ms';
      svg.appendChild(ink);
      inkPaths.push(ink);
    });
    for (const st of LOOP_STATIONS) {
      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('cx', st.x); dot.setAttribute('cy', st.y); dot.setAttribute('r', '5');
      dot.classList.add('micor-gauge-dot');
      svg.appendChild(dot);
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', st.lx); label.setAttribute('y', st.ly);
      label.setAttribute('text-anchor', st.anchor);
      label.classList.add('micor-gauge-label');
      label.textContent = st.label;
      svg.appendChild(label);
    }
    /* course labels, 26px outward from arc midpoints */
    const courseLabelSpots = [[0, 0.5], [1, 0.5], [2, 0.28], [2, 0.78], [3, 0.5]];
    const courseNames = journeyCourses.slice(0, 5).map((c) => {
      const n = String(c.name || '');
      return (n.split(/ like| for| -/i)[0] || n).toUpperCase().slice(0, 14);
    });
    const tip = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    tip.setAttribute('r', '6');
    tip.classList.add('micor-gauge-tip');
    svg.appendChild(tip);
    wrap.appendChild(svg);

    /* ink lengths + pen tip need layout, so next frame */
    window.requestAnimationFrame(() => {
      inkPaths.forEach((ink, i) => {
        try {
          const len = ink.getTotalLength();
          ink.style.strokeDasharray = String(len);
          ink.style.strokeDashoffset = String(len);
          window.requestAnimationFrame(() => {
            ink.style.strokeDashoffset = String(len * (1 - Math.max(0, Math.min(100, pcts[i])) / 100));
          });
        } catch (e) { /* detached pane: skip the draw */ }
      });
      try {
        let tipArc = inkPaths.findIndex((_, i) => pcts[i] < 100);
        if (tipArc === -1) tipArc = inkPaths.length - 1;
        const path = inkPaths[tipArc];
        const len = path.getTotalLength();
        const pt = path.getPointAtLength(len * Math.max(0, Math.min(100, pcts[tipArc])) / 100);
        tip.setAttribute('cx', pt.x); tip.setAttribute('cy', pt.y);
      } catch (e) { tip.remove(); }
      try {
        courseLabelSpots.forEach(([arcIdx, frac], i) => {
          if (!courseNames[i]) return;
          const path = inkPaths[arcIdx];
          const len = path.getTotalLength();
          const pt = path.getPointAtLength(len * frac);
          const dx = pt.x - LOOP_CX, dy = pt.y - LOOP_CY;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          label.setAttribute('x', pt.x + (dx / dist) * 26);
          label.setAttribute('y', pt.y + (dy / dist) * 26);
          label.setAttribute('text-anchor', 'middle');
          label.classList.add('micor-gauge-course');
          label.textContent = courseNames[i];
          svg.appendChild(label);
        });
      } catch (e) { /* labels are optional */ }
    });
  }

  async deriveResume(currentCourse) {
    if (!currentCourse) return;
    try {
      let payload = this.lessonCache.get(currentCourse.id);
      if (!payload) {
        payload = await this.plugin.mcpCall('get_lessons', { course_id: currentCourse.id });
        this.lessonCache.set(currentCourse.id, payload);
      }
      const next = (payload.lessons || []).find((l) => !l.completed);
      if (!next) return;
      this.resumeUrl = next.url || currentCourse.url;
      for (const el of this.root.querySelectorAll('.micor-resume-cta')) {
        el.setText('Pick up the pen — ' + next.title);
      }
      const st = this.root.querySelector('.micor-station[data-state="current"] .micor-station-resume');
      if (st) st.setText('Resume — ' + next.title);
    } catch (e) { /* honest degrade: course-level CTA stays */ }
  }

  /* ------------------------------------------------------- the path ----- */

  renderLoopPath(sec, journeyCourses, currentCourse) {
    this.sectHead(sec, 'THE PATH · ' + (journeyCourses.length || 'FIVE') + ' STATIONS', 'One line through five courses.',
      'The ink runs exactly as far as you have. The dot that is lit is your next lesson.');
    if (!journeyCourses.length) {
      this.emptyState(sec, 'map', 'Journey courses appear once the library loads.');
      return;
    }
    const inkPct = Math.round(journeyCourses.reduce((a, c) => a + (c.progress_percent || 0), 0) / journeyCourses.length);
    const path = sec.createDiv({ cls: 'micor-path' });
    const rail = path.createDiv({ cls: 'micor-rail' });
    const railInk = rail.createDiv({ cls: 'micor-rail-ink' });
    const railTip = rail.createDiv({ cls: 'micor-rail-tip' });
    window.requestAnimationFrame(() => {
      railInk.style.height = inkPct + '%';
      railTip.style.top = inkPct + '%';
    });

    journeyCourses.forEach((c, i) => {
      const state = c.progress_percent >= 100 ? 'done' : (currentCourse && c.id === currentCourse.id) ? 'current' : 'todo';
      const station = path.createDiv({ cls: 'micor-station', attr: { 'data-state': state } });
      station.createDiv({ cls: 'micor-station-dot' });
      const eyebrow = station.createDiv({ cls: 'micor-station-eyebrow' });
      eyebrow.createSpan({ text: 'COURSE ' + String(i + 1).padStart(2, '0') });
      if (state === 'done') eyebrow.createSpan({ cls: 'micor-hand-inline', text: 'closed ✓' });
      if (state === 'current') eyebrow.createSpan({ cls: 'micor-hand-inline', text: 'you are here' });
      station.createEl('h3', { cls: 'micor-station-name', text: c.name });
      const stats = station.createDiv({ cls: 'micor-station-stats' });
      const s1 = stats.createSpan();
      s1.createEl('b', { text: String(c.completed_lessons) });
      s1.appendText(' / ' + c.lesson_count + ' lessons');
      const s2 = stats.createSpan();
      s2.createEl('b', { text: c.progress_percent + '%' });
      s2.appendText(' complete');
      const bar = station.createDiv({ cls: 'micor-station-bar' });
      const fill = bar.createEl('i');
      fill.style.width = Math.max(0, Math.min(100, c.progress_percent)) + '%';

      const act = station.createDiv({ cls: 'micor-station-act' });
      if (state === 'current') {
        const b = act.createEl('button', { cls: 'micor-btn micor-btn-marker micor-station-resume', text: 'Resume the course' });
        b.addEventListener('click', () => this.openLink(this.resumeUrl || c.url));
      } else if (state === 'todo') {
        const b = act.createEl('button', { cls: 'micor-btn micor-btn-quiet', text: 'Start — ' + c.name });
        b.addEventListener('click', () => this.openLink(c.url));
      } else {
        const b = act.createEl('button', { cls: 'micor-btn micor-btn-quiet', text: 'Revisit the course' });
        b.addEventListener('click', () => this.openLink(c.url));
      }
      const toggle = act.createEl('button', { cls: 'micor-station-lessons-toggle' });
      toggle.createSpan({ text: 'LESSONS' });
      setIcon(toggle.createDiv({ cls: 'micor-toggle-chevron' }), 'chevron-down');
      const drawer = station.createDiv({ cls: 'micor-station-drawer' });
      toggle.addEventListener('click', async () => {
        const open = station.hasClass('is-open');
        station.toggleClass('is-open', !open);
        if (open || drawer.hasChildNodes()) return;
        this.skeletonRows(drawer, 2);
        try {
          let payload = this.lessonCache.get(c.id);
          if (!payload) {
            payload = await this.plugin.mcpCall('get_lessons', { course_id: c.id });
            this.lessonCache.set(c.id, payload);
          }
          drawer.empty();
          for (const l of payload.lessons || []) {
            const lrow = drawer.createDiv({ cls: 'micor-lesson' + (l.url ? ' is-clickable' : '') });
            setIcon(lrow.createDiv({ cls: 'micor-lesson-check' + (l.completed ? ' is-done' : '') }), l.completed ? 'check-circle-2' : 'circle');
            lrow.createSpan({ cls: 'micor-lesson-title', text: l.title });
            if (l.time_estimate_minutes) lrow.createSpan({ cls: 'micor-lesson-time', text: l.time_estimate_minutes + ' MIN' });
            if (l.url) lrow.addEventListener('click', () => this.openLink(l.url));
          }
        } catch (e) {
          drawer.empty();
          drawer.createDiv({ cls: 'micor-error-note', text: 'Could not load lessons: ' + e.message });
        }
      });
    });
  }

  renderOffTheLine(sec, otherCourses, summary) {
    this.sectHead(sec, 'OFF THE LINE · OTHER COURSES', null, null);
    if (summary) {
      const chips = sec.createDiv({ cls: 'micor-chip-row' });
      for (const [n, label] of [[summary.in_progress, 'IN PROGRESS'], [summary.completed, 'COMPLETED'], [summary.not_started, 'NOT STARTED']]) {
        if (n != null) chips.createSpan({ cls: 'micor-chip', text: n + ' ' + label });
      }
    }
    const rank = (c) => (c.progress_percent > 0 && c.progress_percent < 100 ? 0 : c.progress_percent === 0 ? 1 : 2);
    const sorted = [...otherCourses].sort((a, b) => rank(a) - rank(b) || b.progress_percent - a.progress_percent);
    const list = sec.createDiv({ cls: 'micor-course-list' });
    for (const c of sorted) {
      const row = list.createDiv({ cls: 'micor-course' });
      const main = row.createDiv({ cls: 'micor-course-main is-clickable' });
      const caret = main.createDiv({ cls: 'micor-course-caret' });
      setIcon(caret, 'chevron-right');
      const bodyEl = main.createDiv({ cls: 'micor-course-body' });
      const top = bodyEl.createDiv({ cls: 'micor-course-top' });
      top.createSpan({ cls: 'micor-course-name', text: c.name });
      top.createSpan({ cls: 'micor-course-meta', text: c.completed_lessons + '/' + c.lesson_count + ' · ' + c.progress_percent + '%' });
      this.bar(bodyEl, c.progress_percent);
      const go = main.createDiv({ cls: 'micor-course-go' });
      setIcon(go, 'arrow-up-right');
      go.addEventListener('click', (ev) => { ev.stopPropagation(); this.openLink(c.url); });
      const drawer = row.createDiv({ cls: 'micor-course-drawer' });
      main.addEventListener('click', async () => {
        const open = row.hasClass('is-open');
        row.toggleClass('is-open', !open);
        if (open || drawer.hasChildNodes()) return;
        this.skeletonRows(drawer, 2);
        try {
          let payload = this.lessonCache.get(c.id);
          if (!payload) {
            payload = await this.plugin.mcpCall('get_lessons', { course_id: c.id });
            this.lessonCache.set(c.id, payload);
          }
          drawer.empty();
          for (const l of payload.lessons || []) {
            const lrow = drawer.createDiv({ cls: 'micor-lesson' + (l.url ? ' is-clickable' : '') });
            setIcon(lrow.createDiv({ cls: 'micor-lesson-check' + (l.completed ? ' is-done' : '') }), l.completed ? 'check-circle-2' : 'circle');
            lrow.createSpan({ cls: 'micor-lesson-title', text: l.title });
            if (l.time_estimate_minutes) lrow.createSpan({ cls: 'micor-lesson-time', text: l.time_estimate_minutes + ' MIN' });
            if (l.url) lrow.addEventListener('click', () => this.openLink(l.url));
          }
        } catch (e) {
          drawer.empty();
          drawer.createDiv({ cls: 'micor-error-note', text: 'Could not load lessons: ' + e.message });
        }
      });
    }
  }

  /* ------------------------------------------------------ the numbers --- */

  renderLoopSlabs(sec, ctx) {
    const { growth, byCategory, journeyCourses } = ctx;
    this.sectHead(sec, 'THE NUMBERS', null, null);
    const slabs = sec.createDiv({ cls: 'micor-slabs' });
    const totalLessons = journeyCourses.reduce((a, c) => a + (c.lesson_count || 0), 0);
    const doneLessons = journeyCourses.reduce((a, c) => a + (c.completed_lessons || 0), 0);
    const lessonPct = totalLessons ? Math.round((doneLessons / totalLessons) * 100) : 0;
    const cats = (byCategory.categories || []).filter((c) => c.avg_quality != null);
    let avg = growth.growth_average_quality;
    if (cats.length) {
      const totalRefl = cats.reduce((a, c) => a + c.reflections, 0);
      avg = Math.round(cats.reduce((a, c) => a + c.avg_quality * c.reflections, 0) / Math.max(1, totalRefl));
    }
    const slab = (value, small, label, marker) => {
      const el = slabs.createDiv({ cls: 'micor-slab' + (marker ? ' is-marker' : '') });
      const b = el.createEl('b', { text: String(value) });
      if (small) b.createEl('small', { text: ' ' + small });
      el.createEl('span', { text: label });
    };
    slab(lessonPct + '%', null, 'of all lessons finished');
    slab(doneLessons, '/ ' + totalLessons, 'lessons done');
    slab(growth.growth_assignments_completed ?? 0, null, 'growth assignments completed');
    slab(avg != null && avg > 0 ? avg + '%' : '—', null, 'avg reflection quality', true);
    slab(growth.login_streak ?? 0, null, 'day streak');
    slab(growth.longest_streak ?? 0, null, 'longest streak');
  }

  /* --------------------------------------------- where the line breaks -- */

  renderGapRows(sec, growth, byCategory) {
    const cats = (byCategory.categories || []);
    const head = sec.createDiv({ cls: 'micor-gaps-head' });
    head.createSpan({ cls: 'micor-sect-kicker', text: 'WHERE THE LINE BREAKS' });
    const scored = cats.filter((c) => c.avg_quality != null);
    if (scored.length) {
      const totalRefl = cats.reduce((a, c) => a + c.reflections, 0);
      const avg = Math.round(scored.reduce((a, c) => a + c.avg_quality * c.reflections, 0) / Math.max(1, scored.reduce((a, c) => a + c.reflections, 0)));
      head.createSpan({
        cls: 'micor-gaps-avg',
        text: 'AVG ' + avg + '% · ' + totalRefl + ' REFLECTIONS · ' + (growth.text_reflections ?? 0) + ' WRITTEN',
      });
    }
    sec.createDiv({ cls: 'micor-sect-body', text: 'Your lowest-scored categories are the next stations. Gaps are not failures.' });
    if (!cats.length) {
      sec.createDiv({ cls: 'micor-hand-note', text: 'reflections draw this section — write your first one' });
      return;
    }
    const list = sec.createDiv({ cls: 'micor-gap-list' });
    const sorted = [...cats].sort((a, b) => (a.avg_quality ?? 101) - (b.avg_quality ?? 101)).slice(0, 8);
    sorted.forEach((c, i) => {
      const row = list.createDiv({ cls: 'micor-gap-row' });
      row.createSpan({ cls: 'micor-gap-idx', text: String(i + 1).padStart(2, '0') });
      const main = row.createDiv({ cls: 'micor-gap-main' });
      main.createDiv({ cls: 'micor-gap-title', text: c.category });
      const stroke = main.createDiv({ cls: 'micor-gap-stroke' });
      const fill = stroke.createEl('i');
      fill.style.width = Math.max(0, Math.min(100, c.avg_quality || 0)) + '%';
      main.createDiv({ cls: 'micor-gap-course', text: c.reflections + ' REFLECTION' + (c.reflections === 1 ? '' : 'S') });
      row.createSpan({ cls: 'micor-gap-score', text: c.avg_quality != null ? c.avg_quality + '%' : '—' });
    });
  }

  /* ------------------------------------------------- vault ink card ----- */

  async renderVaultCard(sec) {
    const card = sec.createDiv({ cls: 'micor-vault-card' });
    card.createDiv({ cls: 'micor-loop-kicker', text: 'THE LOOP IN YOUR VAULT' });
    card.createEl('h2', { cls: 'micor-vault-title', text: 'The vault holds the line.' });
    card.createDiv({ cls: 'micor-vault-desc', text: 'Reflections sync in as your own notes. Claude reads the same connection.' });

    const st = this.plugin.data.reflectionSync;
    const row1 = card.createDiv({ cls: 'micor-vault-row' });
    setIcon(row1.createDiv({ cls: 'micor-status-icon' + (st ? ' is-ok' : '') }), st ? 'check-circle-2' : 'circle-dashed');
    const r1t = row1.createSpan();
    if (st) {
      r1t.createEl('b', { text: String(st.totalLocal) });
      r1t.appendText(' reflections in 04 Inner World/ICOR Journey Notes · last sync ' + new Date(st.lastSyncAt).toLocaleString());
    } else {
      r1t.appendText('No reflections synced yet.');
    }

    const wired = await this.plugin.isClaudeWired();
    const row2 = card.createDiv({ cls: 'micor-vault-row' });
    setIcon(row2.createDiv({ cls: 'micor-status-icon' + (wired ? ' is-ok' : '') }), wired ? 'check-circle-2' : 'circle-dashed');
    row2.createSpan({
      text: wired
        ? 'Claude sessions in this vault can search myICOR lessons, resources, and recordings.'
        : 'Claude context is not wired yet.',
    });

    const actions = card.createDiv({ cls: 'micor-vault-actions' });
    const btn = actions.createEl('button', { cls: 'micor-btn micor-btn-quiet', text: st ? 'Sync again' : 'Sync reflections' });
    btn.addEventListener('click', async () => {
      btn.setAttr('disabled', 'true');
      btn.setText('Syncing…');
      try {
        const r = await this.plugin.syncReflections((done, total) => btn.setText('Syncing ' + done + '/' + total + '…'));
        btn.removeAttribute('disabled');
        btn.setText('Sync again');
        new Notice('myICOR: ' + r.lastCreated + ' new reflection' + (r.lastCreated === 1 ? '' : 's') + ' synced.');
      } catch (e) {
        btn.removeAttribute('disabled');
        btn.setText('Sync reflections');
        new Notice('myICOR: sync failed: ' + e.message);
      }
    });
    actions.createSpan({ cls: 'micor-hand-note', text: 'create-only: the notes are yours' });

    if (!wired) {
      const add = card.createDiv({ cls: 'micor-vault-add', text: '+ WIRE CLAUDE CONTEXT' });
      add.addEventListener('click', async () => { await this.plugin.wireClaude(); this.render(); });
    }
  }

  /* ---------------------------------------------------------- tie-off --- */

  renderTieOff(sec, currentCourse) {
    const wrap = sec.createDiv({ cls: 'micor-tieoff' });
    const inf = wrap.createDiv({ cls: 'micor-tieoff-mark' });
    /* The canonical loop path, verbatim. The web app's own Loop page carries
     * a drifted copy of it; this one is the reference. `pathLength="1"`
     * normalizes the path length, which is what makes the draw-on animation
     * immune to scale. */
    inf.innerHTML = '<svg viewBox="0 0 240 110" aria-hidden="true"><path pathLength="1" d="M50 55 C50 18 92 18 120 55 C148 92 190 92 190 55 C190 18 148 18 120 55 C92 92 50 92 50 55 Z"/></svg>';
    wrap.createEl('h2', { cls: 'micor-sect-display', text: 'The loop has no end.' });
    wrap.createDiv({ cls: 'micor-sect-body', text: 'Courses close. The practice does not.' });
    if (currentCourse) {
      const btn = wrap.createEl('button', { cls: 'micor-btn micor-btn-marker micor-resume-cta', text: 'Pick up the pen' });
      btn.addEventListener('click', () => this.openLink(this.resumeUrl || currentCourse.url));
    }
  }

  /* ------------------------------------------------------------- search -- */

  renderSearch(parent, focus) {
    const wrap = parent.createDiv({ cls: 'micor-search' });
    const line = wrap.createDiv({ cls: 'micor-search-line' });
    setIcon(line.createDiv({ cls: 'micor-search-icon' }), 'search');
    const input = line.createEl('input', {
      cls: 'micor-search-input',
      attr: { type: 'text', placeholder: 'Search myICOR: lessons, resources, founder answers…', spellcheck: 'false' },
    });
    const clear = line.createEl('button', { cls: 'micor-search-clear', attr: { 'aria-label': 'Clear search' } });
    setIcon(clear, 'x');
    const results = wrap.createDiv({ cls: 'micor-search-results' });
    clear.addEventListener('click', () => { input.value = ''; results.empty(); line.removeClass('has-value'); input.focus(); });

    const run = async () => {
      const query = input.value.trim();
      if (!query) { results.empty(); return; }
      results.empty();
      this.skeletonRows(results, 2);
      try {
        const payload = await this.plugin.mcpCall('search_myicor', { query, k: 10 });
        const hits = payload.results || [];
        results.empty();
        if (!hits.length) {
          this.emptyState(results, 'search', 'Nothing found.', 'try fewer, bigger words');
          return;
        }
        for (const hit of hits) {
          const row = results.createDiv({ cls: 'micor-hit' + (hit.deep_link ? ' is-clickable' : '') });
          const kicker = row.createDiv({ cls: 'micor-hit-kicker' });
          kicker.createSpan({ text: String(hit.source_type || 'result').toUpperCase() });
          if (hit.founder_authority) kicker.createSpan({ cls: 'micor-kicker-marker', text: ' · FOUNDER' });
          if (hit.date) kicker.createSpan({ text: ' · ' + kickerDate(hit.date) });
          row.createDiv({ cls: 'micor-hit-title', text: hit.title || 'Untitled' });
          if (hit.snippet && hit.snippet !== hit.title) row.createDiv({ cls: 'micor-hit-snippet', text: hit.snippet });
          if (hit.deep_link) row.addEventListener('click', () => this.openLink(hit.deep_link));
        }
      } catch (e) {
        results.empty();
        results.createDiv({ cls: 'micor-error-note', text: 'Search failed: ' + e.message });
      }
    };

    input.addEventListener('input', () => line.toggleClass('has-value', input.value.length > 0));
    input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') run(); });
    if (focus) window.setTimeout(() => input.focus(), 30);
  }

  /* ------------------------------------------------------------- trends -- */

  async renderTrendsPage(body) {
    this.skeletonRows(body, 3);
    let payload;
    try {
      payload = await this.fetchTool('get_trend_reports', { limit: 10 });
    } catch (e) {
      body.empty();
      this.renderPageError(body, e);
      return;
    }
    body.empty();
    const reports = payload.reports || [];
    if (!reports.length) {
      this.emptyState(body, 'trending-up', 'No published trend reports yet.', 'the radar sweeps weekly');
      return;
    }
    const list = body.createDiv({ cls: 'micor-report-list' });
    for (const r of reports) {
      const row = list.createDiv({ cls: 'micor-report is-clickable' });
      const kick = [];
      kick.push('TREND REPORT');
      if (r.report_date) kick.push(kickerDate(r.report_date));
      if (r.like_count) kick.push('♥ ' + r.like_count);
      if (r.comment_count) kick.push(r.comment_count + ' COMMENTS');
      row.createDiv({ cls: 'micor-report-kicker', text: kick.join(' · ') });
      row.createDiv({ cls: 'micor-report-title', text: r.title || 'Trend report' });
      if (r.subtitle) row.createDiv({ cls: 'micor-report-subtitle', text: r.subtitle });
      const heads = Array.isArray(r.headlines) ? r.headlines : [];
      if (heads.length) {
        const hl = row.createDiv({ cls: 'micor-report-headlines' });
        for (const h of heads.slice(0, 3)) {
          const line = hl.createDiv({ cls: 'micor-report-headline' });
          line.createDiv({ cls: 'micor-dashline' });
          line.createSpan({ text: typeof h === 'string' ? h : (h && (h.title || h.headline)) || '' });
        }
      }
      row.addEventListener('click', () => this.openLink(BASE_URL + '/trend-reports/' + r.id));
    }
  }

  /* ------------------------------------------------------------- latest -- */

  async renderLatestPage(body) {
    this.skeletonTiles(body, 6);
    let payload;
    try {
      payload = await this.fetchTool('get_latest_resources', { limit: 18 });
    } catch (e) {
      body.empty();
      this.renderPageError(body, e);
      return;
    }
    body.empty();
    if (payload.pending) { this.renderPendingTool(body, 'get_latest_resources', 'newspaper', '/resources/all'); return; }
    const items = payload.resources || [];
    if (!items.length) {
      this.emptyState(body, 'newspaper', 'Nothing here yet.', 'fresh ink lands weekly');
      return;
    }
    const grid = body.createDiv({ cls: 'micor-tile-grid' });
    for (const item of items) {
      const tile = grid.createEl('button', { cls: 'micor-tile' });
      const thumb = tile.createDiv({ cls: 'micor-tile-thumb' });
      if (item.image_url) {
        thumb.createEl('img', { attr: { src: item.image_url, loading: 'lazy', decoding: 'async', alt: item.title || '' } });
      } else {
        thumb.createDiv({ cls: 'micor-tile-fallback', text: String(item.type || 'RESOURCE').toUpperCase() });
      }
      const tw = tile.createDiv({ cls: 'micor-tile-titlewrap' });
      tw.createDiv({ cls: 'micor-tile-title', text: item.title || 'Untitled' });
      const meta = [];
      if (item.type) meta.push(String(item.type).toUpperCase());
      if (item.published_date) meta.push(kickerDate(item.published_date));
      if (item.author) meta.push(String(item.author).toUpperCase());
      if (item.duration_minutes) meta.push(item.duration_minutes + ' MIN');
      if (item.like_count) meta.push('♥ ' + item.like_count);
      tile.createDiv({ cls: 'micor-tile-meta', text: meta.join(' · ') });
      if (item.url) tile.addEventListener('click', () => this.openLink(item.url));
    }
  }

  /* ------------------------------------------------------ announcements -- */

  async renderBoardPage(body) {
    this.skeletonRows(body, 5);
    let payload;
    try {
      payload = await this.fetchTool('get_announcements', { limit: 12 });
    } catch (e) {
      body.empty();
      this.renderPageError(body, e);
      return;
    }
    body.empty();
    if (payload.pending) { this.renderPendingTool(body, 'get_announcements', 'megaphone', '/announcements'); return; }
    const items = payload.announcements || [];
    if (!items.length) {
      this.emptyState(body, 'megaphone', 'Nothing on the board yet.', 'announcements land here first');
      return;
    }

    /* billboard hero: first featured, else newest — it owns THE stroke */
    const heroItem = items.find((a) => a.is_featured) || items[0];
    const rest = items.filter((a) => a !== heroItem);

    const hero = body.createDiv({ cls: 'micor-billboard' });
    const content = hero.createDiv({ cls: 'micor-billboard-content' });
    const kicker = content.createDiv({ cls: 'micor-billboard-kicker' });
    kicker.createSpan({ cls: 'micor-kicker-marker', text: heroItem.is_featured ? 'FEATURED' : 'LATEST' });
    if (heroItem.published_at) kicker.createSpan({ text: ' · ' + kickerDate(heroItem.published_at) });
    content.createEl('h2', { cls: 'micor-billboard-title', text: heroItem.title || 'Announcement' });
    strokeEl(content, 'micor-billboard-stroke');
    if (heroItem.excerpt) content.createDiv({ cls: 'micor-billboard-excerpt', text: heroItem.excerpt });
    const actions = content.createDiv({ cls: 'micor-billboard-actions' });
    const cta = actions.createEl('button', { cls: 'micor-billboard-cta', text: heroItem.cta_label || 'Read more' });
    cta.addEventListener('click', () => this.openLink(heroItem.cta_url || heroItem.url));
    const hm = [];
    if (heroItem.like_count) hm.push('♥ ' + heroItem.like_count);
    if (heroItem.reply_count) hm.push(heroItem.reply_count + ' COMMENTS');
    if (hm.length) actions.createDiv({ cls: 'micor-billboard-meta', text: hm.join(' · ') });
    const cover = hero.createDiv({ cls: 'micor-billboard-cover' });
    if (heroItem.image_url) cover.createEl('img', { attr: { src: heroItem.image_url, loading: 'lazy', alt: heroItem.title || '' } });
    else cover.createDiv({ cls: 'micor-tile-fallback', text: 'ANNOUNCEMENT' });

    /* the rows below */
    const list = body.createDiv({ cls: 'micor-ann-list' });
    for (const a of rest) {
      const row = list.createDiv({ cls: 'micor-ann-row is-clickable' });
      const rb = row.createDiv({ cls: 'micor-ann-body' });
      const k = rb.createDiv({ cls: 'micor-hit-kicker' });
      if (a.is_featured) k.createSpan({ cls: 'micor-kicker-marker', text: 'FEATURED · ' });
      k.createSpan({ text: 'ANNOUNCEMENT' + (a.published_at ? ' · ' + kickerDate(a.published_at) : '') });
      rb.createDiv({ cls: 'micor-hit-title', text: a.title || 'Untitled' });
      const meta = rb.createDiv({ cls: 'micor-ann-meta' });
      const parts = [];
      if (a.like_count) parts.push('♥ ' + a.like_count);
      if (a.reply_count) parts.push(a.reply_count + ' COMMENTS');
      meta.createSpan({ text: parts.join(' · ') });
      if (a.cta_label && a.cta_url) {
        const cl = meta.createEl('a', { cls: 'micor-kicker-marker micor-ann-cta', text: (parts.length ? ' · ' : '') + String(a.cta_label).toUpperCase() + ' ↗', href: a.cta_url });
        cl.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); this.openLink(a.cta_url); });
      }
      if (a.image_url) {
        const th = row.createDiv({ cls: 'micor-ann-thumb' });
        th.createEl('img', { attr: { src: a.image_url, loading: 'lazy', alt: '' } });
      }
      if (a.url) row.addEventListener('click', () => this.openLink(a.url));
    }
  }

  renderPendingTool(body, toolName, icon, appPath) {
    const box = this.emptyState(body, icon, 'This page is wired and waiting for the ' + toolName + ' tool in the next myICOR MCP release.', 'it lights up on its own');
    const open = box.createEl('button', { cls: 'micor-quiet-btn', text: 'OPEN IN MYICOR FOR NOW' });
    open.addEventListener('click', () => this.openLink(BASE_URL + appPath));
  }

  /* ------------------------------------------------------ connect hero --- */

  renderConnectHero() {
    const hero = this.root.createDiv({ cls: 'micor-hero' });
    const mark = hero.createDiv({ cls: 'micor-hero-mark' });
    mark.innerHTML = MARK_SVG;
    hero.createEl('h1', { text: 'myICOR', cls: 'micor-hero-title' });
    hero.createDiv({ cls: 'micor-hero-sub', text: 'Connect this vault to your app.myicor.com account.' });

    const points = hero.createDiv({ cls: 'micor-hero-points' });
    for (const [icon, text] of [
      ['gauge', 'Your ICOR Journey, courses, and Growth Assignment progress, live in the vault'],
      ['search', 'Search lessons, resources, and founder answers without leaving Obsidian'],
      ['bot', 'Claude sessions in this scaffold gain myICOR context through the same connection'],
      ['lock', 'OAuth in your browser. Keys stay on this machine and never reach git'],
    ]) {
      const row = points.createDiv({ cls: 'micor-hero-point' });
      setIcon(row.createDiv({ cls: 'micor-hero-point-icon' }), icon);
      row.createSpan({ text });
    }

    const btn = hero.createEl('button', { cls: 'micor-connect-btn', text: 'Connect to myICOR' });
    const note = hero.createDiv({ cls: 'micor-hero-note', text: 'Your browser will open for login and consent.' });
    const fallback = hero.createDiv({ cls: 'micor-auth-fallback' });
    btn.addEventListener('click', async () => {
      btn.setAttr('disabled', 'true');
      btn.setText('Waiting for your browser…');
      note.setText('Finish the login in the browser tab that just opened.');
      window.setTimeout(() => {
        if (!this.plugin.lastAuthUrl || fallback.hasChildNodes()) return;
        fallback.createSpan({ text: 'Browser did not open? ' });
        const link = fallback.createEl('a', { text: 'Open the login page', href: this.plugin.lastAuthUrl });
        link.addEventListener('click', (ev) => {
          ev.preventDefault();
          if (this.plugin.lastAuthUrl) openInSystemBrowser(this.plugin.lastAuthUrl);
        });
        fallback.createSpan({ text: ' or ' });
        const copy = fallback.createEl('a', { text: 'copy the link', href: '#' });
        copy.addEventListener('click', async (ev) => {
          ev.preventDefault();
          if (this.plugin.lastAuthUrl) {
            await navigator.clipboard.writeText(this.plugin.lastAuthUrl);
            new Notice('myICOR: login link copied — paste it into any browser.');
          }
        });
      }, 2500);
      try {
        await this.plugin.connect();
        await this.render();
      } catch (e) {
        btn.removeAttribute('disabled');
        btn.setText('Connect to myICOR');
        fallback.empty();
        note.setText('Connection failed: ' + e.message);
        note.addClass('is-error');
      }
    });
  }
}

/* ------------------------------------------------------------------------- *
 * Room dashboards — six vault-local dashboards, one per room. All metrics
 * are computed from the vault itself (files, frontmatter, mtimes): code
 * does the counting. No myICOR connection required.
 * ------------------------------------------------------------------------- */

class RoomDashboardView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.room = ROOMS[0].path;
  }

  getViewType() { return ROOM_VIEW_TYPE; }
  getDisplayText() {
    const room = roomFor(this.room);
    return room ? room.path.replace(/^\d+ /, '') : 'Room';
  }
  getIcon() { return 'gauge'; }

  getState() { return { room: this.room }; }
  async setState(state, result) {
    /* Workspace state stores a PATH, and a room can be renamed between two
     * launches. Matching on the number too means a rename reopens the room the
     * user left open instead of silently dropping them back to room 00. */
    const room = state && state.room ? roomFor(state.room) : null;
    if (room) this.room = room.path;
    await super.setState(state, result);
    this.renderRoom();
  }

  async onOpen() {
    this.root = this.contentEl;
    this.root.addClass('micor-dash');
    this.renderRoom();
  }

  /* ------------------------------------------------------- vault access -- */

  files(sub) {
    const prefix = this.room + (sub ? '/' + sub : '') + '/';
    return this.plugin.app.vault.getFiles().filter((f) => f.path.startsWith(prefix));
  }

  notes(sub) {
    return this.files(sub).filter((f) => f.extension === 'md' && f.name !== 'README.md' && f.name !== '_template.md');
  }

  fm(file) {
    const c = this.plugin.app.metadataCache.getFileCache(file);
    return (c && c.frontmatter) || {};
  }

  daysAgo(ms) {
    return Math.floor((Date.now() - ms) / 86400000);
  }

  ageText(ms) {
    const d = this.daysAgo(ms);
    if (d <= 0) return 'TODAY';
    if (d === 1) return 'YESTERDAY';
    return d + ' DAYS AGO';
  }

  openFile(file) {
    this.plugin.app.workspace.getLeaf(false).openFile(file);
  }

  /* ---------------------------------------------------------- rendering -- */

  renderRoom() {
    if (!this.root) return;
    this.root.empty();
    const room = roomFor(this.room) || ROOMS[0];

    const mast = this.root.createDiv({ cls: 'micor-masthead' });
    mast.createDiv({ cls: 'micor-masthead-kicker', text: room.kicker });
    const h1 = mast.createEl('h1', { cls: 'micor-masthead-title', text: room.title });
    const hand = h1.createSpan({ cls: 'micor-masthead-hand', text: room.hand });
    hand.setAttribute('aria-hidden', 'true');
    strokeEl(mast, 'micor-masthead-stroke');

    const body = this.root.createDiv({ cls: 'micor-page' });
    const fn = {
      scratchpad: () => this.renderScratchpad(body),
      inbox: () => this.renderInbox(body),
      wip: () => this.renderWip(body),
      inner: () => this.renderInner(body),
      assets: () => this.renderAssets(body),
      team: () => this.renderTeam(body),
    }[room.key];
    fn && fn();

    const footer = this.root.createDiv({ cls: 'micor-footer' });
    footer.createSpan({ text: 'COMPUTED LIVE FROM THE VAULT · ' + new Date().toLocaleTimeString() });
  }

  sect(body, kicker, bodyText) {
    const sec = body.createDiv({ cls: 'micor-sect in' });
    sec.createSpan({ cls: 'micor-sect-kicker', text: kicker });
    if (bodyText) sec.createDiv({ cls: 'micor-sect-body', text: bodyText });
    return sec;
  }

  slabBand(body) {
    return body.createDiv({ cls: 'micor-slabs micor-room-slabs' });
  }

  slab(band, value, small, label, marker) {
    const el = band.createDiv({ cls: 'micor-slab' + (marker ? ' is-marker' : '') });
    const b = el.createEl('b', { text: String(value) });
    if (small) b.createEl('small', { text: ' ' + small });
    el.createEl('span', { text: label });
  }

  fileRows(sec, files, opts) {
    const o = opts || {};
    if (!files.length) {
      sec.createDiv({ cls: 'micor-hand-note', text: o.empty || 'nothing here yet' });
      return;
    }
    const list = sec.createDiv({ cls: 'micor-gap-list' });
    for (const f of files) {
      const row = list.createDiv({ cls: 'micor-hit is-clickable micor-room-row' });
      const kicker = row.createDiv({ cls: 'micor-hit-kicker' });
      const rel = f.path.slice(this.room.length + 1);
      const folder = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')).toUpperCase() : null;
      const parts = [];
      if (o.kicker) parts.push(o.kicker(f));
      else {
        if (folder) parts.push(folder);
        parts.push(this.ageText(f.stat.mtime));
      }
      kicker.setText(parts.join(' · '));
      row.createDiv({ cls: 'micor-hit-title', text: o.title ? o.title(f) : f.basename });
      row.addEventListener('click', () => this.openFile(f));
    }
  }

  recent(files, n) {
    return [...files].sort((a, b) => b.stat.mtime - a.stat.mtime).slice(0, n || 6);
  }

  /* ------------------------------------------------------ 00 scratchpad -- */

  renderScratchpad(body) {
    const notes = this.notes();
    const daily = notes.filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(f.basename));
    const captures = notes.filter((f) => /^\d{14}(-\d+)?$/.test(f.basename));
    const processed = notes.filter((f) => this.fm(f).processed === true);
    const unprocessed = notes.filter((f) => this.fm(f).processed !== true);

    const band = this.slabBand(body);
    this.slab(band, unprocessed.length, null, 'waiting for processing', unprocessed.length > 0);
    this.slab(band, processed.length, null, 'processed and stamped');
    this.slab(band, daily.length, null, 'daily notes');
    this.slab(band, captures.length, null, 'quick captures');

    const todo = this.sect(body, 'NEEDS PROCESSING', unprocessed.length
      ? 'Unprocessed thought is invisible thought. Ask Larry to process the scratchpad.'
      : null);
    this.fileRows(todo, this.recent(unprocessed, 6), { empty: 'everything is stamped — clean desk' });

    const latest = this.sect(body, 'LATEST INK');
    this.fileRows(latest, this.recent(notes, 6), { empty: 'no notes yet — hit new note and write' });
  }

  /* ----------------------------------------------------------- 01 inbox -- */

  renderInbox(body) {
    const active = this.notes().filter((f) => !f.path.includes('/archive/'));
    const archived = this.notes().filter((f) => f.path.includes('/archive/'));
    const scanner = this.files('Scanner Inbox');
    const oldest = active.length ? Math.max(...active.map((f) => this.daysAgo(f.stat.ctime))) : 0;

    const band = this.slabBand(body);
    this.slab(band, active.length, null, 'waiting in the inbox', active.length > 0);
    this.slab(band, archived.length, null, 'processed and archived');
    this.slab(band, scanner.length, null, 'in the scanner inbox');
    this.slab(band, active.length ? oldest : '—', active.length ? (oldest === 1 ? 'day' : 'days') : null, 'oldest waiting');

    const waiting = this.sect(body, 'WAITING', active.length
      ? 'The inbox empties. Ask Larry to process what is here.'
      : null);
    this.fileRows(waiting, this.recent(active, 8), { empty: 'the inbox is empty — as it should be' });

    const arch = this.sect(body, 'RECENTLY ARCHIVED');
    this.fileRows(arch, this.recent(archived, 5), { empty: 'processed captures will land here' });
  }

  /* ------------------------------------------------------------- 02 wip -- */

  renderWip(body) {
    const root = this.plugin.app.vault.getAbstractFileByPath(this.room);
    const folders = ((root && root.children) || []).filter((c) => c.children && c.name !== '_archive');
    const archiveFolder = ((root && root.children) || []).find((c) => c.children && c.name === '_archive');
    const archivedCount = archiveFolder ? archiveFolder.children.filter((c) => c.children).length : 0;
    const benches = folders.map((dir) => {
      const files = this.plugin.app.vault.getFiles().filter((f) => f.path.startsWith(dir.path + '/'));
      const last = files.length ? Math.max(...files.map((f) => f.stat.mtime)) : 0;
      return { dir, files, last };
    }).sort((a, b) => b.last - a.last);
    const stale = benches.filter((b) => b.last && this.daysAgo(b.last) > 14);

    const band = this.slabBand(body);
    this.slab(band, benches.length, null, 'on the bench');
    this.slab(band, stale.length, null, 'stale over 14 days', stale.length > 0);
    this.slab(band, archivedCount, null, 'finished and archived');
    this.slab(band, this.files().length, null, 'files in play');

    const sec = this.sect(body, 'ON THE BENCH', benches.length ? null : undefined);
    if (!benches.length) {
      sec.createDiv({ cls: 'micor-hand-note', text: 'the bench is clear — start something' });
    } else {
      const list = sec.createDiv({ cls: 'micor-gap-list' });
      for (const b of benches) {
        const row = list.createDiv({ cls: 'micor-hit is-clickable micor-room-row' });
        const parts = [b.files.length + ' FILE' + (b.files.length === 1 ? '' : 'S')];
        if (b.last) parts.push('TOUCHED ' + this.ageText(b.last));
        if (b.last && this.daysAgo(b.last) > 14) parts.push('STALE');
        row.createDiv({ cls: 'micor-hit-kicker', text: parts.join(' · ') });
        row.createDiv({ cls: 'micor-hit-title', text: b.dir.name });
        row.addEventListener('click', () => {
          const newest = b.files.sort((x, y) => y.stat.mtime - x.stat.mtime)[0];
          if (newest) this.openFile(newest);
        });
      }
    }

    const latest = this.sect(body, 'RECENTLY TOUCHED');
    this.fileRows(latest, this.recent(this.notes(), 6), { empty: 'no work files yet' });
  }

  /* ----------------------------------------------------- 03 inner world -- */

  renderInner(body) {
    const journal = this.notes('Journal');
    const now = new Date();
    const monthPrefix = this.room + '/Journal/' + now.getFullYear() + '/' + String(now.getMonth() + 1).padStart(2, '0') + '/';
    const thisMonth = journal.filter((f) => f.path.startsWith(monthPrefix));
    const goals = this.notes('My Life/Goals');
    const achieved = goals.filter((f) => this.fm(f).status === 'achieved');
    const projects = this.notes('My Life/Projects');
    const activeProjects = projects.filter((f) => this.fm(f).status === 'active');
    const people = this.notes('Contacts/People');
    const companies = this.notes('Contacts/Companies');
    const reflections = this.notes('ICOR Journey Notes');

    const band = this.slabBand(body);
    this.slab(band, journal.length, null, 'journal entries');
    this.slab(band, thisMonth.length, null, 'entries this month', thisMonth.length > 0);
    this.slab(band, achieved.length, '/ ' + goals.length, 'goals achieved');
    this.slab(band, activeProjects.length, '/ ' + projects.length, 'projects active');
    this.slab(band, people.length + companies.length, null, 'contacts');
    this.slab(band, reflections.length, null, 'myicor reflections');

    const gsec = this.sect(body, 'GOALS');
    if (!goals.length) {
      gsec.createDiv({ cls: 'micor-hand-note', text: 'no goals yet — every project needs one' });
    } else {
      const list = gsec.createDiv({ cls: 'micor-gap-list' });
      for (const g of goals) {
        const done = this.fm(g).status === 'achieved';
        const row = list.createDiv({ cls: 'micor-hit is-clickable micor-room-row' });
        const k = row.createDiv({ cls: 'micor-hit-kicker' });
        k.createSpan({ cls: done ? 'micor-kicker-ok' : '', text: done ? 'ACHIEVED' : 'NOT ACHIEVED' });
        const linked = projects.filter((f) => {
          const goal = this.fm(f).goal;
          return goal && String(goal).includes(g.basename);
        });
        if (linked.length) k.createSpan({ text: ' · ' + linked.length + ' PROJECT' + (linked.length === 1 ? '' : 'S') });
        row.createDiv({ cls: 'micor-hit-title', text: g.basename });
        row.addEventListener('click', () => this.openFile(g));
      }
    }

    const psec = this.sect(body, 'ACTIVE PROJECTS');
    this.fileRows(psec, activeProjects, {
      empty: 'no active projects',
      kicker: (f) => {
        const m = this.fm(f);
        const parts = ['ACTIVE'];
        if (m.start_date) parts.push('SINCE ' + kickerDate(m.start_date));
        return parts.join(' · ');
      },
    });

    const latest = this.sect(body, 'LATEST INK');
    this.fileRows(latest, this.recent(this.notes(), 6));
  }

  /* ---------------------------------------------------------- 04 assets -- */

  renderAssets(body) {
    const images = this.files('Images');
    const audio = this.files('Audio');
    const docs = this.files('Documents');
    const allFiles = this.files().filter((f) => f.name !== 'README.md');
    const totalBytes = allFiles.reduce((a, f) => a + (f.stat.size || 0), 0);
    const mb = totalBytes / 1048576;
    const sizeText = mb >= 1024 ? (mb / 1024).toFixed(1) : mb >= 10 ? Math.round(mb) : mb.toFixed(1);

    const band = this.slabBand(body);
    this.slab(band, images.length, null, 'images');
    this.slab(band, audio.length, null, 'audio files');
    this.slab(band, docs.length, null, 'documents');
    this.slab(band, sizeText, mb >= 1024 ? 'GB' : 'MB', 'on the shelves');

    const latest = this.sect(body, 'LATEST ARRIVALS');
    this.fileRows(latest, this.recent(allFiles, 8), {
      empty: 'attachments land here automatically',
      kicker: (f) => {
        const rel = f.path.slice(this.room.length + 1);
        const folder = rel.includes('/') ? rel.slice(0, rel.indexOf('/')).toUpperCase() : 'ASSETS';
        const kb = (f.stat.size || 0) / 1024;
        const size = kb >= 1024 ? (kb / 1024).toFixed(1) + ' MB' : Math.max(1, Math.round(kb)) + ' KB';
        return folder + ' · ' + size + ' · ' + this.ageText(f.stat.mtime);
      },
      title: (f) => f.name,
    });

    const largest = this.sect(body, 'HEAVIEST FILES');
    const big = [...allFiles].sort((a, b) => (b.stat.size || 0) - (a.stat.size || 0)).slice(0, 5);
    this.fileRows(largest, big, {
      empty: 'nothing heavy yet',
      kicker: (f) => {
        const kb = (f.stat.size || 0) / 1024;
        return kb >= 1024 ? (kb / 1024).toFixed(1) + ' MB' : Math.max(1, Math.round(kb)) + ' KB';
      },
      title: (f) => f.name,
    });
  }

  /* --------------------------------------------------------- 05 ai team -- */

  renderTeam(body) {
    const agentsRoot = this.plugin.app.vault.getAbstractFileByPath(this.room + '/Agents');
    const agents = ((agentsRoot && agentsRoot.children) || []).filter((c) => c.children);
    const kb = 'AI Team Knowledge';
    const open = this.notes(kb + '/Tasks/open');
    const inProgress = this.notes(kb + '/Tasks/in-progress');
    const done = this.notes(kb + '/Tasks/done');
    const now = new Date();
    const monthPath = this.room + '/' + kb + '/Tasks/done/' + now.getFullYear() + '/' + String(now.getMonth() + 1).padStart(2, '0') + '/';
    const doneThisMonth = done.filter((f) => f.path.startsWith(monthPath));
    const sops = this.notes(kb + '/SOPs');
    const workstreams = this.notes(kb + '/Workstreams');
    const guidelines = this.notes(kb + '/Guidelines');
    const logs = this.notes(kb + '/Session Logs');
    const journals = agents.flatMap((a) =>
      this.plugin.app.vault.getFiles().filter((f) => f.path.startsWith(a.path + '/Journal/') && f.extension === 'md'));

    const band = this.slabBand(body);
    this.slab(band, open.length, null, 'tasks open', open.length > 0);
    this.slab(band, inProgress.length, null, 'in progress');
    this.slab(band, doneThisMonth.length, '/ ' + done.length, 'done this month');
    this.slab(band, agents.length, null, 'agents on the roster');
    this.slab(band, sops.length + workstreams.length + guidelines.length, null, 'sops, workstreams, guidelines');
    this.slab(band, logs.length, null, 'session logs');

    const rsec = this.sect(body, 'THE ROSTER', 'Who is on the team, and what each of them does.');
    const col = rsec.createDiv({ cls: 'micor-roster' });
    const ordered = [...agents].sort((a, b) =>
      (a.name === 'Larry' ? -1 : b.name === 'Larry' ? 1 : a.name.localeCompare(b.name)));
    for (const a of ordered) {
      const agentMd = this.plugin.app.vault.getAbstractFileByPath(a.path + '/AGENT.md');
      const cache = agentMd ? this.plugin.app.metadataCache.getFileCache(agentMd) : null;
      const fm = (cache && cache.frontmatter) || {};
      const row = col.createDiv({ cls: 'micor-roster-row' });
      const av = row.createDiv({ cls: 'micor-roster-avatar' });
      const avatarFile = this.plugin.app.vault.getAbstractFileByPath(
        this.room + '/AI Team Knowledge/Avatars/' + a.name.toLowerCase() + '.png');
      if (avatarFile) {
        const img = av.createEl('img');
        img.src = this.plugin.app.vault.getResourcePath(avatarFile);
        img.alt = a.name;
      } else {
        av.createSpan({ cls: 'micor-roster-initial', text: (fm.name || a.name).slice(0, 1).toUpperCase() });
      }
      const txt = row.createDiv({ cls: 'micor-roster-text' });
      const head = txt.createDiv({ cls: 'micor-roster-head' });
      head.createSpan({ cls: 'micor-roster-name', text: fm.name || a.name });
      if (fm.role) head.createSpan({ cls: 'micor-roster-role', text: fm.role });
      const desc = txt.createDiv({ cls: 'micor-roster-desc' });
      if (agentMd) {
        this.plugin.app.vault.cachedRead(agentMd).then((s) => {
          const m = /## Mission\s*\n+([\s\S]*?)(?=\n#|\n---|$)/.exec(s);
          if (m && desc.isConnected !== false) {
            desc.setText(m[1].trim().replace(/\s+/g, ' ')
              .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1'));
          }
        }).catch(() => {});
        row.addEventListener('click', () =>
          this.plugin.app.workspace.getLeaf('tab').openFile(agentMd));
      }
    }

    const tsec = this.sect(body, 'OPEN TASKS', open.length
      ? 'What the team owes. Ask Larry to pick one up.'
      : null);
    this.fileRows(tsec, this.recent(open, 8), {
      empty: 'no open tasks — the board is clean',
      title: (f) => f.basename.replace(/^(tsk-)?\d{4}-\d{2}-\d{2}-?\d*-?/, '').replace(/-/g, ' ') || f.basename,
    });

    const lsec = this.sect(body, 'RECENT SESSION LOGS');
    this.fileRows(lsec, this.recent(logs, 5), { empty: 'session logs land here after every session' });

    const perf = this.sect(body, 'TEAM ACTIVITY');
    const recentJournals = this.recent(journals, 5);
    this.fileRows(perf, recentJournals, {
      empty: 'agent journals appear as the team works',
      kicker: (f) => {
        const agent = f.path.split('/')[2] || '';
        return agent.toUpperCase() + ' · ' + this.ageText(f.stat.mtime);
      },
    });
  }
}

module.exports = MyicorConnectPlugin;
