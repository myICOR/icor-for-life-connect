# Changelog

All notable changes to ICOR for Life - Connect.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [Semantic Versioning](https://semver.org/).
Releases before 0.15.0 are described by their release notes on GitHub.

## [0.18.4] - 2026-11-23

### Changed
- Connect no longer writes into the file explorer's button row. Up to 0.18.3 it put two classes on Obsidian's row for a theme rule that INKLINE 1.9.0 dropped; ICOR Interface 0.11.0 now decides whether the row shows. A row an older build marked is cleaned on load. **Collapse all folders** in the command palette still presses Obsidian's own button.

## [0.18.3] - 2026-11-23

### Changed
- The display name is now ICOR Connect (it was ICOR for Life - Connect). The plugin id stays `icor-for-life-connect`, so installed vaults, settings and hotkeys carry on unchanged.

## [0.18.2] - 2026-11-23

### Changed
- **The myICOR dashboard has an icon in the ribbon on the left.** The gauge
  opens it, like the **myICOR** button at the bottom of the file explorer and
  **Open myICOR dashboard** in the command palette. Like any ribbon icon, you
  can move or hide it in Settings, Appearance, Ribbon menu.

### Removed
- **The four icons under the logo.** Today's daily note, New unique note, New
  canvas in Daily Notes and Open graph view no longer sit in the file
  explorer's row of icons (Tom, 2026-11-23: every plugin's launcher moves to
  Obsidian's own ribbon). All four stay as commands, and Obsidian's own Daily
  notes, Unique note creator, Canvas and Graph view plugins have ribbon icons
  of their own. An update while Obsidian is open takes the old icons away.

## [0.18.1] - 2026-11-23

Ready for the Obsidian community directory's review.

### Fixed
- **Keys stay in Obsidian's keychain, and no more random sign-outs** (the
  0.17.0 fixes below, now in this line too): Connect needs Obsidian 1.11.4.
- **Signing in no longer uses a desktop-only module.** The PKCE values are
  made with the browser's own Web Crypto instead of Node's `crypto`.
- **The page your browser shows after signing in** escapes the error text it
  repeats from the address bar.
- **A `.mcp.json` that is not valid JSON is left as it is.** Connecting Claude
  used to replace it, losing your other servers; Connect now says so and
  stops. A valid file keeps every other server.

### Changed
- **Reflections are written through Obsidian's vault**, not straight to the
  disk, like every other note.
- The myICOR marks are drawn as elements, never set as an HTML string.
- README: what Connect writes at the top of your vault (`.mcp.json`,
  `.gitignore`).

## [0.18.0] - 2026-11-23

### Changed
- **Folders, grouped by ICOR stage.** ICOR for Life 3.0 renumbers the vault's
  folders and groups them by stage. Every folder dashboard now opens with the
  folders by stage, in order: Input (`00 Daily Notes`, `01 Inbox`), Control
  (`02 Inner World`, `03 Outer World`, `04 Assets`, `05 Databases`) and Output
  (`06 Planner`). Refine has no folder; one line says that the AI and the
  plugins refine from outside, the way any tool would, and so does your weekly
  review. Each dashboard's heading names its stage and folder ("CONTROL ·
  02 INNER WORLD"), and a click on another folder opens its dashboard in the
  same tab. A folder the vault does not have is shown dimmed and does nothing.
- **"Room" is gone from everything you read.** The dashboards, the notice
  about a missing folder and the old keys file row all say "folder".
- **Folders are matched by their full name, never by their number.** 3.0
  reuses numbers (`04` is now Assets, and a 2.x vault's `06 AI Team` shares its
  06 with `06 Planner`), so a number no longer says which folder it is. Each
  folder is found by its 3.0 name first, then by the name a 2.x vault uses
  (`00 Daily Scratchpad`, `04 Inner World`, `05 Assets`, `06 Outer World`,
  `07 Databases`, `02 Planner`). A vault that has not moved to 3.0 keeps every
  dashboard, and nothing ever binds to `03 WiP` or `06 AI Team`. A folder you
  renamed yourself is no longer found by its number.
