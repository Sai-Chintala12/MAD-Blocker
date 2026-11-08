# Changelog

## Version 0.5.1

### Added
- Added YouTube page-world ad-pruning protection.
- Added tests for MAIN-world script restrictions and network-silent behavior.
- Added documentation covering YouTube privacy and protection controls.

### Improved
- YouTube ad skipping now respects the user's protection settings.
- Added separate YouTube pruning control using `data-mad-yt-off`.
- Improved ad-skip handling and per-ad-break safety counter resets.

## 0.5.0
- Security hardening of custom hide rules (typed or imported): no pseudo-classes, no namespace-style attribute checks, substring checks need at least 3 characters, no reference to MAD Blocker's own page markers, the element that gets hidden must be named by a class, an id or an attribute, and at most 5 parts. A rule that no longer passes is dropped when settings load. Every custom rule also gets `:not(body):not(html)`, so it can never hide the whole page. New fuzz tests check this with thousands of random selectors, in Node and in real Chromium.
- Importing a settings file now shows what it contains (paused sites, pop-up settings, hide rules) and asks before replacing your settings.
- Pause fixes: the pause rule matches only the page you navigate to, so pausing youtube.com no longer unblocks YouTube embeds on other websites; a paused subdomain no longer inherits "Allow pop-ups" from its parent site.
- The hide stylesheet is written as plain selector lists instead of `:is(...)`, which `npm run perf` measured at 1.7 ms instead of 12.8 ms of style calculation on a 5,000-element page.
- A site address with a trailing dot (`example.com.`) is treated like `example.com` by the page script.
- New commands: `npm run check:privacy` (emails, personal folder paths, image metadata and Git history), `npm run perf` with `docs/PERFORMANCE.md`, and `npm run package`, which builds the Web Store zip and works in Git Bash.
- CI now also checks that the stylesheet is up to date, runs the privacy scan and builds the package.
- Tests: 116 unit tests. Real-browser: `npm run e2e` 50 checks, `npm run e2e:popups` 18, `npm run e2e:streaming` 29.

## 0.4.0
- Phase 4, YouTube and streaming sites:
  - YouTube ad slots are hidden (17 selectors, only on YouTube), including the empty grid cell around a sponsored tile.
  - New in-player ad handler (`src/content/youtube.js`): clicks Skip, or mutes, speeds up and jumps to the end of an ad, then restores your own volume and speed. It acts only while a real ad is showing, gives up after 45 seconds or 80 actions per page load, and the popup shows the real number of ad breaks handled or a warning if it gave up.
  - New rule files: `rules/youtube-rules.json` (known YouTube ad requests) and `rules/streaming-rules.json` (well-known pop-under and click-under ad networks, including the tabs they open).
  - New "Protections" switches in the settings page, so each part can be turned off on its own if it breaks a site.
- Only the bundled streaming list may block page navigations, and only for named domains. Everything else is still validated strictly.
- Real-browser test `npm run e2e:streaming` (28 checks on a simulated YouTube page and streaming site). 88 unit tests.
- Corrected the docs: Chrome shows an "all websites" install warning because the ad-hiding script runs on every page.
- New `docs/MOBILE.md`: what works on phones and what it would take.

## 0.3.0
- Phase 2, cosmetic filtering: bundled hide list is now a validated source file (`rules/cosmetic.json`) that builds one stylesheet (`npm run build`), with more well-known ad-network patterns and overlay rules.
- New "Hide a specific element" section in the settings page: your own per-site hide rules with strict validation, applied live and in the chosen ad-space style.
- Real-browser tests: `npm run e2e` (42 checks) and `npm run e2e:popups` (18 checks) load the extension in Chromium. 76 automated unit tests.
- Corrected the description of "Block more aggressively": Chrome's pop-up blocker never stops pop-ups opened by your own click, so those still open. The mode keeps the blocker on for the site even if you allowed pop-ups everywhere, and blocks well-known pop-under scripts.

## 0.2.0
- Renamed from CleanFeed to **MAD Blocker** (folder, extension name, popup, settings page, docs, package name, settings export file).
- New blue, yellow and green shield logo, with an animated version shown in the popup, settings page and README.
- Interface colours changed to blue.
- Phase 3: per-site "Allow pop-ups" and "Block more aggressively", using Chrome's own pop-up blocker.
- New optional permission `contentSettings`, asked for only when a pop-up mode is first chosen.
- Extra pop-under rules for sites set to aggressive mode.
- Local pop-up test page (`npm run test:popups`) and 11 new automated tests (46 in total).

## 0.1.0 (first build, named CleanFeed)
- Manifest V3 extension with on/off switch, per-site pause, ad-space style selector, site manager with export and import.
- Starter network rules, validated settings and rules, strict permissions, zero dependencies.
- Tests, GitHub Actions CI, CodeQL, Dependabot and the setup, security, privacy, testing and publishing docs.
