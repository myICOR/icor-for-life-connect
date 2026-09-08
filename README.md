# ICOR for Life - Connect

Your app.myicor.com account, inside your vault. Connect once on the
desktop and your ICOR Journey, your Growth Assignments, your courses and
the Inner Circle knowledge base sit next to your notes, instead of behind
a browser tab. Where the keys of that connection live, and whether one
connection follows the vault to every device, is one setting; see "Where
your keys live" below.

**Beta release.** This plugin works and is in daily use in a real vault,
but you will find rough edges. If something looks off, open an issue on
this repo and it gets fixed fast.

## What it does

1. **The ICOR Journey dashboard.** A myICOR button sits at the bottom of
   the file explorer; the dot next to it shows connection state. It opens
   a dashboard view: ICOR Journey stage and milestones drawn on the Loop,
   Growth Assignment progress and average score, reflections, streaks, and
   per-category rollups. All colors ride INKLINE theme tokens, so light
   and dark both work with zero plugin palette.
2. **Knowledge-base search and courses.** A search bar over the whole
   Inner Circle knowledge base (lessons, resources, founder answers);
   every hit deep-links into the app. A Courses card shows per-course
   progress; expanding a course loads the lesson list with per-lesson
   completion, each lesson clickable. Deep links honor the vault's Web
   Viewer preference: in-app when the core plugin is on, system browser
   when it is off.
3. **Room dashboards.** A gauge button on each room in the file tree
   opens that room's dashboard: the Scratchpad, the Inbox, WiP, the Inner
   World, Assets and the AI Team, each with the counts and recent files
   that answer "what is going on in this room". Every number is computed
   from your own files, so these work with no myICOR connection at all.
4. **The team roster.** The AI Team dashboard lists who is on your team
   and what each of them does, read from their own contracts, alongside
   open tasks, tasks in progress, what was finished this month, recent
   session logs, and the journals the team wrote as it worked.
