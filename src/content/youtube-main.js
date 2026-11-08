(() => {
  'use strict';
  const KEYS = ['adPlacements', 'playerAds', 'adSlots'];

  const allowed = () =>
  !!document.documentElement && !document.documentElement.hasAttribute('data-mad-yt-off');
const strip = (o) => {
  if (allowed() && o && typeof o === 'object') for (const k of KEYS) if (k in o) delete o[k];
  return o;
};

  // 1. The first player data embedded in the page
  let initial;
  try {
    Object.defineProperty(window, 'ytInitialPlayerResponse', {
      configurable: true,
      get: () => initial,
      set: (v) => { initial = strip(v); }
    });
  } catch { /* leave it alone */ }

  // 2. Player data fetched later (next video, SPA navigation)
  const origJson = Response.prototype.json;
  Response.prototype.json = async function () {
    const data = await origJson.call(this);
    try {
      if (typeof this.url === 'string' && this.url.includes('/youtubei/v1/player')) strip(data);
    } catch { /* ignore */ }
    return data;
  };

  // 3. Fallback for code that uses JSON.parse
  const origParse = JSON.parse;
  JSON.parse = function (...args) {
    const out = origParse.apply(this, args);
    try {
      if (out && (out.adPlacements || out.playerAds || out.adSlots)) strip(out);
      if (out && out.playerResponse) strip(out.playerResponse);
    } catch { /* ignore */ }
    return out;
  };
})();