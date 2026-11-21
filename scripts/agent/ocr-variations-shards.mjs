#!/usr/bin/env node
// The sharded `ocr-variations` job (ocr-real.yml): each shard reads its share of the real prints (`ocr-check --variations
// --shard i/n`) and writes a partial ocr-variations.json; the final job merges them into the one file an unsharded run
// would have written, so the quality ratchet (context ocr) holds the same totals.
//
//   node scripts/agent/ocr-variations-shards.mjs budget --json <partial.json> [--minutes 20]
//   node scripts/agent/ocr-variations-shards.mjs merge --dir <folder with the partials> --count <n> --out <merged.json>
//
// Only counts, family names, print file names and variant ids pass through here: no read text, no image.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The longest the variations of one print may take. It keeps the purpose of the old job-wide cap: slow reading code fails. */
export const PRINT_BUDGET_MINUTES = 20;

const COUNT_KEYS = ['correct', 'refused', 'wrong'];

/** Fails when a print took longer than the budget. Returns the prints with their seconds, slowest first. */
export function checkBudget(partial, minutes = PRINT_BUDGET_MINUTES) {
  const elapsed = partial?.elapsed_seconds;
  if (typeof elapsed !== 'object' || elapsed === null) {
    throw new Error('the report has no elapsed_seconds');
  }
  const limit = minutes * 60;
  const slow = Object.entries(elapsed)
    .filter(([, seconds]) => seconds > limit)
    .sort((a, b) => b[1] - a[1]);
  if (slow.length > 0) {
    const list = slow.map(([name, seconds]) => `${name} took ${(seconds / 60).toFixed(1)} min`).join('; ');
    throw new Error(`over the per-print budget of ${minutes} min: ${list}`);
  }
  return Object.entries(elapsed).sort((a, b) => b[1] - a[1]);
}

function addCounts(into, from) {
  for (const key of COUNT_KEYS) into[key] = (into[key] ?? 0) + from[key];
}

function sameList(a, b) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * Merges the partial reports of the `count` shards into the report of one unsharded run. Throws when a shard is missing,
 * repeated, from another split or inconsistent, when two shards read the same print, or when a print of the folder is not
 * counted at all.
 */
export function mergeShards(partials, count) {
  if (!Number.isInteger(count) || count < 1)
    throw new Error(`the shard count ${count} is not a positive number`);
  const seen = new Map();
  for (const partial of partials) {
    const shard = partial?.shard;
    if (typeof shard !== 'object' || shard === null) throw new Error('a partial report has no shard entry');
    if (shard.count !== count)
      throw new Error(`shard ${shard.index}/${shard.count} is not of a ${count}-shard run`);
    if (seen.has(shard.index)) throw new Error(`shard ${shard.index}/${count} is present more than once`);
    seen.set(shard.index, partial);
  }
  for (let index = 1; index <= count; index += 1) {
    if (!seen.has(index)) throw new Error(`shard ${index}/${count} is missing`);
  }
  const ordered = [...seen.entries()].sort((a, b) => a[0] - b[0]).map(([, partial]) => partial);
  const folder = ordered[0].shard.folder_prints;
  const owner = new Map();
  for (const partial of ordered) {
    const { index, folder_prints: prints, assigned } = partial.shard;
    if (!sameList(prints, folder))
      throw new Error(`shard ${index}/${count} saw other prints in the folder than shard 1`);
    for (const name of assigned) {
      if (owner.has(name)) throw new Error(`${name} is assigned to shards ${owner.get(name)} and ${index}`);
      owner.set(name, index);
    }
    if (partial.seed !== ordered[0].seed || partial.combos !== ordered[0].combos) {
      throw new Error(`shard ${index}/${count} used another seed or combos count than shard 1`);
    }
  }
  const missing = folder.filter((name) => !owner.has(name));
  if (missing.length > 0) throw new Error(`not read by any shard: ${missing.join(', ')}`);

  const read = new Map();
  for (const partial of ordered) {
    const { index, assigned } = partial.shard;
    const counted = new Set(partial.variants.map((variant) => variant.screenshot));
    for (const name of counted) {
      if (!assigned.includes(name))
        throw new Error(`shard ${index}/${count} read ${name}, which is not its print`);
      if (read.has(name)) throw new Error(`${name} is counted by shards ${read.get(name)} and ${index}`);
      read.set(name, index);
    }
    for (const name of assigned) {
      if (!counted.has(name))
        throw new Error(`${name} (shard ${index}/${count}) was not counted: no variation was read`);
    }
  }

  const merged = {
    seed: ordered[0].seed,
    combos: ordered[0].combos,
    totals: {},
    supported: { variations: 0, correct: 0, refused: 0, wrong: 0 },
    totals_by_screenshot: {},
    families: {},
    elapsed_seconds: {},
    variants: [],
  };
  for (const partial of ordered) {
    addCounts(merged.totals, partial.totals);
    merged.supported.variations += partial.supported.variations;
    addCounts(merged.supported, partial.supported);
    Object.assign(merged.totals_by_screenshot, partial.totals_by_screenshot);
    Object.assign(merged.elapsed_seconds, partial.elapsed_seconds);
    for (const [family, perPrint] of Object.entries(partial.families)) {
      merged.families[family] = { ...merged.families[family], ...perPrint };
    }
    merged.variants.push(...partial.variants);
  }
  const position = new Map(folder.map((name, index) => [name, index]));
  merged.variants = merged.variants
    .map((variant, index) => ({ variant, index }))
    .sort(
      (a, b) => position.get(a.variant.screenshot) - position.get(b.variant.screenshot) || a.index - b.index,
    )
    .map(({ variant }) => variant);
  return merged;
}

function option(argv, flag, fallback) {
  const index = argv.indexOf(flag);
  if (index < 0 || argv[index + 1] === undefined) {
    if (fallback !== undefined) return fallback;
    throw new Error(`missing ${flag}`);
  }
  return argv[index + 1];
}

/** The partial reports in `dir` and below: one `ocr-variations.json` per downloaded artifact folder, or loose .json files. */
export function findPartials(dir) {
  const found = [];
  for (const entry of readdirSync(dir).sort()) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...findPartials(full));
    else if (entry.endsWith('.json')) found.push(full);
  }
  return found;
}

function main(argv) {
  const [command] = argv;
  if (command === 'budget') {
    const minutes = Number(option(argv, '--minutes', String(PRINT_BUDGET_MINUTES)));
    const partial = JSON.parse(readFileSync(option(argv, '--json'), 'utf8'));
    const times = checkBudget(partial, minutes);
    for (const [name, seconds] of times)
      console.log(`${name}: ${(seconds / 60).toFixed(1)} min (budget ${minutes} min)`);
  } else if (command === 'merge') {
    const dir = option(argv, '--dir');
    if (!existsSync(dir)) throw new Error(`${dir} does not exist: no shard uploaded its counts`);
    const partials = findPartials(dir).map((file) => JSON.parse(readFileSync(file, 'utf8')));
    const merged = mergeShards(partials, Number(option(argv, '--count')));
    writeFileSync(option(argv, '--out'), `${JSON.stringify(merged, null, 2)}\n`);
    console.log(
      `merged ${partials.length} shards: ${merged.supported.variations} supported variations, ` +
        `${merged.supported.correct} correct, ${merged.supported.refused} refused, ${merged.supported.wrong} wrong.`,
    );
  } else {
    throw new Error('usage: ocr-variations-shards.mjs budget|merge ...');
  }
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`ocr-variations-shards: ${error.message}`);
    process.exit(1);
  }
}
