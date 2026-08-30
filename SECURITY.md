# Security Policy

myICOR Connect is an Obsidian plugin that signs you in to your app.myicor.com
account from inside your vault and exposes vault context over MCP. It holds an
OAuth token and it opens a local loopback listener during sign-in. Those are the
two parts worth attacking, and we would rather hear about a problem early than
read about it later.

## Reporting a vulnerability

**Please do not open a public GitHub issue for a security problem.**

Two channels, in order of preference:

1. **GitHub private security advisory** (preferred). Go to the
   [Security tab](https://github.com/myICOR/icor-for-life-connect/security/advisories/new)
   of this repository and open a draft advisory. This keeps the report private
   between you and the maintainer until a fix ships.
2. **Email** `team@myicor.com` with `SECURITY` and `icor-for-life-connect` in the subject
   line. This is a monitored mailbox. If you want to encrypt the report, say so in
   a first message and we will arrange a key.

A useful report contains:

- The plugin version (see `manifest.json`, or Settings, Community plugins).
- Your Obsidian version and operating system.
- What an attacker can do, and what they need in order to do it.
- Steps to reproduce, ideally against a throwaway vault and a test account.
- **Never send us a real access token, refresh token, or password.** Describe the
  credential ("the OAuth access token in `data.json`"), do not paste its value. If
  a token of yours was exposed, sign out to invalidate it first, then report.

If your report concerns the app.myicor.com **server** rather than this plugin, it
still belongs here. Use the same channels and say so in the first line.

## What to expect

This project is maintained by one person, so these are timelines we can actually
keep rather than ones that sound good:

| Stage | Target |
| --- | --- |
| We acknowledge your report | within 5 business days |
| We tell you whether we agree it is a vulnerability, and how severe | within 10 business days |
| We ship a fix for a confirmed critical or high issue | we aim for 30 days |
| We ask you to hold public disclosure until | a fix ships, or 90 days from your report, whichever comes first |

Server-side issues on app.myicor.com are usually fixable faster than plugin issues,
because a plugin fix has to go through an Obsidian release. If a deadline is going
to slip we will tell you before it slips, not after. If you do not hear from us
within 10 business days, please chase us: assume the message got lost rather than
ignored.

## Supported versions

**Only the most recent release is supported.** This project has one branch (`main`)
and no long-term-support line. There are no backports to older versions and no
security patches for anything but the current release. If you are running an older
version, the fix is to update.

We are not going to publish a version-support table we would not honour. This
plugin is at 0.x and its interfaces are still moving.

## Scope: what this plugin actually touches

Measured against the shipped `main.js` of v0.8.2:

**Authentication.** The plugin performs an OAuth flow against `app.myicor.com`. The
callback is received on a **loopback listener on `127.0.0.1`**, which is the
standard pattern for a native client. The resulting token is stored in Obsidian's
per-plugin `data.json` inside the vault, at
`.obsidian/plugins/icor-for-life-connect/data.json`. That file is git-ignored in this
repository and the token is sent to no host other than `app.myicor.com`.

**Where it connects.** The only remote host referenced in the shipped bundle is
`app.myicor.com`, plus the `127.0.0.1` loopback used for the OAuth callback. There
is no telemetry and no analytics.

**MCP.** The plugin speaks the Model Context Protocol, which means a connected
client can ask it for vault context. What that client is allowed to see, and how
that boundary is enforced, is a security boundary and we treat it as one.

**In scope, and we want to hear about it:**

- **OAuth flow attacks.** Missing or unvalidated `state`, a missing or replayable
  PKCE verifier, an authorization code that can be intercepted or reused, a
  redirect URI that accepts a host other than loopback, or a token issued to the
  wrong client.
- **The loopback listener.** Anything that lets a process or page other than the
  legitimate callback reach it: binding to a non-loopback interface, missing origin
  checks, the listener outliving the sign-in flow, or a predictable port plus
  missing state allowing another local process to steal the code.
- **Token handling.** A token appearing in a note, a log line, a rendered pane, an
  error message, a crash report, or a URL. A refresh token that is not invalidated
  on sign-out. A token sent to any host other than `app.myicor.com`.
- **Scope and authorization.** The plugin reading or writing account data beyond
  what the granted scope should allow, or one user's data being reachable with
  another user's token.
- **The MCP surface.** A connected MCP client reaching vault content outside the
  boundary the user consented to, reading files outside the configured folders, or
  escaping the vault root. Prompt content that steers the MCP surface into
  exfiltrating vault data is in scope and is the report we would most like to
  receive.
- **Sync path injection.** Server-controlled content (a reflection, a knowledge-base
  result, a dashboard field) that causes code execution, HTML injection into a
  pane, or arbitrary file write when it is rendered or written into the vault.
- Path traversal in note creation: a server-controlled string that writes outside
  the configured folder.
- TLS verification being skipped or downgraded on any outbound request.

**Note on the published artifact.** This repository distributes the built plugin
(`main.js`, `manifest.json`, `styles.css`). `main.js` is a readable, non-minified
esbuild bundle, so it can be reviewed directly. The TypeScript source is not
published in this repository.

## Out of scope

These are not vulnerabilities and we will close them as such:

- **Your own credentials being stored in your own vault.** That is the design.
  Obsidian's storage for per-plugin state is `data.json` in your vault. If your
  vault is synced somewhere, the token goes with it, which is a property of your
  sync setup rather than a flaw in this plugin. Exfiltration *away* from your
  vault is in scope; storage *in* it is not.
- Anyone with filesystem access to your vault being able to read `data.json`. If
  an attacker is already reading your vault, the token is the smaller problem.
- Bugs in Obsidian itself. Report those to
  [Obsidian](https://github.com/obsidianmd/obsidian-releases/issues).
- Interactions with third-party plugins, or breakage caused by another plugin
  changing shared state. Please report those as normal issues so we can look at
  compatibility, but they are not handled as security reports.
- Missing hardening that has no demonstrated impact: absent security headers with
  no attack behind them, "the token is not encrypted at rest", dependency versions
  with no reachable exploit path, or the output of an automated scanner with no
  working proof of concept.
- Rate limiting, account enumeration through timing, or password policy on
  app.myicor.com, unless you can show real impact.
- Social engineering, physical access, or attacks that require the user to
  already be running attacker-controlled code.

## Good-faith research

We will not pursue or support legal action against anyone who reports a
vulnerability to us in good faith, follows this policy, gives us reasonable time to
fix the issue before disclosure, and does not access, modify or destroy data that
is not their own. Test against your own vault and **your own myICOR account**.
Please do not test against other people's accounts, and please do not run
automated scanners or load tests against app.myicor.com.

There is no bug bounty. We are a small team and cannot pay for reports. We will
credit you by name and link in the release notes and the advisory unless you would
rather stay anonymous.

## Credit

Thank you for taking the time. A report that arrives privately and with a
reproduction is worth a great deal more than the effort it costs you to write it.
