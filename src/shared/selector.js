// CSS selector safety check, shared by the bundled list, user settings and imports.
// Pure, no browser APIs. Every selector that ends up inside a stylesheet passes
// through selectorProblem() first, so a bad entry can never break out of its rule.
//
// Two strictness levels:
//  - default (strict): for anything a person types or imports.
//      * No pseudo-classes (:not, :has, :is, :root ...): they can match far more than
//        intended (":not(.x)" matches almost every element) and nested :has() is slow.
//      * Every attribute check must be the plain form [name] or [name op value], and must
//        have a value. Namespace forms such as [*|class] are refused: Chrome reads
//        "[*|class]" as "has any class" and it hides most of a page.
//      * Substring checks need at least 3 characters.
//      * No reference to MAD Blocker's own page markers (data-mad...): they are on every page.
//      * The LAST part (the element that actually gets hidden) must name a class, an id or an
//        attribute, or be a custom element such as amp-ad. "[lang=en] div" is refused because
//        it would hide every div on an English page.
//      * At most MAX_PARTS parts, so long chains cannot make style matching slow.
//  - { allowPseudo: true }: for the bundled, code-reviewed list only (it uses :has).
//
// This check cannot prove that a rule hides only ads: "[class*=content]" is still
// valid. What it guarantees is that a rule cannot escape its own CSS rule, cannot
// name the whole page, and cannot use the forms that make rules unpredictable.
// The stylesheet that applies custom rules also adds :not(body):not(html) as a last
// line of defence (see customRuleCss in cosmetic.js). Because a hostile settings file is
// still possible, the settings page shows what an import contains before applying it.
//
// src/content/page-cleanup.js keeps a copy of the strict check (content scripts cannot
// import modules). tests/content-script.test.js and tests/fuzz.test.js prove the two
// copies agree.

export const MAX_SELECTOR_LENGTH = 200;
export const MIN_SUBSTRING_VALUE = 3;
export const MAX_PARTS = 5;

// Letters, digits and the characters CSS selectors need. No braces, semicolons,
// backslashes, angle brackets, commas or at-signs.
const SAFE_CHARS = /^[A-Za-z0-9_\-.#[\]=^$*~|:>+ ()"'/%]+$/;

// [name], or [name op value] with an optional i/s flag. Used only in strict mode.
const ATTRIBUTE_RE = /\[\s*([^\]=~|^$*\s]+)\s*(?:([~|^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s"']*))\s*(?:[iIsS]\s*)?)?\]/g;

/** Returns a problem description, or null if the selector is acceptable. */
export function selectorProblem(selector, options = {}) {
  if (typeof selector !== 'string') return 'not a string';
  if (selector.length === 0 || selector.length > MAX_SELECTOR_LENGTH) return 'wrong length';
  if (selector !== selector.trim()) return 'has leading or trailing spaces';
  if (!SAFE_CHARS.test(selector)) return 'contains a character that is not allowed';
  if (selector.includes('/*') || selector.includes('*/')) return 'contains a comment marker';
  if (/url\s*\(|expression\s*\(|javascript:/i.test(selector)) return 'contains a forbidden word';

  // Remove quoted attribute values, then make sure nothing is left unbalanced.
  const bare = selector.replace(/"[^"]*"|'[^']*'/g, 'Q');
  if (/["']/.test(bare)) return 'has an unclosed quote';
  let square = 0;
  let round = 0;
  for (const ch of bare) {
    if (ch === '[') square++;
    else if (ch === ']') square--;
    else if (ch === '(') round++;
    else if (ch === ')') round--;
    if (square < 0 || round < 0) return 'has unbalanced brackets';
  }
  if (square !== 0 || round !== 0) return 'has unbalanced brackets';

  // Too-broad guards: never target the whole page or bare element names.
  // Case-insensitive, because HTML element names are (BODY matches <body>).
  if (/(^|[\s>+~(])(html|body|\*)(?![\w-])/i.test(bare)) return 'targets the whole page';
  if (!/[.#[]/.test(bare) && !/(^|[\s>+~])[a-z]+-[a-z-]+(?![\w-])/.test(bare)) {
    return 'is too broad (add a class, id or attribute)';
  }

  if (!options.allowPseudo) {
    if (bare.includes(':')) return 'uses a pseudo-class such as :not or :has, which can match far more than intended';
    // Every "[" must start an attribute check in a plain form that the pattern above recognises.
    const attributes = [...selector.matchAll(ATTRIBUTE_RE)];
    if (attributes.length !== (bare.match(/\[/g) ?? []).length) {
      return 'has an attribute check in a form that is not allowed (for example [*|class])';
    }
    if (/data-mad/i.test(selector)) return "refers to MAD Blocker's own page markers, which are on every page";
    for (const m of attributes) {
      if (m[2] === undefined) return 'has an attribute check without a value, which matches too much';
      const value = m[3] ?? m[4] ?? m[5] ?? '';
      if (m[2] !== '=' && value.length < MIN_SUBSTRING_VALUE) {
        return `has an attribute value shorter than ${MIN_SUBSTRING_VALUE} characters, which matches too much`;
      }
    }
    const parts = bare.replace(/\[[^\]]*\]/g, '[]').split(/\s*[>+~]\s*|\s+/);
    if (parts.length > MAX_PARTS) return `has more than ${MAX_PARTS} parts`;
    const last = parts[parts.length - 1];
    if (!/[.#[]/.test(last) && !/^[a-z][a-z0-9]*-[a-z0-9-]*$/i.test(last)) {
      return 'must end with a class, id or attribute, so it cannot match every element of one kind';
    }
  }
  return null;
}
