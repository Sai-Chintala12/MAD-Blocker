# Testing

## Automated (run with `npm test`)

| File | Proves |
|---|---|
| `tests/settings.test.js` | Garbage, oversized or hostile settings (including prototype pollution) become safe defaults. Hosts are validated. |
| `tests/rules.test.js` | Bundled rules are valid. The validator refuses regex, redirects, untargeted rules and blocking of page navigation. Per-site allow rules are generated correctly. |
| `tests/popup-policy.test.js` | Site modes map to the right policy. Parent-domain rules apply to subdomains but not look-alike domains. |
| `tests/content-script.test.js` | The real content script, run against a fake page: attributes, per-site matching, custom rules, and proof that its copy of the selector check accepts and rejects exactly the same selectors as the shared one (including CSS-injection attempts and tampered storage). |
| `tests/cosmetic.test.js` | The bundled hide list is valid, the generated stylesheet is up to date, and the selector check refuses anything that could escape its rule or hit the whole page. |
| `tests/popups.test.js` | Allow and aggressive modes produce exactly the intended Chrome pop-up settings, built only from validated hosts. Default and paused sites change nothing. |
| `tests/fuzz.test.js` | Thousands of random and mutated selectors and junk settings, rule lists and imports: nothing throws, nothing unsafe gets through, and the page script's copy of the selector check agrees with the shared one. |
| `tests/check-privacy.test.js` | The privacy scan finds emails, personal paths, your own words and image metadata, and leaves placeholders alone. |
| `tests/package.test.js` | The store zip is valid (read back by an independent reader), reproducible, holds only extension files with the manifest at the top, and has every file the manifest points to. |
| `tests/manifest.test.js` | Permissions stay on the allowlist, no host access, strict CSP, no dangerous code patterns, every referenced file exists. |

CI runs these on every push and pull request.

## Manual checklist (before each release)

Use a clean Chrome profile with only MAD Blocker installed.

- [ ] The pop-up table above matches what Chrome does
- [ ] Console snippet from `docs/SETUP.md` is BLOCKED, and NOT blocked after pausing and reloading
- [ ] Main switch off, then reload: no blocking. On again: blocking returns
- [ ] Black, White, Collapse behave as named on a site with Google ads
- [ ] A custom rule added in the settings page hides its element on that site only, and Remove brings it back
- [ ] Normal links, forms, logins and downloads still work
- [ ] A site with a special setting appears in the settings page and can be removed
- [ ] Export, then import the file: a window lists what the file contains, and Cancel changes nothing. OK applies it and the settings match. A random text file shows an error and no window
- [ ] Popup works on a normal page and shows a clear message on `chrome://extensions`
- [ ] DevTools console of the popup, options page and service worker show no errors
- [ ] Chrome Task Manager (Shift+Esc) shows the extension idle when you are not clicking
- [ ] Zip loads cleanly via Load unpacked on another machine

## Pop-up behaviour (needs real Chrome)

Unit tests prove the right instructions are produced. Only real Chrome can show what its pop-up blocker does with them, so check this once on your PC.

1. **One-time setup.** Open Notepad **as Administrator**, open `C:\Windows\System32\drivers\etc\hosts`, add the line `127.0.0.1 popup.test` and save. (`.test` is a reserved name that can never be a real website.)
2. In the project terminal run `npm run test:popups`, then open `http://popup.test:8080/` in Chrome.
3. In the MAD Blocker popup, set this site to each setting below (Chrome asks for the pop-up permission the first time), reload the page, and press the buttons.

| Setting | Normal link | Pop-up on click | Unsolicited pop-up (after 7 s) |
|---|---|---|---|
| Default | opens | opens | blocked |
| Allow pop-ups | opens | opens | opens (that is what Allow means) |
| Block more aggressively | opens | opens | blocked, even if you allowed pop-ups everywhere in Chrome |

Chrome's pop-up blocker never stops a pop-up that you opened with a click, in any mode. That is deliberate: logins, payments and downloads keep working. "Block more aggressively" differs from Default in two ways: it keeps the blocker on for that site even if you have allowed pop-ups everywhere, and it blocks well-known pop-under scripts on that site.

4. Also try `http://www.popup.test:8080/` to confirm the setting covers subdomains.
5. Press "Remove" on the site in the settings page, then confirm Chrome goes back to its normal behaviour.
6. When finished, remove the `popup.test` line from the hosts file.

This table is also checked automatically by `npm run e2e:popups` (see below), which ran on Linux Chromium. Your own check on Windows Chrome confirms it on your setup. If Chrome behaves differently from the table, write down what you saw and tell me.

## Real-browser tests (optional, automatic)

`npm run e2e` and `npm run e2e:popups` load the real extension in Chromium and test it on a local page: network blocking, hiding in all three ad-space styles (including a pixel check that black is black and white is white), pause, the on/off switch, custom rules (also on a page with a strict Content-Security-Policy, and against tampered storage), the settings page buttons (including the import preview and cancel), and Chrome's real pop-up blocker in every mode.

They need Playwright, which the project deliberately does not depend on. Install it outside the project (`npm install playwright` in another folder, then `npx playwright install chromium`) and run:

```
set PLAYWRIGHT_DIR=C:\path\to\that\folder\node_modules\playwright
npm run e2e
npm run e2e:popups
```

On Windows PowerShell use `$env:PLAYWRIGHT_DIR="..."` instead of `set`. Set `CHROME_PATH` to use your installed Chrome instead of Playwright's Chromium. Set `E2E_SHOTS=some-folder` to save screenshots of the black and white ad slots.

These tests load a temporary copy of the extension, so nothing in your project folder changes.

## Phase 4: YouTube and streaming sites

**Automatic** (`npm run e2e:streaming`, 29 checks): a simulated YouTube player with the markup MAD Blocker looks for, served over HTTPS under the real `www.youtube.com` name, plus a simulated streaming site. It proves: a non-skippable ad is cut short; a skippable ad gets its Skip button clicked; your own volume and speed are restored; a page that merely carries the "ad" class is left alone; an ad that never ends makes it give up and the popup says so; each switch (YouTube skipping, YouTube network rules, streaming networks, site pause, MAD Blocker off) really stops its part; YouTube ad requests are blocked but the player and video requests are not; ad slots are hidden on YouTube only; a click-under tab to a known ad network never reaches the network, even on a paused site; normal links still work.

**By hand on the live site (required, because YouTube changes and the simulation cannot know):**

- [ ] Open a YouTube video that normally shows an ad. The ad is skipped or cut short, and the popup shows "Ad breaks skipped on this page: 1" or more
- [ ] After the ad: your volume and playback speed are the same as before, and seeking, subtitles, fullscreen and quality changes all work
- [ ] The home page, search results and the watch page show no sponsored tiles or banner, and no empty gaps
- [ ] Try an ad-free video and a live stream: nothing odd happens
- [ ] If YouTube shows a warning about ad blockers or stops playing: settings page, Protections, switch off "YouTube network rules" first, reload, and test again. Then "YouTube ad skipping". Note which one fixed it
- [ ] On a streaming site you use: the play button works, no extra ad tab stays open, video controls, subtitles and fullscreen work. If a site breaks, pause MAD Blocker for that site or switch off "Streaming-site ad networks"
- [ ] Chrome Task Manager (Shift+Esc): while a YouTube video plays, MAD Blocker's CPU use stays near zero

Write down anything that fails with the exact page address and what you saw. Those notes are what the next fix is built from.

## Later phases

- Performance: record CPU, memory and page-load time with and without MAD Blocker on your PC. Report real measured numbers only.
