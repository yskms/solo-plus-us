#!/usr/bin/env node
/**
 * `npm run check-i18n` — the safety net `CLAUDE.md`/設計判断記録 D-53
 * reference in place of compile-time key checking. `types/i18next.d.ts`
 * deliberately does NOT type `t()`'s key argument against
 * `locales/en.json` (tried once, reverted — see that file's doc comment:
 * react-i18next's overload resolution broke down at this resource tree's
 * size, ~150+ keys and growing, misrouting valid calls to the wrong
 * overload). Without that, a typo'd or removed `t('...')` key compiles
 * fine and only fails at runtime (rendering the raw key, or i18next's own
 * missing-key warning) — this script is what actually catches that,
 * meant to be run after adding/renaming translation keys, not on every
 * commit.
 *
 * Checks, across app/ components/ contexts/ screens/ services/ lib/
 * (excluding __tests__ and lib/i18n itself):
 *   1. Every `t('some.key')` / `t("some.key")` literal used in source
 *      exists in both locales/en.json and locales/ja.json — a plural base
 *      (e.g. `today.activities`) counts as present if any CLDR-suffixed
 *      variant (`_one`/`_other`/etc.) exists.
 *   2. Every leaf key actually defined in locales/en.json is referenced
 *      by at least one `t(...)` call somewhere (its plural base, for a
 *      suffixed key) — catches translations that were added but never
 *      wired up, or whose call site was since deleted.
 *   3. Every plural base that has ANY CLDR suffix in en.json has both
 *      `_one` and `_other` (English needs both categories) — catches
 *      "added `_other`, forgot `_one`" the other two checks above can't
 *      see (they treat any single suffix as "the base key exists").
 *      ja.json only needs `_other` (Japanese has one plural category),
 *      checked against whichever suffix pattern the base actually uses
 *      in ja.json (bare key or `_other` — both are valid there, see
 *      CLAUDE.md).
 *   4. For every leaf key present in both locales, the set of
 *      `{{placeholder}}` interpolation variables matches between the en
 *      and ja strings — catches a translation that dropped or renamed a
 *      variable (e.g. `{{count}}` present in en, missing in ja), which
 *      i18next won't error on — it just leaves the literal
 *      `{{placeholder}}` text in the rendered string.
 *   5. Array-valued leaves (e.g. `common.months`) have the same length in
 *      both locales — a length mismatch means an index that's valid in
 *      one language reads `undefined` in the other.
 *
 * Only catches literal string keys — `t(someVariable)` (no dynamic keys
 * exist in this codebase today) isn't inspected.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SOURCE_DIRS = ['app', 'components', 'contexts', 'screens', 'services', 'lib'];
const EXCLUDE_DIR_NAMES = ['node_modules', '__tests__', 'i18n'];
const SOURCE_EXTENSIONS = ['.ts', '.tsx'];
const PLURAL_SUFFIXES = ['_zero', '_one', '_two', '_few', '_many', '_other'];
const PLURAL_SUFFIX_PATTERN = new RegExp(`(${PLURAL_SUFFIXES.join('|')})$`);

/**
 * Keys deliberately exempted from check 4 ({{variable}} parity). A locale
 * whose date/time *format itself* differs structurally (not just its
 * words — see CLAUDE.md's i18n section) legitimately uses a different
 * subset of a shared interpolation payload per language, e.g.
 * `today.dateHeader`: the caller (`app/(tabs)/index.tsx`'s
 * `weekdayHeader()`) always passes both `weekdayFull` and `weekdayShort`,
 * and each language's template picks whichever one its natural date
 * format needs — en uses the full weekday name, ja the single-kanji
 * short form in a "(日)"-style suffix. Add a key here only with the same
 * kind of reasoning, not to silence a real mismatch.
 */
const VARIABLE_PARITY_EXEMPT_KEYS = new Set(['today.dateHeader']);

function walk(dir) {
  let results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDE_DIR_NAMES.includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(walk(full));
    } else if (SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      results.push(full);
    }
  }
  return results;
}

function collectUsedKeys() {
  const usedKeys = new Set();
  const keyRegex = /\bt\(\s*['"]([a-zA-Z0-9_.]+)['"]/g;
  for (const dirName of SOURCE_DIRS) {
    const dir = path.join(ROOT, dirName);
    if (!fs.existsSync(dir)) continue;
    for (const file of walk(dir)) {
      const content = fs.readFileSync(file, 'utf8');
      let match;
      while ((match = keyRegex.exec(content))) {
        usedKeys.add(match[1]);
      }
    }
  }
  return usedKeys;
}

/** Leaf key -> raw value (string or array), not just a Set of key names, so callers can inspect the value itself. */
function flattenLeaves(obj, prefix = '') {
  const leaves = new Map();
  for (const k of Object.keys(obj)) {
    const full = prefix ? `${prefix}.${k}` : k;
    const value = obj[k];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [nestedKey, nestedValue] of flattenLeaves(value, full)) leaves.set(nestedKey, nestedValue);
    } else {
      leaves.set(full, value);
    }
  }
  return leaves;
}

function resourceHasKey(leaves, key) {
  if (leaves.has(key)) return true;
  return PLURAL_SUFFIXES.some((suffix) => leaves.has(key + suffix));
}

