# MAD Blocker project plan

**Goal:** a lightweight, privacy-first ad blocker for Chrome (Manifest V3) that blocks ad and tracker requests, hides ad containers, handles unwanted pop-ups sensibly, and keeps the user in control.

## Principles

1. Local-first: settings stay on the device, no data collection.
2. Least privilege: smallest possible permission set, enforced by tests.
3. Browser-native filtering (declarativeNetRequest) over JavaScript in the page.
4. Honest claims: no invented statistics, no promise to block everything.
5. Zero dependencies unless they clearly earn their place.

## Status

| Phase | Scope | Status |
|---|---|---|
| 1 | Manifest, popup, on/off, local settings, initial network rules, tests, CI | **Done** |
| 2 | Cosmetic filtering (banner hiding, overlays, black/white/collapse) | **Done, tested in real Chromium**: bundled hide list (about 25 well-known ad-network patterns, generated into one stylesheet), overlays, black/white/collapse, your own per-site hide rules with strict validation. The list is a starter set: real blockers use tens of thousands of rules, so add rules per site as you find ads that slip through |
| 3 | Smart pop-up handling, per-site modes, trusted sites | **Done, tested in real Chromium**: per-site modes, pause, site manager, optional pop-up permission, Allow and Aggressive through Chrome's own pop-up blocker, extra pop-under rules. Please repeat the check once on your Windows Chrome (`docs/TESTING.md`) |
| 4 | YouTube and streaming sites | **Built, needs your check on live YouTube**: hide rules for YouTube ad slots, an in-player ad skipper with safety limits and a real skipped count, YouTube network rules, a streaming-site ad-network list that also stops click-under tabs, and an off switch for each. Tested against a simulated player in real Chromium (29 checks). YouTube is a moving target, so plan for ongoing fixes |
| 5 | Security and performance testing | **Mostly built, needs your PC**: stricter custom-rule validation with fuzz tests, a preview before importing settings, a privacy scan (also run in CI), a store-package script, and a performance script with `docs/PERFORMANCE.md` (measured on Linux only). Still open: real CPU, memory and temperature numbers on your Windows PC, a live YouTube pass, a security review by a second person, and the decision on bundling a full filter list |
| 6 | GitHub portfolio polish (screenshots, tags, releases) | Not started |
| 7 (optional) | Other browsers and phones | Researched: see `docs/MOBILE.md` |

## Expectations

- Manifest V3 limits what any extension can do. Blocking will be weaker than the old MV2 uBlock Origin.
- YouTube changes often. Treat that feature as ongoing maintenance.
- Real blocked-request counts need an extra permission (`declarativeNetRequestFeedback`). Decide in Phase 5 whether it is worth it. Until then the UI shows no counts.

## Original specification

The full original specification you wrote is kept in `docs/SPEC.txt`.

## Honest limits of the current blocking

- The built-in network and hide lists are small starter sets. They block the biggest ad networks and trackers but will miss many ads that a full filter list would catch. A real fix is bundling a maintained list such as EasyList: check its licence (it is GPL and CC BY-SA), credit it, respect Chrome's static rule limits, and review every update. This is a good Phase 5 decision.
- Hiding by CSS only works for ads that can be recognised by their markup. Ads that use random class names need a custom rule or a network rule.