- **Reflections sync into `02 Inner World/ICOR Journey Notes`**, or into
  `04 Inner World/ICOR Journey Notes` in a 2.x vault: always the Inner World
  the vault has, never another folder that happens to carry its old number.
- **"New canvas in Daily Notes"** (was "New canvas in the Daily Scratchpad")
  files the canvas in `00 Daily Notes/YYYY/MM/`, or in `00 Daily Scratchpad/`
  while a 2.x vault still has it. The command keeps its id, so a hotkey you
  set still works.
- A dashboard left open before the update reopens on the same folder under
  its new name.
- The connect screen says "Claude sessions in this vault".

### Added
- **Dashboards for `05 Databases` and `06 Planner`:** how many files or
  notes, how many changed this week, and the latest changes.

## [0.17.0] - 2026-11-20

### Changed
- **The env file's default place is `.icor-for-life/.env`.** The ICOR for Life
  vault no longer has the `06 AI Team` room, so the keys file moved to the
  vault's hidden system folder, the same file ICOR for Life - Planner and AI
  Chat read. Obsidian does not index a folder whose name starts with a dot, so
  Connect reads and writes it through the vault adapter only, as before. The
  system folder is made on the first write when it is missing. This only
  matters with the env file as the backend; where Obsidian's keychain exists it
  is still the default.
- **Existing vaults stay connected.** The old default path in `data.json` now
  reads as the new one. While `.icor-for-life/.env` is missing and
  `06 AI Team/AI Team Knowledge/.env` is there, Connect reads and writes the old
  file. Once, at start, it offers to copy the file to the new place; the
  settings tab keeps an "Old keys file" row with the same button. The copy is
  byte for byte and is read back before it is used. The old file is never
  deleted by itself: once the new file exists, the same row offers to move the
  old one to the trash.
- While the old file is the one in use, the vault's `.gitignore` covers both it
  and the new place. No value is ever logged or shown; every new sentence names
  paths only.

### Fixed
- **Keys stay in Obsidian's keychain.** Connect now needs Obsidian 1.11.4 or
  newer, the first with Obsidian's own keychain. On older versions it used to keep keys in
  plain text without saying so. The env file is still there for a member who
  chooses it in settings.
- **No more random sign-outs.** The dashboard makes several calls at once;
  with an expired sign-in each refreshed it with the same one-time refresh
  token, the server refused all but the first, and any refusal signed you
  out. Calls now share one refresh. Connect also signs you out only when
  myICOR says the sign-in is no longer valid: a busy server, a rate limit or
  no network keeps you connected and asks you to try again.

### Added
- **The Outer World dashboard (room 06).** ICOR for Life 3.0 has a room for
  what others made: one note per book, article, video, podcast, post or paper
  (`type: source`), from the Web Clipper, Readwise or by hand. Its dashboard
  counts your sources, the reading queue (`consumed: false`), what you captured
  this month and how many link to a project, a Key Element or a topic, and
  lists the queue, the sources not connected yet and the latest arrivals. A
  vault without the room is not told it is missing, and the dashboard never
  attaches to an old `06 AI Team` folder.

### Changed
- **The myICOR dashboard is your Home.** Connect's main view now shows the Home
  of app.myicor.com in INKLINE's current look, instead of the old ICOR Journey
  loop. At the top: the day, "Find your way back to clear" and where you left
  off as one line (your next lesson). Then:
  - the newest video, article and podcast from Tom and Paco;
  - one lit card for each product on the roadmap (ICOR Kickstart, ICOR Journey,
    ICOR Teams, ICOR AI, ICOR Coaching, ICOR Build), each with its drawn mark,
    its light and your progress where myICOR shares it. The Journey card counts
    your four journey courses, Teams counts ICOR Teams and Build counts the
    lessons you built. A card without a number says where its progress is,
    never a guess;
  - your mentions and replies, events and the week's poll, as links that open
    app.myicor.com;
  - in this vault: the reflections sync, the knowledge search and Claude's
    connection.
