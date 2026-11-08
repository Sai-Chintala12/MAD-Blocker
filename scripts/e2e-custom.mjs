// Real-browser checks for custom per-site rules. Called by scripts/e2e.mjs.
import { selectorProblem } from '../src/shared/selector.js';
import { customRuleCss } from '../src/shared/cosmetic.js';
import { SEED, rng, randomSelector } from '../tests/helpers/random-selectors.js';
export async function run({ context, send, open, style, height, check, control, extId }) {
  const hidden = async (page, sel) => (await style(page, sel, 'display')) === 'none';

  await send({ type: 'setPlaceholder', value: 'collapse' });
  await send({ type: 'resetCustom' });

  // 1. A custom rule hides its element on that site only
  const added = await send({ type: 'addCustomSelector', host: 'news.test', selector: '#my-banner' });
  check('custom rule is accepted', added.ok === true, JSON.stringify(added));
  let { page } = await open('news.test');
  check('custom rule hides the element on its site', await hidden(page, '#my-banner'));
  check('custom rule leaves other elements alone', !(await hidden(page, '#content')) && !(await hidden(page, '#footer')));
  await page.close();
  ({ page } = await open('other.test'));
  check('custom rule does not affect other sites', !(await hidden(page, '#my-banner')));
  await page.close();

  // 2. Subdomains of the site are covered
  ({ page } = await open('www.news.test'));
  check('custom rule covers subdomains', await hidden(page, '#my-banner'));
  await page.close();

  // 3. It follows the ad-space style
  await send({ type: 'setPlaceholder', value: 'black' });
  ({ page } = await open('news.test'));
  const h = await height(page, '#my-banner');
  check('black style keeps the space of a custom-hidden element', h === 60, String(h));
  check('black style paints it flat', (await style(page, '#my-banner', 'filter')).includes('brightness(0)'));
  await send({ type: 'setPlaceholder', value: 'collapse' });
  await page.waitForTimeout(200);
  check('changing the style updates an open page without reload', await hidden(page, '#my-banner'));

  // 4. Adding and removing rules updates open pages live
  await send({ type: 'addCustomSelector', host: 'news.test', selector: '#footer' });
  await page.waitForTimeout(200);
  check('a new rule applies to an open page immediately', await hidden(page, '#footer'));
  await send({ type: 'removeCustomSelector', host: 'news.test', selector: '#footer' });
  await page.waitForTimeout(200);
  check('removing a rule restores the element immediately', !(await hidden(page, '#footer')));
  await page.close();

  // 5. Strict page security policy does not stop the rules
  await send({ type: 'resetCustom' });
  await send({ type: 'addCustomSelector', host: 'csp.test', selector: '#my-banner' });
  ({ page } = await open('csp.test'));
  check('works on a page with a strict Content-Security-Policy', await hidden(page, '#my-banner'));
  check('built-in hiding also works under that policy', await hidden(page, '#ad1'));
  await page.close();

  // 6. Rules the extension would refuse are refused
  for (const bad of ['body', '*', '} body { display:none', '.a, .b', 'url(x)', '']) {
    const r = await send({ type: 'addCustomSelector', host: 'news.test', selector: bad });
    check(`refused by the extension: ${JSON.stringify(bad)}`, r.ok === false, JSON.stringify(r));
  }

  // 7. Even tampered storage (bypassing the extension) cannot inject styles
  await send({ type: 'resetCustom' });
  await control.evaluate(async () => {
    const { settings } = await chrome.storage.local.get('settings');
    settings.custom = [
      { host: 'news.test', selector: '} body { display: none !important } .zzz' },
      { host: 'news.test', selector: 'body' },
      { host: 'news.test', selector: '*' }
    ];
    await chrome.storage.local.set({ settings });
  });
  ({ page } = await open('news.test'));
  check('tampered storage: page is not hidden', (await style(page, 'body', 'display')) !== 'none' && !(await hidden(page, '#content')));
  await page.close();
  await send({ type: 'resetCustom' });

  // 8. Pausing a site turns its custom rules off
  await send({ type: 'addCustomSelector', host: 'news.test', selector: '#my-banner' });
  await send({ type: 'setSiteMode', host: 'news.test', mode: 'paused' });
  ({ page } = await open('news.test'));
  check('paused site: custom rule is off', !(await hidden(page, '#my-banner')));
  await page.close();
  await send({ type: 'removeSite', host: 'news.test' });
  await send({ type: 'resetCustom' });

  // 9. The settings page itself: add and remove through the real form
  await control.reload();
  await control.fill('#customHost', 'news.test');
  await control.fill('#customSelector', '#my-banner');
  await control.click('#customForm button[type="submit"]');
  await control.waitForSelector('#customRules tr');
  const rowText = await control.textContent('#customRules tr');
  check('settings page lists the new rule', rowText.includes('news.test') && rowText.includes('#my-banner'), rowText);
  ({ page } = await open('news.test'));
  check('rule added in the settings page hides the element', await hidden(page, '#my-banner'));
  await page.close();

  await control.fill('#customSelector', 'body');
  await control.click('#customForm button[type="submit"]');
  await control.waitForFunction(() => document.getElementById('status').classList.contains('error'));
  const err = await control.textContent('#status');
  check('settings page explains a refused rule', err.includes('not allowed'), err);

  await control.click('#customRules tr button');
  await control.waitForFunction(() => document.querySelectorAll('#customRules tr').length === 0);
  check('settings page removes a rule', true);
  ({ page } = await open('news.test'));
  check('removed rule no longer hides anything', !(await hidden(page, '#my-banner')));
  await page.close();

  // 10. Property test in real Chrome: whatever the strict check accepts can never add a second rule
  //     or hide the page itself, in any ad-space style.
  const r = rng(SEED + 99);
  const accepted = [];
  for (let tries = 0; accepted.length < 1500 && tries < 200000; tries++) {
    const candidate = randomSelector(r);
    if (selectorProblem(candidate) === null) accepted.push(candidate);
  }
  const rules = accepted.flatMap((selector) => ['collapse', 'black', 'white'].map((mode) => customRuleCss(selector, mode)));
  const outcome = await control.evaluate((texts) => {
    const root = document.documentElement;
    root.setAttribute('data-mad', 'on');
    let refused = 0; let extraRules = 0; let pageHidden = 0;
    for (const text of texts) {
      const sheet = new CSSStyleSheet();
      try { sheet.insertRule(text); } catch { refused++; continue; }
      if (sheet.cssRules.length !== 1 || sheet.cssRules[0].type !== CSSRule.STYLE_RULE) extraRules++;
      document.adoptedStyleSheets = [sheet];
      const bad = [document.documentElement, document.body].some((el) => {
        const cs = getComputedStyle(el);
        return cs.display === 'none' || cs.filter !== 'none' || cs.pointerEvents === 'none';
      });
      if (bad) pageHidden++;
      document.adoptedStyleSheets = [];
    }
    root.removeAttribute('data-mad');
    return { tested: texts.length, refused, extraRules, pageHidden };
  }, rules);
  check(`${accepted.length} random accepted selectors, all 3 styles: none adds a second rule`, outcome.extraRules === 0 && outcome.tested === rules.length, JSON.stringify(outcome));
  check('...and none can hide or disable the page itself', outcome.pageHidden === 0, JSON.stringify(outcome));
  console.log(`      (${outcome.tested} rule texts tested; Chrome's :is() quietly ignores any inner selector it cannot parse, so a refusal count here would not be meaningful)`);


  // 10. Importing a settings file: the page shows what it would do first, and "no" changes nothing
  await send({ type: 'importSettings', text: '{}' });
  await control.reload();
  const friendFile = { name: 'friend.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
    placeholder: 'black',
    sites: [{ host: 'bank.test', mode: 'paused' }],
    custom: [{ host: 'news.test', selector: '#warning-banner' }, { host: 'news.test', selector: '} body { display:none' }]
  })) };
  const asked = [];
  control.once('dialog', async (d) => { asked.push(d.message()); await d.dismiss(); });
  await control.setInputFiles('#importFile', friendFile);
  await control.waitForFunction(() => document.getElementById('status').textContent.includes('cancelled'));
  const afterNo = (await send({ type: 'getSettings' })).settings;
  const msg = asked[0] ?? '';
  check('import: the preview names the paused site and the hide rule', /bank\.test/.test(msg) && /#warning-banner/.test(msg) && /REPLACE/.test(msg), msg);
  check('import: the preview leaves out the hostile rule the extension would refuse', !msg.includes('display:none'), msg);
  check('import: saying no changes nothing', afterNo.sites.length === 0 && afterNo.custom.length === 0 && afterNo.placeholder === 'collapse', JSON.stringify(afterNo));
  control.once('dialog', (d) => d.accept());
  await control.setInputFiles('#importFile', friendFile);
  await control.waitForFunction(() => document.getElementById('status').textContent === 'Imported.');
  const afterYes = (await send({ type: 'getSettings' })).settings;
  check('import: saying yes applies it', afterYes.placeholder === 'black' && afterYes.sites.length === 1 && afterYes.custom.length === 1, JSON.stringify(afterYes));
  let dialogs = 0;
  control.on('dialog', async (d) => { dialogs++; await d.dismiss(); });
  await control.setInputFiles('#importFile', { name: 'junk.json', mimeType: 'application/json', buffer: Buffer.from('not json at all') });
  await control.waitForFunction(() => document.getElementById('status').classList.contains('error'));
  check('import: a junk file is refused with a message and no question', dialogs === 0 && (await control.textContent('#status')).includes('not valid JSON'), await control.textContent('#status'));
  control.removeAllListeners('dialog');
  await send({ type: 'importSettings', text: '{}' });
}
