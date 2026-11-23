# ICOR Connect

**Your myICOR membership, next to your notes.**

Connect once and your ICOR Journey, your Growth Assignments, your courses and
the Inner Circle knowledge base sit inside your vault instead of behind a
browser tab.

Part of the [ICOR for Life](https://myicor.com) suite. Needs a myICOR account.

## What it is for

The method and the notes belong together. When the course is in one window
and your vault is in another, you learn a thing in the first and then have to
carry it by hand into the second.

With this, the lesson and the note you are writing about it are in the same
place. Search the knowledge base without leaving what you are working on. See
where you actually are on the Journey without opening a browser.

## Getting started

1. Enable the plugin on desktop.
2. Click the **myICOR** button at the bottom of the file explorer and connect
   your account. The dot next to the button shows the connection state.

That is the setup. Your dashboard opens from the same button, or from the
gauge icon in the ribbon on the left (move or hide it in Settings,
Appearance, Ribbon menu).

Today's daily note, a new unique note, a new canvas in `00 Daily Notes` and
the graph view are commands: run them from the command palette or give them
a hotkey.

## What you get

**Your myICOR Home, inside the vault.** The Home of app.myicor.com: where you
left off, the newest videos, articles and podcasts from Tom and Paco, and one
card for each part of the roadmap (ICOR Kickstart, ICOR Journey, ICOR Teams,
ICOR AI, ICOR Coaching and ICOR Build) with your progress where myICOR can
share it. Your mentions, events and the week's poll open on app.myicor.com.

**Knowledge-base search.** The Inner Circle library, searchable from inside
the vault.

**Your reflections as notes.** They sync into your vault as ordinary notes
that you own, in `02 Inner World/ICOR Journey Notes` (`04 Inner World/` in a
vault made before ICOR for Life 3.0).

**A dashboard for every folder.** Hover a folder and click the gauge. Each
dashboard counts what is in the folder, computed live from the vault, and
opens with your folders grouped by ICOR stage: Input (`00 Daily Notes`,
`01 Inbox`), Control (`02 Inner World`, `03 Outer World`, `04 Assets`,
`05 Databases`) and Output (`06 Planner`). Refine has no folder: the AI and
the plugins refine from outside, and so does your weekly review. A vault made
before 3.0 keeps its dashboards under its old folder names.

**Courses and lessons**, reachable without a browser tab.

Colours follow the INKLINE theme, so light and dark both look right.

## Where your keys live

One setting decides whether the connection stays on this device or follows
the vault to every device you sync. Pick the one that matches how you work;
the setting explains both in plain words before you choose.

If you choose the file, it is `.icor-for-life/.env`, in the vault's hidden
system folder, the same file ICOR Planner and AI Chat use. Obsidian's
file list does not show that folder. A vault that still keeps the file in its
old place stays connected: Connect reads it there, and offers once to copy it
to the new place. The old file stays until you remove it.

## What it touches

- **Talks to app.myicor.com** to fetch your own membership data. That is the
  point of the plugin, and it is the only place it connects to.
- **Writes your reflections into your vault** as notes you own, in
  `02 Inner World/ICOR Journey Notes`, and a new canvas into
  `00 Daily Notes/YYYY/MM/` when you ask for one.
- **Stores your connection keys** where the setting above says.
- **Adds myICOR to `.mcp.json`** at the top of your vault when you connect
  Claude, so the Claude sessions in this vault can search myICOR too. Your
  other servers in that file stay as they are; a file that is not valid JSON
  is left alone and Connect says so.
- **Lists its settings file in `.gitignore`** at the top of your vault (and
  the env file, while your keys live there), creating `.gitignore` if the
  vault has none, so a vault kept in git never carries a key.

## Good to know

- **Connect on desktop first.** Mobile uses the connection you made there.
- **A myICOR account is required.** Without one the plugin has nothing to
  show.
- **Beta.** In daily use in a real vault, and you will find rough edges. If
  something looks off, open an issue.

## Support

What myICOR supports: the plugin as published in a tagged release, on the
current version, installed from that release. Bugs go to this repo's issues,
security reports to the process in `SECURITY.md`.

What the community maintains: anything marked community-maintained, including
community source adapters. We review it before it is merged. We do not support
it, we cannot promise it keeps working, and it can be disabled or removed in
any release.

What is yours: your own changes, your fork, your local patch. Please reproduce
the problem on a clean install of the current release before reporting it.

## Licence

MIT, see `LICENSE`. Install it, run it, read it, change it, sell it, ship it in
your own product; keep the copyright and licence notice.
Releases before 0.16.0 stay under the ICOR for Life
Source-Available License (Code) v1.0 they were published with.

The licence covers the code only. "ICOR", "ICOR for Life", "myICOR" and
"Paperless Movement" are trademarks of Paperless Movement, S.L.; a fork needs
its own plugin id and name. See `TRADEMARK.md`.

Contributions are welcome as pull requests under the same MIT terms, with a
DCO sign-off on every commit. See `CONTRIBUTING.md`.

Bundled third-party components keep their own licences; see
`THIRD-PARTY-NOTICES.md`.