/** Every distinct plural base with at least one CLDR-suffixed sibling in `leaves` (e.g. "today.activities" from "today.activities_one"). */
function pluralBases(leaves) {
  const bases = new Set();
  for (const key of leaves.keys()) {
    if (PLURAL_SUFFIX_PATTERN.test(key)) bases.add(key.replace(PLURAL_SUFFIX_PATTERN, ''));
  }
  return bases;
}

function interpolationVars(value) {
  if (typeof value !== 'string') return null;
  const vars = new Set();
  const re = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
  let m;
  while ((m = re.exec(value))) vars.add(m[1]);
  return vars;
}

function setsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

function main() {
  const en = JSON.parse(fs.readFileSync(path.join(ROOT, 'locales/en.json'), 'utf8'));
  const ja = JSON.parse(fs.readFileSync(path.join(ROOT, 'locales/ja.json'), 'utf8'));
  const enLeaves = flattenLeaves(en);
  const jaLeaves = flattenLeaves(ja);
  const usedKeys = collectUsedKeys();

  let problems = 0;
  const report = (title, items, render) => {
    if (items.length === 0) return;
    problems += items.length;
    console.log(`\n❌ ${title} (${items.length}):`);
    for (const item of items) console.log(`   ${render(item)}`);
  };

  report(
    "t('...') keys used in source but missing from locales/en.json",
    [...usedKeys].filter((k) => !resourceHasKey(enLeaves, k)).sort(),
    (k) => k,
  );
  report(
    "t('...') keys used in source but missing from locales/ja.json",
    [...usedKeys].filter((k) => !resourceHasKey(jaLeaves, k)).sort(),
    (k) => k,
  );

  // Check 3: plural suffix pairing.
  const enBases = pluralBases(enLeaves);
  const jaBases = pluralBases(jaLeaves);
  report(
    'plural bases in en.json missing `_one` or `_other` (English needs both)',
    [...enBases]
      .filter((base) => !(enLeaves.has(`${base}_one`) && enLeaves.has(`${base}_other`)))
      .sort(),
    (base) => `${base} (has: ${PLURAL_SUFFIXES.filter((s) => enLeaves.has(base + s)).join(', ') || 'none'})`,
  );
  report(
    'plural bases in ja.json with neither a bare key nor `_other` (Japanese needs one of the two)',
    [...jaBases].filter((base) => !(jaLeaves.has(base) || jaLeaves.has(`${base}_other`))).sort(),
    (base) => base,
  );

  // Check 4: interpolation variable parity, for keys present (as a leaf, not just a plural base) in both locales.
  const sharedStringKeys = [...enLeaves.keys()].filter(
    (k) => jaLeaves.has(k) && typeof enLeaves.get(k) === 'string' && typeof jaLeaves.get(k) === 'string',
  );
  const varMismatches = [];
  for (const key of sharedStringKeys) {
    if (VARIABLE_PARITY_EXEMPT_KEYS.has(key)) continue;
    const enVars = interpolationVars(enLeaves.get(key));
    const jaVars = interpolationVars(jaLeaves.get(key));
    if (!setsEqual(enVars, jaVars)) {
      varMismatches.push(`${key} — en: {${[...enVars].join(', ')}} vs ja: {${[...jaVars].join(', ')}}`);
    }
  }
  report('{{variable}} mismatches between en.json and ja.json for the same key', varMismatches.sort(), (m) => m);

  // Check 5: array length parity.
  const sharedArrayKeys = [...enLeaves.keys()].filter(
    (k) => jaLeaves.has(k) && Array.isArray(enLeaves.get(k)) && Array.isArray(jaLeaves.get(k)),
  );
  const arrayLengthMismatches = sharedArrayKeys
    .filter((k) => enLeaves.get(k).length !== jaLeaves.get(k).length)
    .map((k) => `${k} — en: ${enLeaves.get(k).length} item(s) vs ja: ${jaLeaves.get(k).length} item(s)`);
  report('array-valued keys with mismatched lengths between en.json and ja.json', arrayLengthMismatches.sort(), (m) => m);

  const unusedEn = [...enLeaves.keys()]
    .filter((k) => {
      const base = k.replace(PLURAL_SUFFIX_PATTERN, '');
      return !usedKeys.has(k) && !usedKeys.has(base);
    })
    .sort();
  if (unusedEn.length > 0) {
    // Informational, not a failure: some resource entries (e.g. `common.months`,
    // read via `t(key, { returnObjects: true })`) are legitimately not matched
    // by the plain `t('literal.key')` scan above — reviewed manually, not auto-failed.
    console.log(`\n⚠️  locales/en.json leaf keys with no matching t('...') call found (${unusedEn.length}, review manually):`);
    for (const k of unusedEn) console.log(`   ${k}`);
  }

  console.log(`\nChecked ${usedKeys.size} used key(s) against ${enLeaves.size} en.json / ${jaLeaves.size} ja.json leaf keys.`);

  if (problems > 0) {
    console.log(`\n${problems} problem(s) found.`);
    process.exit(1);
  }
  console.log('\nOK — no missing keys.');
}

main();
