// The merge of the sharded ocr-variations job and the per-print budget (ocr-real.yml).
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  PRINT_BUDGET_MINUTES,
  checkBudget,
  findPartials,
  formatRefusals,
  mergeShards,
  refusalReasons,
} from '../agent/ocr-variations-shards.mjs';

const script = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'agent',
  'ocr-variations-shards.mjs',
);

const FOLDER = ['a.png', 'b.png', 'c.png', 'd.png', 'e.png'];
// Per print: [correct, refused, wrong] over three variations in two families.
const COUNTS = {
  'a.png': [3, 0, 0],
  'b.png': [1, 1, 1],
  'c.png': [0, 2, 1],
  'd.png': [2, 1, 0],
  'e.png': [0, 0, 3],
};

function unsharded() {
  const totals = { correct: 0, refused: 0, wrong: 0 };
  const variants = [];
  const byPrint = {};
  const families = { scale: {}, shift: {} };
  // Refusals alternate between two classes, counted here by hand (not with the code under test).
  const refusalTotal = {};
  const refusalByPrint = {};
  for (const name of FOLDER) {
    const [correct, refused, wrong] = COUNTS[name];
    totals.correct += correct;
    totals.refused += refused;
    totals.wrong += wrong;
    byPrint[name] = { correct, refused, wrong };
    families.scale[name] = { correct, refused, wrong };
    families.shift[name] = { correct: 0, refused: 0, wrong: 0 };
    const outcomes = [
      ...Array(correct).fill('correct'),
      ...Array(refused).fill('refused'),
      ...Array(wrong).fill('wrong'),
    ];
    refusalByPrint[name] = {};
    let refusedSoFar = 0;
    outcomes.forEach((outcome, n) => {
      let reason = 'none';
      if (outcome === 'refused') {
        reason = refusedSoFar % 2 === 0 ? 'no-card' : 'title-unseen';
        refusedSoFar += 1;
        refusalByPrint[name][reason] = (refusalByPrint[name][reason] ?? 0) + 1;
        refusalTotal[reason] = (refusalTotal[reason] ?? 0) + 1;
      }
      variants.push({ screenshot: name, id: `v${n}`, family: 'scale', outcome, reason_class: reason });
    });
  }
  return {
    seed: 7,
    combos: 3,
    totals,
    supported: { variations: 15, ...totals },
    totals_by_screenshot: byPrint,
    families,
    elapsed_seconds: Object.fromEntries(FOLDER.map((name, n) => [name, 60 * (n + 1)])),
    variants,
    refusal_reasons: { total: refusalTotal, by_screenshot: refusalByPrint },
  };
}

/** What shard `index` of `count` writes: the round-robin share of the folder, as the Rust side picks it. */
function partial(index, count) {
  const whole = unsharded();
  const assigned = FOLDER.filter((_, n) => n % count === index - 1);
  const pick = (object) =>
    Object.fromEntries(Object.entries(object).filter(([name]) => assigned.includes(name)));
  const totals = { correct: 0, refused: 0, wrong: 0 };
  for (const name of assigned)
    for (const key of Object.keys(totals)) totals[key] += whole.totals_by_screenshot[name][key];
  return {
    seed: 7,
    combos: 3,
    totals,
    supported: { variations: totals.correct + totals.refused + totals.wrong, ...totals },
    totals_by_screenshot: pick(whole.totals_by_screenshot),
    families: Object.fromEntries(Object.entries(whole.families).map(([family, per]) => [family, pick(per)])),
    elapsed_seconds: pick(whole.elapsed_seconds),
    variants: whole.variants.filter((variant) => assigned.includes(variant.screenshot)),
    shard: { index, count, folder_prints: FOLDER, assigned },
  };
}

const all = (count) => Array.from({ length: count }, (_, n) => partial(n + 1, count));

test('the merge of the shards equals the unsharded run, whatever the shard count', () => {
  for (const count of [1, 2, 3, 5]) {
    assert.deepEqual(mergeShards(all(count), count), unsharded(), `${count} shards`);
  }
});

