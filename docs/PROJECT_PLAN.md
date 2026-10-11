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
| 2 | Cosmetic filtering (banner hiding, overlays, black/white/collapse) | **Started**: conservative Google-ad selectors and the placeholder selector work. More selectors and per-site rules to come |
| 3 | Smart pop-up handling, per-site modes, trusted sites | **Built, needs your check in real Chrome**: per-site modes, pause, site manager, optional pop-up permission, allow or block pop-ups per site through Chrome, extra pop-under rules for aggressive mode. Verify with the pop-up test in `docs/TESTING.md` |
| 4 | YouTube and streaming sites | Not started |
| 5 | Security and performance testing | Not started |
| 6 | GitHub portfolio polish (screenshots, tags, releases) | Not started |

## Expectations

- Manifest V3 limits what any extension can do. Blocking will be weaker than the old MV2 uBlock Origin.
- YouTube changes often. Treat that feature as ongoing maintenance.
- Real blocked-request counts need an extra permission (`declarativeNetRequestFeedback`). Decide in Phase 5 whether it is worth it. Until then the UI shows no counts.

## Original specification

The full original specification you wrote is kept in `docs/SPEC.txt`.
