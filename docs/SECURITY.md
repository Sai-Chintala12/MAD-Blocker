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
| Over-broad permissions abused after a compromise | Only `storage`, `declarativeNetRequest`, `activeTab`, plus the **optional** `contentSettings`, requested only when the user picks a pop-up mode. **No `host_permissions`.** `tests/manifest.test.js` fails if anything else is added. |
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
- Pop-up detection is partial. Chrome exposes no universal pop-up event, so MAD Blocker does not guess. It tells Chrome's own pop-up blocker what you chose for each site, and blocks a few well-known pop-under URLs in aggressive mode.
- Ad blocking does **not** replace antivirus, browser updates or safe browsing habits.
- Pop-up domain lists in `rules/default-rules.json` are a starter set and should be reviewed against reputable community lists before release.

## Release checklist

Before every Web Store upload:

- [ ] `npm test` passes and CI is green on `main`
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
| Content script on `http(s)` pages | Sets one attribute on the page so CSS can hide ad containers. It does not read page content. |
| `contentSettings` (optional) | Asked for only when you choose "Allow pop-ups" or "Block more aggressively" for a site. It lets MAD Blocker tell Chrome's pop-up blocker what to do for the sites you picked. Nothing else is changed. |