test('the merge does not depend on the order the artifacts arrive in', () => {
  assert.deepEqual(mergeShards(all(3).reverse(), 3), unsharded());
});

test('the merged totals are the sum of the shards, and the ratchet pointers read them', () => {
  const merged = mergeShards(all(3), 3);
  const sum = (key) => all(3).reduce((total, p) => total + p.supported[key], 0);
  assert.equal(merged.supported.correct, sum('correct'));
  assert.equal(merged.supported.wrong, sum('wrong'));
  assert.equal(merged.supported.correct, 6);
  assert.equal(merged.supported.wrong, 5);
});

test('a missing shard fails the merge', () => {
  const partials = all(4);
  partials.splice(2, 1);
  assert.throws(() => mergeShards(partials, 4), /shard 3\/4 is missing/);
  assert.throws(() => mergeShards([], 2), /shard 1\/2 is missing/);
});

test('a shard present twice fails the merge', () => {
  const partials = all(3);
  partials.push(partial(2, 3));
  assert.throws(() => mergeShards(partials, 3), /shard 2\/3 is present more than once/);
});

test('a shard of another split or without a shard entry fails the merge', () => {
  const partials = all(3);
  assert.throws(() => mergeShards(partials, 4), /is not of a 4-shard run/);
  delete partials[0].shard;
  assert.throws(() => mergeShards(partials, 3), /has no shard entry/);
});

test('a print counted by two shards fails the merge', () => {
  const partials = all(2);
  const stolen = partials[0].variants[0];
  partials[1].variants.push({ ...stolen });
  assert.throws(() => mergeShards(partials, 2), /read a\.png, which is not its print/);
  const both = all(2);
  both[1].shard.assigned.push('a.png');
  assert.throws(() => mergeShards(both, 2), /a\.png is assigned to shards 1 and 2/);
});

test('a print counted by no shard fails the merge', () => {
  const dropped = all(2);
  dropped[1].shard.assigned = dropped[1].shard.assigned.filter((name) => name !== 'b.png');
  dropped[1].variants = dropped[1].variants.filter((variant) => variant.screenshot !== 'b.png');
  assert.throws(() => mergeShards(dropped, 2), /not read by any shard: b\.png/);
  const unread = all(2);
  unread[0].variants = unread[0].variants.filter((variant) => variant.screenshot !== 'c.png');
  assert.throws(() => mergeShards(unread, 2), /c\.png \(shard 1\/2\) was not counted/);
});

test('shards that saw different folders, seeds or combos fail the merge', () => {
  const folders = all(2);
  folders[1].shard.folder_prints = FOLDER.slice(0, 4);
  assert.throws(() => mergeShards(folders, 2), /other prints in the folder/);
  const seeds = all(2);
  seeds[1].seed = 8;
  assert.throws(() => mergeShards(seeds, 2), /another seed or combos/);
});

test('the budget is 20 minutes per print and a slow print fails with its name', () => {
  assert.equal(PRINT_BUDGET_MINUTES, 20);
  const at = (seconds) => ({ elapsed_seconds: { 'fast.png': 30, 'edge.png': seconds } });
  assert.deepEqual(checkBudget(at(1200)), [
    ['edge.png', 1200],
    ['fast.png', 30],
  ]);
  assert.throws(() => checkBudget(at(1201)), /over the per-print budget of 20 min: edge\.png took 20\.0 min/);
  assert.throws(() => checkBudget(at(601), 10), /budget of 10 min: edge\.png/);
  assert.throws(() => checkBudget({}), /no elapsed_seconds/);
});

