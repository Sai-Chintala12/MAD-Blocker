# MAD Blocker

<p align="center"><img src="icons/logo-animated.svg" width="140" alt="MAD Blocker logo: a shield protected on all sides"></p>

A lightweight, privacy-first ad and tracker blocker for Google Chrome (Manifest V3).

- **Private:** settings stay on your device. No analytics, no history collection, no network requests of its own.
- **Minimal permissions:** `storage`, `declarativeNetRequest`, `activeTab`, plus one optional permission (`contentSettings`) that is asked for only if you use the pop-up controls. No access to specific websites.
- **Fast:** Chrome's native engine does the blocking. Page cleanup is pure CSS, with no page scanning.
- **In your control:** per-site pause, allow or block pop-ups per site, ad-space style (black, white or collapse), and a site manager with export and import.
- **Secure by design:** no remote code, strict CSP, validated inputs, zero dependencies. See [docs/SECURITY.md](docs/SECURITY.md).

> MAD Blocker reduces ads and trackers. It is not antivirus software, and it does not guarantee that every ad is blocked.

## Status

Phases 1 and 3 are built, with a first slice of Phase 2. Pop-up behaviour needs your check in real Chrome (see [docs/TESTING.md](docs/TESTING.md)). Plan: [docs/PROJECT_PLAN.md](docs/PROJECT_PLAN.md).

## Quick start

```
npm test
```

Then open `chrome://extensions`, turn on Developer mode, click **Load unpacked** and choose this folder. Full instructions: [docs/SETUP.md](docs/SETUP.md).

## Project layout

```
manifest.json            Manifest V3 definition
rules/                   Static network blocking rules
icons/                   Toolbar icons and the animated logo
scripts/                 Local test server for pop-up testing
src/background/          Service worker (settings, rules, validated messaging)
src/content/             Cosmetic cleanup (CSS plus a tiny script)
src/popup/               Toolbar popup
src/options/             Website settings page
src/shared/              Pure, tested logic (settings, policy, rule validation)
tests/                   Automated tests (npm test) and a manual pop-up test page
docs/                    Setup, security, privacy, testing, publishing
```

## Documentation

[Setup](docs/SETUP.md) · [Security](docs/SECURITY.md) · [Privacy](docs/PRIVACY.md) · [Testing](docs/TESTING.md) · [Publishing](docs/PUBLISHING.md) · [Plan](docs/PROJECT_PLAN.md)

## License

MIT, see [LICENSE](LICENSE).

## Make it yours

| To change | Edit |
|---|---|
| Name | `"name"` in `manifest.json`, the `<h1>` and `<title>` in `src/popup/popup.html` and `src/options/options.html`, and `package.json` |
| Colours | The few `--accent`, `--bg`, `--fg` values at the top of `src/popup/popup.css` and `src/options/options.css` |
| Logo | `icons/logo-animated.svg` (used in the popup, settings page and this README). The animation switches off for people who prefer reduced motion |
| Toolbar icon | `icons/icon16.png`, `icon48.png`, `icon128.png`. The toolbar icon stays still on purpose, because animating it would need constant background work |
