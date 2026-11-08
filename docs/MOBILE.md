# MAD Blocker on phones

Short answer: **not yet, and the browser decides, not us.** MAD Blocker is a Chrome extension. Today it works in desktop Chrome and in desktop browsers built on Chrome's engine (Microsoft Edge, Brave, Opera and others). Phones are different.

_Facts below come from a mid-2026 search and a few articles. Browser support changes quickly, so re-check before you promise anything to users._

## What works where

| Where people browse | Can it run MAD Blocker? | Why |
|---|---|---|
| Chrome on Windows, Mac, Linux, Chromebook | **Yes, today** | This is what it was built for |
| Edge, Brave, Opera on desktop | **Very likely** (not tested here) | They accept Chrome Web Store extensions |
| **Chrome on Android (phones)** | **No** | Chrome for Android does not support extensions. Google has been building a separate desktop-class Chrome for Android, reported to be aimed at PCs and Chromebooks rather than phones, with no announced plan for the regular phone app ([Chrome Unboxed, April 2025](https://chromeunboxed.com/a-development-version-of-chrome-for-android-now-supports-extensions); [ExtensionBooster guide, 2026](https://extensionbooster.net/blog/chrome-extensions-android-2026-what-works-guide.md)) |
| **Chrome on iPhone and iPad** | **No** | To my knowledge, every iOS browser must use Apple's WebKit engine and Chrome on iOS has no extension system. Please verify this before relying on it |
| Safari on iPhone and iPad | **Possible, with real work** | See below |
| Firefox on Android | **Possible, with moderate work** | See below |
| Some small Chromium-based Android browsers | **Maybe as-is** | A 2026 article says browsers such as Quetta and Helium accept Chrome Web Store extensions on Android, and that Kiwi Browser shut down in 2025. These are small projects, so judge their privacy and reliability yourself, and expect that your users will not want to switch browsers just for this |

## Option 1: Firefox (desktop and Android). Best value for the effort

Firefox for Android installs extensions from addons.mozilla.org, and Firefox supports Manifest V3 with `declarativeNetRequest` ([Mozilla](https://blog.mozilla.org/addons/2023/05/17/declarativenetrequest-available-in-firefox/)). Changes needed, roughly one focused phase:

- Manifest: use `background.scripts` instead of `background.service_worker` (Firefox does not run extension service workers), and add `browser_specific_settings.gecko.id`.
- Drop or replace the pop-up permission feature: Firefox has no `contentSettings` API, so "Allow pop-ups" and "Block more aggressively" would lose their Chrome-pop-up-blocker part (the pop-under rules would stay).
- Re-run the tests and the real-browser checks against Firefox, and test on a real Android phone.
- Make the popup comfortable on a small screen (it is 320 px wide now).
- Publish on addons.mozilla.org (free to publish, reviewed by Mozilla).

## Option 2: Safari on iPhone (most work, costs money)

Safari supports web extensions, but on iPhone they ship **inside an iOS app**. Apple's Xcode includes a converter (`xcrun safari-web-extension-converter`) that wraps an existing extension folder in an app project. You need a Mac with Xcode, and an Apple Developer Program membership to publish on the App Store (about US$99 a year; check Apple's current price). Expect further changes: Safari's support for the network-blocking API is more limited, `contentSettings` does not exist, and App Store review applies.

## Option 3: think about what users actually need

If the goal is "fewer ads on my phone", many people use a content-blocking app for Safari on iPhone, a Firefox-based setup on Android, or private-DNS filtering. A browser extension for phones is only worth building if you want MAD Blocker itself to be there.

## Suggested order

1. Finish and publish the Chrome version (Phases 5 and 6).
2. Port to Firefox (covers Firefox desktop and Android).
3. Only then decide whether iPhone Safari is worth the cost and effort.

Tell me when you want the Firefox port, and I will plan it as Phase 7.
