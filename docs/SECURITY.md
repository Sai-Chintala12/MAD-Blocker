# Security policy and threat model

Security cannot be guaranteed, and nobody can promise protection against unknown attacks. The goal is to **limit what an attacker can gain** if something goes wrong, and to catch mistakes early.

## Reporting a vulnerability

Please do **not** open a public issue. Use GitHub's **Report a vulnerability** button on the repository's Security tab (private vulnerability reporting). We aim to acknowledge reports within 7 days.

## What we protect

1. Users' browsing privacy (history, cookies, passwords, form data).
2. Users' browser integrity (no way for a website to run code through the extension).
3. The release channel (nobody but the maintainer can publish an update).

## Threats and how this project handles them

| Threat | Mitigation in this repo |
|---|---|
| Malicious website tries to talk to the extension | No `externally_connectable`. The service worker accepts messages only from MAD Blocker's own pages and checks `sender.id` and `sender.url`. |
| Over-broad permissions abused after a compromise | Only `storage`, `declarativeNetRequest`, `activeTab`, plus the **optional** `contentSettings`, requested only when the user picks a pop-up mode. **No `host_permissions`.** `tests/manifest.test.js` fails if anything else is added. (Content scripts still reach pages: see the next row.) |
| Broad page reach of the content scripts | The ad-hiding script runs on every http(s) page, so Chrome shows "Read and change all your data on all websites" at install. That script only reads MAD Blocker's own settings and sets a few attributes. It never reads page content, forms or cookies, sends no messages and makes no requests. A second script runs only on `www.youtube.com` and `m.youtube.com`. A test fails if any other match pattern is added without review. |
| Messages to the YouTube script | It answers only MAD Blocker's own pages (sender id and page address are checked) and returns two numbers: ad breaks handled on this page, and whether it gave up. |
| An ad handler that fights the page | `youtube.js` acts only while YouTube marks an ad as showing AND real ad parts exist, gives up after 45 seconds or 80 actions per page load, restores your volume and speed, and can be switched off on its own. Tested against a mock player in a real browser, including the stuck case. |
| Rules that block page loads | Only the bundled streaming list may block page navigations (that is how click-under tabs to ad networks are stopped), and the validator then requires named domains. Dynamic rules and any future downloaded list are always validated without that exemption. |
| CSS injection through custom hide rules (typed, imported, or edited in storage) | Selectors go through one strict check: no braces, semicolons, backslashes, commas, comments, `url()` or `@`, balanced brackets and quotes, never `body`, `html` or `*`, length and count caps. The check runs when a rule is added, when settings are imported, and again in the page's content script, because stored data is never trusted. The two copies of the check are proven identical by tests, and tampered storage is tested in a real browser. Rules can only hide elements. Typed and imported rules are held to a stricter standard than the bundled list: no pseudo-classes, no namespace-style attribute checks, no short substring matches, no reference to MAD Blocker's own markers, the hidden element must be named by a class, id or attribute, and at most 5 parts. Rules that fail are dropped, every custom rule also gets `:not(body):not(html)` so it can never hide the whole page, and a fuzz test throws thousands of random selectors at both copies of the check. |
| Remote code execution | No `eval`, `new Function`, remote scripts or `innerHTML`. Strict CSP. Both are enforced by tests. |
| Malicious or corrupt settings or rules (import, storage, future filter lists) | Everything passes `validateSettings()` or `validateRuleList()`. No regex rules, no redirect or header rules, no blocking of page navigation, size caps. Tested with malformed and prototype-pollution payloads. |
| A rule that freezes the browser | Rule and domain counts are capped. Chrome's native engine evaluates the rules. |
| Cross-site scripting in our own UI | UI is built with `textContent` and DOM APIs only. |
| Tracking by the extension | No analytics, no network requests, no remote config. Settings stay in `chrome.storage.local`. |
| Supply-chain attack through dependencies | **Zero runtime and dev dependencies.** Dependabot and CodeQL are enabled for the future. |
| Maintainer account takeover (the biggest real-world risk) | Passkey or hardware-key 2FA, protected `main`, required CI, signed commits, no sharing of publishing access. |
| Malicious update through an ownership transfer | Do not sell or hand over the extension without a security review. |

## Known limits (be honest with users)

- Manifest V3 cannot modify network responses, so blocking is weaker than the old uBlock Origin.
- YouTube ad delivery changes often. Blocking there can break and needs updates.
- YouTube is the weakest part. Its class names and ad delivery change often, and ads that YouTube stitches into the video stream itself cannot be recognised by this approach. It may also show its own warnings or block playback for people using ad blockers. The YouTube rules and the ad skipper are tested only against a simulated player, so check them on the live site and switch them off in the settings page if they cause trouble.
- Pop-up detection is partial. Chrome exposes no universal pop-up event, so MAD Blocker does not guess. It tells Chrome's own pop-up blocker what you chose for each site, and blocks a few well-known pop-under URLs in aggressive mode.
- Ad blocking does **not** replace antivirus, browser updates or safe browsing habits.
- Pop-up domain lists in `rules/default-rules.json` are a starter set and should be reviewed against reputable community lists before release.

## Release checklist

Before every Web Store upload:

- [ ] `npm test` passes and CI is green on `main`
- [ ] `npm run check:privacy -- --names "your name,your handle"` finds nothing, including in Git history
- [ ] The zip was built with `npm run package`
- [ ] `git diff` of `manifest.json` reviewed: no new permission without a written reason in this file
- [ ] Any change to `rules/` reviewed line by line, with sources noted
- [ ] No new dependency (or it was reviewed, pinned and audited)
- [ ] Version number bumped in `manifest.json` and `package.json`
- [ ] The zip contains only `manifest.json`, `rules/`, `src/` and `icons/`
- [ ] 2FA on the Chrome Web Store developer account confirmed
- [ ] `docs/PRIVACY.md` still matches what the code does

## Permission justifications

| Permission | Why it is needed |
|---|---|
| `declarativeNetRequest` | Lets Chrome itself block ad and tracker requests. The extension never sees your traffic. |
| `storage` | Saves your settings on your device. |
| `activeTab` | Lets the popup read the address of the tab you are looking at, only when you click the icon, so per-site settings work. |
| Content script on `http(s)` pages | Sets a few attributes on the page so CSS can hide ad containers, and adds your own hide rules for that site. It does not read page content. This is the reason Chrome shows the "all websites" warning. |
| Content script on YouTube | Watches whether the video player is showing an ad, then skips it. It does not read, store or send what you watch. |
| `contentSettings` (optional) | Asked for only when you choose "Allow pop-ups" or "Block more aggressively" for a site. It lets MAD Blocker tell Chrome's pop-up blocker what to do for the sites you picked. Nothing else is changed. |

**Imported settings files:** a settings file from someone else can contain custom hide rules. Before it is applied, the settings page shows what the file contains (the sites it pauses, its pop-up settings and its hide rules) and asks you to confirm. A rule could still hide something you need (for example a warning banner), so import only files you trust and review the list under "Hide a specific element".

## YouTube Page-World Script

One small script (`youtube-main.js`) runs inside YouTube's own page,
only on `www.youtube.com` and `m.youtube.com`.

It removes three ad-related fields from YouTube's player data:
`adPlacements`, `playerAds`, and `adSlots`.

The script does not store or transmit browsing data or make network
requests. It is controlled by the MAD Blocker pause switch and the
"YouTube ad skipping" protection setting.

On the very first page load, YouTube ad fields may be stripped before
settings finish loading. This is harmless; subsequent processing
respects the user's settings.