- **One bar for the dashboard:** Home, Search, Library and Announcements,
  with the open, refresh and disconnect buttons beside them.
  Labels use the body font; monospace is gone. Every button and field has one
  edge: the dashboard tells the INKLINE theme to leave its controls alone
  (`data-ink-plugin`).
- The Library page uses the Home's library cards. Search has one field with a
  focus ring instead of an orange underline. Announcements keeps its one orange
  button and loses the hand-drawn stroke and the orange labels.
- No light spreads across the top of the view; a place shows its light on its
  own card.

### Removed
- **Trend reports.** The Trend reports page, its data and its styles are gone
  from Connect; the reports stay on app.myicor.com.
- **The ICOR Journey loop page** (the loop gauge, the path through the
  courses, the slabs, the Growth Assignment gaps) and its styles. Opening
  "overview" opens Home.
- **The WiP dashboard (room 03).** Work in progress now happens with your AI
  agents, outside the vault, and only finished work comes in, so ICOR for Life
  3.0 has no `03 WiP`. Its dashboard is gone, and a vault without the room is
  not told it is missing.
- **The AI Team dashboard (old room 06).** The vault no longer has the
  `06 AI Team` room, so its dashboard (the roster, open tasks, session logs and
  team activity) and its styles are gone.

## [0.16.2] - 2026-11-02

### Fixed
- **"New note" button respects Interface's "Obsidian's own file controls" toggle.**
  The stylesheet's rule that hides the "New note" button now only fires when
  ICOR scaffold chrome is active (`body.icor-scaffold-chrome`). Interface 0.8.0
  introduced "Obsidian's own file controls" as a user toggle that promises to
  restore all four controls (vault switcher, New folder, sort, and New note).
  The rule was unconditional with `!important`, so the New note button stayed
  hidden even when the user chose Obsidian's own controls. It now shows when
  that toggle is on, matching the pattern INKLINE already follows. This
  completes the Interface promise: the lesson says "Choose 'Obsidian's own
  file controls' to bring back the vault switcher, New folder, New note, and
  sort controls", and all four now come back.
- A test now holds every selector that reaches the New note button to
  `body.icor-scaffold-chrome`.

## [0.16.1] - 2026-09-26

