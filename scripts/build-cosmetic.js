// Generates src/content/page-cleanup.css from rules/cosmetic.json.
//   npm run build         writes the file
//   npm run build -- --check   fails if the committed file is out of date
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateCosmeticConfig, buildCss, adDomainsFromRules } from '../src/shared/cosmetic.js';
import { validateRuleList } from '../src/shared/rules-validate.js';

const root = (p) => fileURLToPath(new URL('../' + p, import.meta.url));
const config = JSON.parse(readFileSync(root('rules/cosmetic.json'), 'utf8'));
const rules = JSON.parse(readFileSync(root('rules/default-rules.json'), 'utf8'));

const problems = [...validateCosmeticConfig(config), ...validateRuleList(rules)];
if (problems.length > 0) {
  console.error('Cannot build. Fix these first:\n- ' + problems.join('\n- '));
  process.exit(1);
}

const css = buildCss(config, adDomainsFromRules(rules));
const target = root('src/content/page-cleanup.css');

if (process.argv.includes('--check')) {
  const current = existsSync(target) ? readFileSync(target, 'utf8') : '';
  if (current !== css) {
    console.error('src/content/page-cleanup.css is out of date. Run: npm run build');
    process.exit(1);
  }
  console.log('page-cleanup.css is up to date');
} else {
  writeFileSync(target, css);
  console.log(`Wrote src/content/page-cleanup.css (${css.length} bytes)`);
}
