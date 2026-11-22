// A new field cannot skip the tier (OBT-10, OBT-08; ADR 037). A staging-only key (the text the OCR read, a name read on
// screen, the BattleTag) is set only in the module that applies the tier: the agent's `core/src/detail.rs` (and the
// sanitizer that lists the keys) and the site's `shared/telemetry.ts`. Any other agent or site source that names one fails,
// so a step cannot put a name on a span without going through the tier. Test code is skipped. The key list is read from the
// two lists that hold it, so the rule follows them.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const readText = (file) => readFileSync(path.join(root, file), 'utf8');
const agent = 'apps/agent/src-tauri';

// The modules that apply the tier, relative to the repository root.
const TIER_MODULES = new Set([
  `${agent}/core/src/detail.rs`,
  `${agent}/adapters/src/telemetry/sanitize.rs`,
  'apps/web/src/shared/telemetry.ts',
]);

const SOURCES = [
  { dir: `${agent}/src`, ext: /\.rs$/u },
  { dir: `${agent}/core/src`, ext: /\.rs$/u },
  { dir: `${agent}/adapters/src`, ext: /\.rs$/u },
  { dir: `${agent}/domain/src`, ext: /\.rs$/u },
  { dir: 'apps/web/src', ext: /\.(ts|tsx)$/u },
];

/** The quoted strings of the list that `name` is assigned (`name ... = [` or `= new Set([`), up to its closing bracket. */
function quotedAfter(text, name) {
  const opening = new RegExp(`\\b${name}\\b[^=]*=\\s*(?:new Set\\()?\\[`, 'u').exec(text);
  assert.ok(opening, `${name} is assigned a list`);
  const start = opening.index + opening[0].length;
  const body = text.slice(start, text.indexOf(']', start));
  return [...body.matchAll(/["']([a-z0-9_.]+)["']/gu)].map((match) => match[1]);
}

/** The staging-only keys: the shared package's list and the agent's full-tier list. */
function stagingKeys() {
  const shared = quotedAfter(readText('packages/telemetry/src/redact-attributes.ts'), 'STAGING_ONLY_KEYS');
  const own = quotedAfter(readText(`${agent}/adapters/src/telemetry/sanitize.rs`), 'FULL_TIER_KEYS');
  return [...new Set([...shared, ...own])].filter((key) => key.includes('.'));
}

/** The non-test text of a source: a Rust file ends at its test module, comments are kept out of the search. */
function productionText(file, text) {
  const body = file.endsWith('.rs') ? text.split('#[cfg(test)]')[0] : text;
  return body
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/u.test(line))
    .join('\n');
}

/** The staging-only keys a text names as a string literal, in the order of `keys`. */
export function stagingKeysSetIn(text, keys) {
  return keys.filter((key) => text.includes(`"${key}"`) || text.includes(`'${key}'`));
}

function filesUnder(dir, ext) {
  const found = [];
  for (const entry of readdirSync(path.join(root, dir))) {
    const relative = `${dir}/${entry}`;
    if (statSync(path.join(root, relative)).isDirectory()) found.push(...filesUnder(relative, ext));
    else if (ext.test(entry) && !/\.test\.(ts|tsx)$/u.test(entry)) found.push(relative);
  }
  return found;
}

test('the staging-only key list holds the names, the read text and the BattleTag', () => {
  const keys = stagingKeys();
  for (const key of ['d2r.ocr.text', 'd2r.ocr.names', 'd2r.character.name', 'd2r.account.battletag']) {
    assert.ok(keys.includes(key), `${key} is a staging-only key`);
  }
  const own = quotedAfter(readText(`${agent}/adapters/src/telemetry/sanitize.rs`), 'FULL_TIER_KEYS');
  assert.deepEqual(own.sort(), [
    'd2r.account.battletag',
    'd2r.character.name',
    'd2r.ocr.names',
    'd2r.ocr.text',
  ]);
});

test('no agent or site source sets a staging-only key outside the module that applies the tier', () => {
  const keys = stagingKeys();
  for (const { dir, ext } of SOURCES) {
    for (const file of filesUnder(dir, ext)) {
      if (TIER_MODULES.has(file)) continue;
      assert.deepEqual(
        stagingKeysSetIn(productionText(file, readText(file)), keys),
        [],
        `${file} sets a staging-only key; go through the tier module`,
      );
    }
  }
});

test('the tier modules exist, so the allow-list names real files', () => {
  for (const file of TIER_MODULES) assert.ok(statSync(path.join(root, file)).isFile(), file);
});

test('the rule fails on fixtures that set a staging-only key and passes on one that does not', () => {
  const keys = stagingKeys();
  const fixtures = 'scripts/test/fixtures/telemetry-tier-source';
  const check = (name) => stagingKeysSetIn(productionText(name, readText(`${fixtures}/${name}`)), keys);
  assert.deepEqual(check('breaks.rs'), ['d2r.ocr.text']);
  assert.deepEqual(check('breaks.tsx'), ['d2r.account.battletag']);
  assert.deepEqual(check('passes.rs'), []);
});
