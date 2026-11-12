// The text checks of the pt-BR scenarios (JRN-07): which strings a screen shows that are a catalogue key or an English
// source string where Portuguese is expected. Pure functions over the catalogues and the strings a page showed, so the
// rules are unit-tested (journey-text.test.ts) and the scenario only reads the page.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** A translation file as JSON: nested objects whose leaves are strings. */
export type Catalogue = { readonly [key: string]: string | Catalogue };

const repoRoot = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const LOCALES = path.join(repoRoot, 'apps', 'web', 'src', 'shared', 'locales');

/** The site's English and pt-BR catalogues, read from the files the site ships (not imported: the suite is black box). */
export function siteCatalogues(): { readonly en: Catalogue; readonly ptBR: Catalogue } {
  const read = (file: string) => JSON.parse(readFileSync(path.join(LOCALES, file), 'utf8')) as Catalogue;
  return { en: read('en.json'), ptBR: read('pt-BR.json') };
}

/** Every leaf of a catalogue by its dotted key path. */
export function flatten(node: Catalogue, prefix = ''): Map<string, string> {
  const leaves = new Map<string, string>();
  for (const [key, child] of Object.entries(node)) {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    if (typeof child === 'string') {
      leaves.set(path, child);
    } else {
      for (const [inner, text] of flatten(child, path)) {
        leaves.set(inner, text);
      }
    }
  }
  return leaves;
}

const PLACEHOLDER = /\{\{\w+\}\}/gu;
/** Fewer literal characters than this make a string too short to tell English from Portuguese ("OK", "Run"). */
const MIN_LITERAL = 4;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/** A pattern that matches a whole shown string made from this catalogue string, placeholders standing for any text. */
function patternOf(source: string): RegExp {
  const parts = source.split(PLACEHOLDER).map(escapeRegExp);
  return new RegExp(`^${parts.join('.+?')}$`, 'u');
}

/** The catalogue keys a page shows as they are: i18next prints the key itself when a translation is missing. */
export function shownKeys(shown: readonly string[], en: Catalogue): string[] {
  const keys = new Set(flatten(en).keys());
  return [...new Set(shown.filter((text) => keys.has(text)))];
}

/**
 * The shown strings that are an English source string with a different Portuguese value. A string that is the same in both
 * languages ("PvP", "Hell") is not a finding, nor one the Portuguese value would match too, nor one with markup inside
 * (`<kbd>`), which the key-parity unit test covers.
 */
export function shownEnglish(shown: readonly string[], en: Catalogue, ptBR: Catalogue): string[] {
  const portuguese = flatten(ptBR);
  const found = new Set<string>();
  for (const [key, english] of flatten(en)) {
    const translated = portuguese.get(key);
    if (translated === undefined || translated === english || english.includes('<')) {
      continue;
    }
    if (english.replace(PLACEHOLDER, '').trim().length < MIN_LITERAL) {
      continue;
    }
    const inEnglish = patternOf(english);
    const inPortuguese = patternOf(translated);
    for (const text of shown) {
      if (inEnglish.test(text) && !inPortuguese.test(text)) {
        found.add(text);
      }
    }
  }
  return [...found];
}
