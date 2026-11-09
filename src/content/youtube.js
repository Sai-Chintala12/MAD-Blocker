// YouTube in-player ad handling. Runs only on YouTube pages (see manifest.json).
//
// What it does, and the limits that keep it from causing harm:
//  - It does nothing until YouTube marks the player with the "ad-showing" class AND real ad
//    parts are present, so normal videos are never touched.
//  - During an ad it clicks the Skip button when there is one. Otherwise it mutes the ad,
//    speeds it up and jumps to its end. When the ad is over it puts back YOUR volume and speed.
//  - No page scanning: one observer on the player's class attribute, plus a short timer that
//    only runs while an ad is on screen. Looking for the player is bounded to 20 seconds.
//  - Safety limits: if an ad "lasts" more than 45 seconds, or it has acted more than 80 times,
//    it gives up for this page load and leaves the video alone. The popup shows this, so you
//    can switch the protection off (settings page > Protections) or pause MAD Blocker here.
//  - It never reads or sends anything about what you watch. The popup can ask it two numbers:
//    how many ad breaks it handled on this page, and whether it gave up.
//
// It is switched on and off through the data-mad-yt attribute that page-cleanup.js sets, so
// pausing the site, turning MAD Blocker off, or turning off "YouTube ad skipping" all stop it.
//
// YouTube changes its page often and fights ad blockers. These class names are best guesses
// that must be checked against the live site; nothing here is guaranteed to keep working.
(() => {
  'use strict';

  const root = document.documentElement;
  if (!root) return;

const SKIP_BUTTONS = [
  '.ytp-skip-ad-button',
  '.ytp-ad-skip-button',
  '.ytp-ad-skip-button-modern',
  '.ytp-ad-skip-button-container button',
  '.ytp-ad-skip-button-slot button'
];
  const AD_PARTS = [
    '.ytp-ad-player-overlay-layout',
    '.ytp-ad-player-overlay',
    '.ytp-ad-text',
    '.ytp-ad-preview-container',
    '.ytp-ad-simple-ad-badge',
    '.ytp-ad-skip-button-container'
  ];
  const TICK_MS = 250;
  const STUCK_MS = 45000;
  const MAX_ACTIONS = 80;
  const FIND_PLAYER_MS = 20000;

  let enabled = root.getAttribute('data-mad-yt') === 'on';
  let player = null;
  let classObserver = null;
  let ticker = null;
  let findTimer = null;
  let adStart = 0;
  let saved = null; // the viewer's own mute and speed, put back after the ad
  let acted = false; // did we do something during this ad break
  let actions = 0;
  let adBreaks = 0;
  let gaveUp = null; // null, 'stuck' or 'too-many-actions'

function resetCounters() {
  actions = 0;
  gaveUp = null;
  acted = false;
}

  const adShowing = () => player !== null && player.classList.contains('ad-showing');
const hasAdParts = () =>
  AD_PARTS.some((selector) => player.querySelector(selector) !== null) ||
  (player.querySelector('.video-ads')?.children.length > 0);
  const getVideo = () => (player ? player.querySelector('video') : null);

  function restore() {
    const video = getVideo();
    if (video && saved) {
      try {
        video.muted = saved.muted;
        video.playbackRate = saved.rate;
      } catch {
        // the page replaced the video; nothing left to restore
      }
    }
    saved = null;
  }

  function stopTicker() {
    if (ticker !== null) {
      clearInterval(ticker);
      ticker = null;
    }
  }

  function endAdBreak() {
    stopTicker();
    restore();
    if (acted) adBreaks++;
    acted = false;
  }

  function giveUp(reason) {
    gaveUp = reason;
    stopTicker();
    restore();
    acted = false;
  }

  function tick() {
    try {
      if (!enabled || gaveUp !== null) return stopTicker();
      if (!adShowing()) return endAdBreak();
      if (Date.now() - adStart > STUCK_MS) return giveUp('stuck');
      if (actions >= MAX_ACTIONS) return giveUp('too-many-actions');
      if (!hasAdParts()) return;


for (const selector of SKIP_BUTTONS) {
  const button = player.querySelector(selector);

  if (button && !button.disabled) {
    for (const type of [
      'pointerdown',
      'mousedown',
      'pointerup',
      'mouseup',
      'click'
    ]) {
      button.dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          view: window
        })
      );
    }

    actions++;
    acted = true;
    return;
  }
}

      const video = getVideo();
      if (!video) return;
      if (saved === null) saved = { muted: video.muted, rate: video.playbackRate };
      video.muted = true;
      video.playbackRate = 16;
const length = video.duration;

if (
  Number.isFinite(length) &&
  length > 0 &&
  video.currentTime < length - 0.1
) {
  try {
    video.currentTime = Math.max(0, length - 0.1);
    actions++;
  } catch {
    // Seeking may be restricted by the player.
  }
}

acted = true;
    } catch {
      // never let a page change break YouTube: just stop acting on this ad
      giveUp('stuck');
    }
  }

  function onClassChange() {
    try {
      if (!enabled || gaveUp !== null) return;
      if (adShowing()) {
        if (ticker === null) {
          adStart = Date.now();
          ticker = setInterval(tick, TICK_MS);
          tick();
        }
      } else {
        endAdBreak();
      }
    } catch {
      giveUp('stuck');
    }
  }

  function detach() {
    stopTicker();
    restore();
    if (classObserver) classObserver.disconnect();
    classObserver = null;
    player = null;
    acted = false;
  }

  function attach() {
    const found = document.querySelector('#movie_player') || document.querySelector('.html5-video-player');
    if (!found) return false;
    if (found === player) return true;
    detach();
    player = found;
    classObserver = new MutationObserver(onClassChange);
    classObserver.observe(player, { attributes: true, attributeFilter: ['class'] });
    onClassChange();
    return true;
  }

  // Looks for the player for a short time, then stops. Called at start and after each in-page navigation.
  function findPlayer() {
      resetCounters();
    if (!enabled) return;
    if (findTimer !== null) clearInterval(findTimer);
    findTimer = null;
    if (attach()) return;
    const until = Date.now() + FIND_PLAYER_MS;
    findTimer = setInterval(() => {
      if (!enabled || attach() || Date.now() > until) {
        clearInterval(findTimer);
        findTimer = null;
      }
    }, 500);
  }

  // Follow the on/off attribute set by page-cleanup.js.
  new MutationObserver(() => {
    const now = root.getAttribute('data-mad-yt') === 'on';
    if (now === enabled) return;
    enabled = now;
    if (enabled) findPlayer();
    else detach();
  }).observe(root, { attributes: true, attributeFilter: ['data-mad-yt'] });

  document.addEventListener('yt-navigate-finish', findPlayer);
  window.addEventListener('yt-navigate-finish', findPlayer);
  document.addEventListener('DOMContentLoaded', findPlayer);
  findPlayer();

  // The toolbar popup can ask for two numbers. Only MAD Blocker's own pages are answered.
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const ownPage = sender.id === chrome.runtime.id &&
      typeof sender.url === 'string' && sender.url.startsWith(chrome.runtime.getURL(''));
    if (!ownPage || message === null || typeof message !== 'object' || message.type !== 'ytStatus') return false;
    sendResponse({ ok: true, enabled, adBreaks, gaveUp });
    return false;
  });
})();