test('the command line merges a folder of artifacts and fails on a missing shard', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ocr-shards-'));
  for (const p of all(3)) {
    mkdirSync(path.join(dir, `ocr-variations-${p.shard.index}`));
    writeFileSync(
      path.join(dir, `ocr-variations-${p.shard.index}`, 'ocr-variations.json'),
      JSON.stringify(p),
    );
  }
  assert.equal(findPartials(dir).length, 3);
  const out = path.join(mkdtempSync(path.join(tmpdir(), 'ocr-merged-')), 'merged.json');
  const ok = spawnSync('node', [script, 'merge', '--dir', dir, '--count', '3', '--out', out], {
    encoding: 'utf8',
  });
  assert.equal(ok.status, 0, ok.stderr);
  assert.deepEqual(JSON.parse(readFileSync(out, 'utf8')), unsharded());
  const missing = spawnSync('node', [script, 'merge', '--dir', dir, '--count', '4', '--out', out], {
    encoding: 'utf8',
  });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /is not of a 4-shard run/);
  const none = spawnSync(
    'node',
    [script, 'merge', '--dir', path.join(dir, 'nope'), '--count', '3', '--out', out],
    {
      encoding: 'utf8',
    },
  );
  assert.equal(none.status, 1);
  assert.match(none.stderr, /no shard uploaded/);
});

test('the command line budget check exits 1 over the budget', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ocr-budget-'));
  const file = path.join(dir, 'p.json');
  writeFileSync(file, JSON.stringify({ elapsed_seconds: { 'slow.png': 1300 } }));
  const slow = spawnSync('node', [script, 'budget', '--json', file], { encoding: 'utf8' });
  assert.equal(slow.status, 1);
  assert.match(slow.stderr, /slow\.png took 21\.7 min/);
  writeFileSync(file, JSON.stringify({ elapsed_seconds: { 'ok.png': 1100 } }));
  const fine = spawnSync('node', [script, 'budget', '--json', file], { encoding: 'utf8' });
  assert.equal(fine.status, 0, fine.stderr);
  assert.match(fine.stdout, /ok\.png: 18\.3 min \(budget 20 min\)/);
});

test('the merge counts refusals by reason class, per print and in total, from the variants', () => {
  const merged = mergeShards(all(3), 3);
  assert.deepEqual(merged.refusal_reasons.total, { 'no-card': 3, 'title-unseen': 1 });
  assert.deepEqual(merged.refusal_reasons.by_screenshot['c.png'], { 'no-card': 1, 'title-unseen': 1 });
  assert.deepEqual(merged.refusal_reasons.by_screenshot['a.png'], {});
});

test('refusals are formatted most frequent first, then by name, and nothing when none was refused', () => {
  assert.equal(
    formatRefusals({ 'title-unseen': 30, 'no-card': 120, 'a-class': 30 }),
    'refused: no-card 120, a-class 30, title-unseen 30',
  );
  assert.equal(formatRefusals({}), null);
  assert.deepEqual(
    refusalReasons([
      { outcome: 'refused', reason_class: 'x' },
      { outcome: 'wrong', reason_class: 'x' },
      { outcome: 'refused', reason_class: 'x' },
    ]),
    { x: 2 },
  );
});

test('the merge command prints the refusal reasons per print and for all prints', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ocr-shards-reasons-'));
  all(2).forEach((p, n) => writeFileSync(path.join(dir, `p${n}.json`), JSON.stringify(p)));
  const out = path.join(dir, 'merged', 'ocr-variations.json');
  mkdirSync(path.dirname(out));
  const run = spawnSync('node', [script, 'merge', '--dir', dir, '--count', '2', '--out', out], {
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /^ {2}c\.png: refused: no-card 1, title-unseen 1$/m);
  assert.match(run.stdout, /^all prints: refused: no-card 3, title-unseen 1$/m);
  assert.deepEqual(JSON.parse(readFileSync(out, 'utf8')).refusal_reasons, unsharded().refusal_reasons);
});

test('chat-no-phrase ops are counted under the bare class and never printed', () => {
  const counts = refusalReasons([
    { outcome: 'refused', reason_class: 'chat-no-phrase:sub(a>b)@3' },
    { outcome: 'refused', reason_class: 'chat-no-phrase:del(c)@1' },
    { outcome: 'refused', reason_class: 'no-card' },
  ]);
  assert.deepEqual(counts, { 'chat-no-phrase': 2, 'no-card': 1 });
  assert.equal(formatRefusals(counts), 'refused: chat-no-phrase 2, no-card 1');
});
