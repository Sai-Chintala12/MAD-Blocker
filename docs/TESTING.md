# Testing

## Automated (run with `npm test`)

| File | Proves |
|---|---|
| `tests/settings.test.js` | Garbage, oversized or hostile settings (including prototype pollution) become safe defaults. Hosts are validated. |
| `tests/rules.test.js` | Bundled rules are valid. The validator refuses regex, redirects, untargeted rules and blocking of page navigation. Per-site allow rules are generated correctly. |
| `tests/popup-policy.test.js` | Site modes map to the right policy. Parent-domain rules apply to subdomains but not look-alike domains. |
| `tests/popups.test.js` | Allow and aggressive modes produce exactly the intended Chrome pop-up settings, built only from validated hosts. Default and paused sites change nothing. |
| `tests/manifest.test.js` | Permissions stay on the allowlist, no host access, strict CSP, no dangerous code patterns, every referenced file exists. |

CI runs these on every push and pull request.

## Manual checklist (before each release)

Use a clean Chrome profile with only MAD Blocker installed.

- [ ] The pop-up table above matches what Chrome does
- [ ] Console snippet from `docs/SETUP.md` is BLOCKED, and NOT blocked after pausing and reloading
- [ ] Main switch off, then reload: no blocking. On again: blocking returns
- [ ] Black, White, Collapse behave as named on a site with Google ads
- [ ] Normal links, forms, logins and downloads still work
- [ ] A site with a special setting appears in the settings page and can be removed
- [ ] Export, then import the file, then settings match. Importing a random text file shows an error and changes nothing
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
| Default | opens | Chrome decides (usually opens) | usually blocked |
| Allow pop-ups | opens | opens | opens (that is what Allow means) |
| Block more aggressively | opens | blocked | blocked |

4. Also try `http://www.popup.test:8080/` to confirm the setting covers subdomains.
5. Press "Remove" on the site in the settings page, then confirm Chrome goes back to its normal behaviour.
6. When finished, remove the `popup.test` line from the hosts file.

If real Chrome behaves differently from the table, write down what you saw and tell me. Chrome's own pop-up rules decide the Default row, and extension settings can interact with your own Chrome site settings in ways worth checking.

## Later phases

- YouTube: playback, seeking, subtitles and fullscreen still work.
- Movie and anime sites: video controls and fullscreen still work, pop-ups handled as intended.
- Performance: record CPU, memory and page-load time with and without MAD Blocker on your PC. Report real measured numbers only.