5. **Reflection sync.** The ICOR Journey Notes card (and the command "Sync
   myICOR reflections into Inner World") pulls your growth assignment
   reflections into `04 Inner World/ICOR Journey Notes/`, one note per
   reflection, answer verbatim, with structured frontmatter.
   CREATE-ONLY: a synced note is never touched again, so you can edit and
   wikilink it freely.
6. **Claude context.** On connect, the plugin registers the myICOR MCP
   server in the vault-root `.mcp.json` (URL only, never a token). Claude
   sessions running inside this vault can then search myICOR lessons,
   resources, founder answers, and session recordings. The first Claude
   session approves the server once via `/mcp`.
7. **Browser OAuth.** If the vault is not connected, the plugin opens the
   default browser for login and consent (OAuth 2.1 + PKCE against the
   official myICOR MCP server, `https://app.myicor.com/api/mcp`). The
   callback lands on a temporary local loopback server; nothing listens
   after the flow finishes.

## What makes it different

Most companion plugins mirror an app inside a pane. Connect moves the
parts of your membership that belong in a PKM into the PKM itself: your
reflections become real markdown notes you own and can link, the
knowledge base answers from inside the vault, and the Claude sessions
running in this vault learn your myICOR context. One desktop connect,
and it follows the vault everywhere.

## Account, membership and network use (disclosure)

- An account is required for the myICOR features: the Journey dashboard,
  search, courses, reflection sync and Claude context all require a
  myICOR account at app.myicor.com.
- A free myICOR account unlocks the core features: connect,
  knowledge-base search, and the dashboards where your data exists.
  Access to gated Inner Circle content requires a paid myICOR
  membership.
- The room dashboards and the team roster read your vault only, and work
  whether you are connected or not.
- Network use: the plugin talks to exactly one service, app.myicor.com
  (OAuth 2.1 + PKCE sign-in and the myICOR MCP API at
  https://app.myicor.com/api/mcp), to read your ICOR Journey, Growth
  Assignments, courses, knowledge-base search results and reflections.
  No telemetry, no other endpoints. When not connected, the plugin makes
  no network requests.

## Where your keys live

Connect holds two keys for your account, the OAuth access token and the
refresh token. Where they live is one setting, "Keys are stored in", in
the plugin's settings tab:

- **Obsidian's keychain** (Settings, General, Keychain): the default on
  Obsidian 1.11.4 and newer. The keys stay on this device, outside the
  vault, encrypted by Obsidian; Obsidian Sync does not carry them and no
  sync tool sees them, so every device connects on its own. On a Linux
  desktop without a wallet Obsidian keeps them in plain text and says so
  itself. The keychain is shared by every plugin, which is why Connect's
  entries carry its name: `icor-for-life-connect-access-token` and
  `icor-for-life-connect-refresh-token`.
- **An env file in the vault**: the only choice on older Obsidian, and
  the choice when one connection should follow the vault to every device.
  The keys are two `KEY=value` lines, `MYICOR_ACCESS_TOKEN` and
  `MYICOR_REFRESH_TOKEN`, in the file named by the "Env file" setting
  (default `06 AI Team/AI Team Knowledge/.env`, vault-relative). The
  plugin reads plain `KEY=value` lines and `#` comments, no quotes, no
  interpolation, first occurrence of a key wins. When it writes, it
  changes or appends those two lines and leaves every other byte of the
  file alone. The file rides with the vault, so it is in every backup and
  sync of the vault; the plugin adds its path to the vault's `.gitignore`
  the way it always did for `data.json`.

`data.json` keeps only the scope and the expiry time, never a key. A vault
that connected with an older Connect has its keys moved out of `data.json`
into the chosen backend the first time this version loads, once, and never
back. Switching the setting moves nothing by itself: the settings tab shows
for each key where a value exists and offers "Move to ..." when it sits in
the other backend. Only the selected backend is read at runtime; a key
that sits in the other one counts as not set, on purpose, so a wrong
setting shows up instead of hiding behind a working login.

The two fields in the settings tab also take a key pasted by hand, for
carrying a connection to a device that cannot run the browser sign-in.
The field is cleared as soon as the key is saved, and no key ever appears
in a notice or a log.

## Security

- Keys live only in the selected backend (see "Where your keys live");
  `data.json` never holds one. Two independent guards keep `data.json` and
  the env file out of git: the lines in the vault's `.gitignore`, and the
  plugin re-asserting them on every load before a key can ever be saved.
- `.mcp.json` receives the server URL only. Claude runs its own OAuth.
- Access tokens expire after 15 minutes; the plugin refreshes silently with
  rotating refresh tokens. Disconnect drops both keys on the spot.

## No build step

`main.js` is hand-written, dependency-free JavaScript: the plugin is plain
text on disk, reviewable by anyone, buildable by no one.

## Install

Requires Obsidian 1.4.0 or newer.

- **From Obsidian:** Settings, Community plugins, Browse, search "myICOR
  Connect", install, enable.
- **Manually:** copy `main.js`, `manifest.json` and `styles.css` from the
  latest release into `.obsidian/plugins/icor-for-life-connect/` and enable the
  plugin.

Then click the myICOR button at the bottom of the file explorer to
connect.

## On mobile

The dashboards, search and courses work on phone and tablet. The one-time
OAuth connect needs the desktop app (the browser callback lands on a local
loopback server). Whether that one connect reaches your phone depends on
where the keys live: with the env file, the connection follows the vault to
every device; with Obsidian's keychain, each device keeps its own keys and
Obsidian Sync does not carry them, so a phone is connected by pasting the
refresh token into its settings tab, or by switching to the env file.

## Releasing

A release is cut only when a version tag is pushed. A plain push to `main`
never releases anything.

1. Bump the version in 3 files: `manifest.json`, `versions.json` (new line, same `minAppVersion`) and `package.json`.
2. Push to `main`. Nothing ships yet.
3. Flint reads the diff before ship. No read, no tag.
4. Tag the commit with the bare version and push the tag:
   `git tag -a 0.14.1 -m "ICOR for Life - Connect 0.14.1" && git push github 0.14.1`
   (never `v0.14.1`: the Obsidian directory reads the tag as the version).

The Release workflow refuses a tag that does not equal `manifest.json`'s
version or that is not on `main`, then publishes `main.js`, `manifest.json` and `styles.css` with the commit subjects since the previous tag as notes.
The nightly version gate still checks that tag, branch and release agree.

## ICOR for Life Obsidian Edition

ICOR for Life - Connect is the bridge of the **ICOR for Life Obsidian Edition**:
ICOR (Input, Control, Output, Refine), the productivity methodology by
Paperless Movement / myICOR, implemented as a ready-to-use Obsidian
vault. The vault is where you run the method; the courses on myicor.com
are where you learn it; Connect is where the two meet.
Best to be used in combination with:

- **[ICOR for Life - INKLINE theme](https://community.obsidian.md/themes/icor-for-life-inkline)**,
  the hand-drawn ICOR look every surface of the Edition is designed
  against. The Connect dashboards have no palette of their own; with
  INKLINE installed their cards render hand-drawn in ink and paper mode
  alike.
- **[ICOR for Life - Planner](https://obsidian.md/plugins?id=icor-for-life-planner)**, the weekly
  planning board: Todoist, ClickUp, starred email and Google Calendar
  synced into the vault, planned by drag and drop. The ICOR Journey
  teaches the weekly practice; the Planner is where you run it, week
  after week.
- **[ICOR for Life - Focus](https://obsidian.md/plugins?id=icor-for-life-focus)**, the gravity map
  of your vault: what you touched today sits close, older work ripples
  outward. The Journey builds the habits; Focus shows whether they are
  holding.
- **[ICOR for Life - Diagrams](https://obsidian.md/plugins?id=icor-for-life-diagrams)**, a
  fullscreen viewer with zoom and pan for the mermaid diagrams in your
  notes, including the ones the lessons ask you to draw.
- **[ICOR for Life - Chat](https://obsidian.md/plugins?id=icor-for-life-chat)**, your AI team
  in a tab beside your notes, working from your vault's own instructions.
  The Journey teaches the method; the team helps you apply it to the notes
  in front of you.

The complete, preconfigured experience (theme, all plugins, the seven-room
vault structure and the AI team) ships free as the **ICOR for Life**
vault: https://myicor.com

## License

What you can do: install it, run it, read the code, modify your own copy,
and use it in your own business. What you cannot do: sell it, redistribute
it, or offer it (original or modified) as your own product or service to
others. Contributions: send a pull request. See `CONTRIBUTING.md`;
submitting one grants Paperless Movement the rights described in Section 7
of the LICENSE. This is not open source. It is source-available: the code
is visible, personal and business use are free, resale and republishing
are not. Bundled third-party components keep their own licenses; see
`THIRD-PARTY-NOTICES.md`.

Full text in LICENSE. Machine-readable identifier: LicenseRef-ICOR-Source-Available-1.0.
