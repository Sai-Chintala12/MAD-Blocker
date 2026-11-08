# Performance

MAD Blocker is built to cost very little, and `npm run perf` measures that. This page says what the design does, what was measured and how far to trust it, and how to check it on your own PC.

## How the design keeps it light

- **Network blocking is Chrome's own.** Ad and tracker requests are blocked by Chrome's built-in rule engine (`declarativeNetRequest`). MAD Blocker never sees your traffic and runs no JavaScript per request. Three rule files hold 9 rules. Chrome reported room for about 330,000 more static rules (the guaranteed minimum is 30,000).
- **Ad hiding is one generated stylesheet (about 17 KB).** The browser applies CSS to every element, including ads that appear later, without any script running. It is written as plain selector lists, not `:is(...)`, because that was measured at 1.7 ms of style calculation against 12.8 ms on a 5,000-element page.
- **No page scanning.** On ordinary pages the content script reads MAD Blocker's own settings and sets a few attributes. There is no MutationObserver and no per-element work.
- **YouTube skipper:** one observer on the video player's `class` attribute. A 250 ms timer runs only while an ad is showing, it gives up after 45 seconds or 80 actions, and the search for the player stops after 20 seconds.
- **The background worker is event-driven**: no timers and no network calls.
- **Hard caps:** 500 site settings, 200 custom rules in total (50 per site), 100 KB for an imported file.

## What was measured

`npm run perf` starts two Chromium browsers side by side, one with the extension and one without, and loads the same local test pages in turns so that slow moments hit both equally. Everything runs on one machine and nothing goes on the internet.

Environment: Linux, headless Chromium, 2 CPU cores. Median of 20 loads per page and browser. Two complete runs, because a single run is not trustworthy.

| Measure | Without | With | Difference |
|---|---|---|---|
| **Plain page (5,000 elements, no ads): total CPU, all browser processes** | 180 ms | 190 ms | **+10 ms** (one 10 ms measuring step) |
| Plain page: page's own main thread | 98 ms / 102 ms | 111 ms / 108 ms | +13 ms / +7 ms |
| Plain page: script time | 0 ms | 1.2 ms / 1.1 ms | +1 ms |
| Plain page: load time | 77 ms / 80 ms | 77 ms / 79 ms | +0.3 ms / -1.3 ms (noise) |
| **Ads page (40 ad slots, 17 ad requests): total CPU** | 460 ms | 380 ms | **-80 ms (-17%)** |
| Ads page: ad requests that went out | 17 | 0 | -17 |
| Ads page: ad slots still visible | 180 | 0 | -180 |
| Ads page: load time | 215 ms / 218 ms | 223 ms / 241 ms | +8 ms / +22 ms (noise: see below) |
| Idle for 15 s: extension CPU | | 0.07% / 0.00% of one core | |
| Idle: extension process memory (proportional) | 13 ms-equivalent empty tab: 13 MB | 40 MB | up to 27 MB (upper bound) |
| Video, 4 s of a small clip | 44 frames, 0 dropped | 44 frames, 0 dropped | none |

The "total CPU" rows exist in the second run only. When two numbers are shown they are run 1 and run 2.

## How to read it honestly

- **The cost of having it installed is small:** roughly 5 to 15 ms of CPU per page load on a page with no ads, and nothing while idle.
- **On a page full of ads, total CPU went down about 17%.** That is the number that relates to heat. It comes from an artificial test page with fake ad scripts that burn a fixed 15 ms each, so real savings on real sites could be larger or smaller. It was not measured on real sites.
- **The ads page did not load faster.** The load event was 8 to 22 ms later with the extension, which is inside the run-to-run spread (the 90th percentile was 242 to 273 ms in both cases). Blocked ad frames are drawn as error pages inside the page itself, which costs a little. The test ads answer in 20 ms from the same machine, while real ad networks are much slower, so real pages may well load sooner. Not measured.
- **Page main-thread time misleads here.** On the ads page it was higher with the extension (+48 ms) because blocked ad frames are drawn in the page's process, while real ad frames run in other processes that this number does not count. Total CPU is the fair comparison.
- **Memory:** an earlier run used resident memory (129 MB against 63 MB for an empty tab). That counts shared program code several times and was misleading. The proportional figure above (40 MB against 13 MB) is fairer, and it is still an upper bound, because the extension process also carries Chrome's own extension machinery. The real figure for MAD Blocker alone is on your PC (below).
- **Temperature was not measured and cannot be from here.** Less total CPU suggests no added heat, but only your hardware can show it.

## Not measured

Real websites (not reachable from the build environment), the CPU cost of the YouTube skipper, Windows and macOS, Edge and Brave, battery, temperature, and the extra cost of many custom rules (the cap is 200).

## Check it on your PC (Windows)

1. **Chrome Task Manager** (Shift+Esc). Right-click the column headers and switch on "Memory footprint". Find the row **Extension: MAD Blocker**. Idle CPU should sit at 0 and memory should be a few tens of MB. Open a YouTube video and watch the row while an ad plays: CPU should stay low and go back to 0 afterwards.
2. **Same video with and without.** Play the same YouTube video for two minutes with MAD Blocker on, then off (toggle it in the popup and reload). Note the CPU of the tab and of the GPU process in Chrome's Task Manager.
3. **Temperature.** Use a tool such as HWiNFO or your motherboard's utility to read CPU temperature while you browse the same pages for ten minutes with and without the extension. Compare the two. A difference of a degree or two is noise.
4. **Optional, `npm run perf`.** It needs Playwright installed outside the project (see `docs/TESTING.md`). On Windows it reports page timings; total CPU and memory figures are Linux only, so use the Task Manager steps above for those.

Set `PERF_RUNS=40` for steadier numbers, and `PERF_JSON=result.json` to save them. A difference smaller than the 90th-percentile spread printed at the end is not a real difference.
