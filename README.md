# MAD Blocker

<p align="center"><img src="icons/logo-animated.svg" width="140" alt="MAD Blocker logo: a shield protected on all sides"></p>

A lightweight, privacy-first ad and tracker blocker for Google Chrome (Manifest V3).

- **Private:** settings stay on your device. No analytics, no history collection, no network requests of its own.
- **Minimal permissions:** `storage`, `declarativeNetRequest`, `activeTab`, plus one optional permission (`contentSettings`) that is asked for only if you use the pop-up controls. Chrome will still show "Read and change all your data on all websites" at install, because hiding ads has to run on every page. The page script only reads MAD Blocker's own settings and sets a few attributes; it never reads page content, forms or cookies (details in [docs/SECURITY.md](docs/SECURITY.md)).
- **Fast:** Chrome's native engine does the blocking. Page cleanup is pure CSS, with no page scanning.
- **YouTube and streaming sites:** hides YouTube ad slots, skips or fast-forwards ads inside the player (with safety limits and your own volume and speed restored), blocks known YouTube ad requests, and blocks click-under tabs to well-known ad networks. Each part has its own off switch. YouTube changes often, so expect upkeep.
- **In your control:** per-site pause, pop-up settings per site, your own hide rules for ads that slip through, ad-space style (black, white or collapse), and a site manager with export and import.
- **Secure by design:** no remote code, strict CSP, validated inputs, zero dependencies. See [docs/SECURITY.md](docs/SECURITY.md).

> MAD Blocker reduces ads and trackers. It is not antivirus software, and it does not guarantee that every ad is blocked.

## Status

Phases 1 to 4 are built, and most of Phase 5 (security and performance tooling). Everything is tested in a real Chromium browser, YouTube on a simulated page. Still needed from you: checks on the live YouTube site and on your own PC ([docs/TESTING.md](docs/TESTING.md), [docs/PERFORMANCE.md](docs/PERFORMANCE.md)). Plan: [docs/PROJECT_PLAN.md](docs/PROJECT_PLAN.md). Phones: [docs/MOBILE.md](docs/MOBILE.md).

## Quick start

```
npm test
```

Then open `chrome://extensions`, turn on Developer mode, click **Load unpacked** and choose this folder. Full instructions: [docs/SETUP.md](docs/SETUP.md).

## Project layout

```
manifest.json            Manifest V3 definition
rules/                   Network blocking rules and the hide-element list (cosmetic.json)
icons/                   Toolbar icons and the animated logo
scripts/                 Stylesheet builder, real-browser tests, performance check, privacy scan, store packager
src/background/          Service worker (settings, rules, validated messaging)
src/content/             Cosmetic cleanup (generated CSS plus a small script) and the YouTube ad handler
src/popup/               Toolbar popup
src/options/             Website settings page
src/shared/              Pure, tested logic (settings, policy, rule validation)
tests/                   Automated tests (npm test) and a manual pop-up test page
docs/                    Setup, security, privacy, testing, publishing
```

## Documentation

[Setup](docs/SETUP.md) · [Security](docs/SECURITY.md) · [Privacy](docs/PRIVACY.md) · [Testing](docs/TESTING.md) · [Publishing](docs/PUBLISHING.md) · [Performance](docs/PERFORMANCE.md) · [Plan](docs/PROJECT_PLAN.md) · [Phones](docs/MOBILE.md)

## License

MIT, see [LICENSE](LICENSE).

## Make it yours

| To change | Edit |
|---|---|
| Name | `"name"` in `manifest.json`, the `<h1>` and `<title>` in `src/popup/popup.html` and `src/options/options.html`, and `package.json` |
| Colours | The few `--accent`, `--bg`, `--fg` values at the top of `src/popup/popup.css` and `src/options/options.css` |
| Logo | `icons/logo-animated.svg` (used in the popup, settings page and this README). The animation switches off for people who prefer reduced motion |
| Toolbar icon | `icons/icon16.png`, `icon48.png`, `icon128.png`. The toolbar icon stays still on purpose, because animating it would need constant background work |

## Adding to the built-in hide list

Edit `rules/cosmetic.json`, then run `npm run build` (it regenerates `src/content/page-cleanup.css` and refuses bad selectors). `npm test` also checks that the generated file is up to date. Put selectors under `generic` for all sites or under `sites` for one site, for example `"news.example.com": ["#top-banner"]`.

## Commands

| Command | What it does |
|---|---|
| `npm test` | Unit tests. No installs needed |
| `npm run build` | Regenerates the hide stylesheet from `rules/cosmetic.json` (`-- --check` only verifies it) |
| `npm run check:privacy` | Looks for emails, personal folder paths, image metadata and Git history that would identify you. Run it before you push |
| `npm run package` | Builds `dist/MAD-Blocker-v<version>.zip` for the Chrome Web Store or for friends |
| `npm run e2e`, `e2e:popups`, `e2e:streaming`, `perf` | Real-browser tests and the performance check. They need Playwright installed outside the project ([docs/TESTING.md](docs/TESTING.md)) |