### Fixed
- **The room 00 dashboard counts your quick captures again.** The "quick
  captures" slab read 0 in every vault that follows the Scaffold's naming
  rule, because it only counted a note named with fourteen bare digits.
  It now counts the capture names the Scaffold's own check accepts,
  `YYYYMMDDHHmm` and `YYYY-MM-DD-HHmmss`, each with its collision suffix,
  and still counts the fourteen-digit shape, so no existing count drops.
  Captures inside `YYYY/MM/` folders are counted too. Thanks to Ian
  Slattery (@ipslatte) for the fix (#4, closes #3).
- **"New canvas in the Daily Scratchpad" files the canvas in `YYYY/MM/`.**
  The command wrote the canvas to the root of `00 Daily Scratchpad/`,
  which the Scaffold's check reports as misplaced. It now writes
  `00 Daily Scratchpad/YYYY/MM/YYYY-MM-DD_canvas.canvas` for your local
  day, creates the year and month folders when they are missing, and keeps
  the `-2` suffix for a second canvas on the same day. In a vault with no
  Daily Scratchpad room yet, the command now creates it instead of
  failing. Thanks to Ian Slattery (@ipslatte) for the fix (#2, closes #1).

## [0.16.0] - 2026-09-21

### Changed
- Relicensed under MIT. Releases before 0.16.0 remain under the ICOR for Life
  Source-Available License (Code) v1.0.

## [0.15.1] - 2026-09-17

### Fixed
- **"Auto-reveal current file" is back in the file-explorer toolbar.** The
  plugin's stylesheet was hiding it. Auto-reveal is Obsidian's own switch for
  "always show me where the note I am reading sits in the folder tree", and
  it lives as a button in the toolbar above the tree. One rule in
  `styles.css` named two controls at once, "Reveal current file" and
  "Auto-reveal current file", and hid both. Only the first one has another
  way in (the command `file-explorer:reveal-active-file`, reachable from the
  command palette). The second has none: Obsidian registers eight
  `file-explorer:` commands and not one of them flips auto-reveal, so hiding
  the button did not move the setting somewhere else, it took the setting
  away. It is visible again, and nothing else on that toolbar changed.
- The repo's only-route gate now covers it, so the rule cannot come back
  unnoticed. The gate was seen red on the shipped stylesheet first, pointing
  at the exact line, and green after the line came out.
- **"New note" stays hidden under a non-English Obsidian.** That rule matched
  the button by its English label only, so on a German or French interface
  the button was still there. It now also matches the button's icon, which
  does not change with the language.

### Removed
- A hide rule for a "Reveal current file" button that no version of Obsidian
  puts on this toolbar. It matched nothing, and dead rules carrying a
  justification are how the auto-reveal problem above started.

## [0.15.0] - 2026-09-08

### Changed
- Keys move to Obsidian secret storage. The access token and the refresh
  token leave `data.json` for Obsidian's keychain (Settings, General,
  Keychain; Obsidian 1.11.4 or newer) under the ids
  `icor-for-life-connect-access-token` and
  `icor-for-life-connect-refresh-token`. A vault that connected with an
  older Connect has its keys moved out of `data.json` the first time this
  version loads, once, and never back. `data.json` keeps the scope and
  the expiry time only.
- The keychain is per device and Obsidian Sync does not carry it, so a
  connection made on the desktop no longer reaches a phone by itself.
  The mobile notice says so and names the way out: the env file where
  the sync carries hidden files (iCloud Drive, git and Dropbox do;
  Obsidian Sync skips files whose name starts with a dot), or a pasted
  refresh token.
- The env file writer refuses a value with a line break, never appends
  an empty `MYICOR_*=` line for a key the file does not have, and the
  keychain is never given an empty entry on disconnect. The env file
  path is checked (vault-relative, no `..`, no absolute path) and is
  committed when the field settles, not per keystroke.

### Added
- A settings tab, "Where your keys live": one dropdown, "Keys are stored
  in", with Obsidian's keychain (the default where it exists) or an env
  file in the vault; an "Env file" path setting, default
  `06 AI Team/AI Team Knowledge/.env`; and one row per key showing where
  a value exists, a password field to paste a key by hand (cleared after
  Save), and a "Move to ..." button when the key sits in the other
  backend. Only the selected backend is read at runtime; no fallback.
- The env file backend: the keys `MYICOR_ACCESS_TOKEN` and
  `MYICOR_REFRESH_TOKEN` as plain `KEY=value` lines. The reader takes
  `#` comments and no quotes; the writer changes or appends those two
  lines and leaves every other byte of the file as it was. The path is
  added to the vault's `.gitignore` the way `data.json` always was.
- `test/secrets.test.mjs`: the env parser and writer (byte-identical rest
  of file, idempotent, comments untouched), the migration against a
  `data.json` fixture into both backends, the no-fallback rule, and the
  settings tab's password inputs, clearing and move buttons.

### Fixed
- No key ever appears in a notice or in the console, not even masked; a
  gate now reads the source for that.
- The Overview's loop percent ("Your loop is X% drawn", the gauge and
  the rail ink) and its "Courses closed n of m" now come from the
  server's `get_my_journey` (`loop_percent`, `courses_completed`) and
  match the Your Loop page in the app, reported in the Connect channel
  2026-09-08 as 15% here against 98% there. The mean of the journey
  courses' progress stays as the fallback for a server without the
  field, written once for both places that draw it.
