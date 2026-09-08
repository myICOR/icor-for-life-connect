# Changelog

All notable changes to ICOR for Life - Connect.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [Semantic Versioning](https://semver.org/).
Releases before 0.15.0 are described by their release notes on GitHub.

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
