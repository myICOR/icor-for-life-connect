# Changelog

All notable changes to ICOR for Life - Connect.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [Semantic Versioning](https://semver.org/).
Releases before 0.15.0 are described by their release notes on GitHub.

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
