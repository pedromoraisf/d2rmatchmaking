import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cargoMutantsScore } from '../lib/collect.mjs';
import { mergeDirectory } from '../nightly/merge-mutants.mjs';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'nightly');

test('mergeDirectory writes one outcomes.json per crate where the ratchet reads it (NGT-01)', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ngt-merge-'));
  try {
    const put = (fixture, artifact) => {
      const target = path.join(root, 'in', artifact, 'mutants.out', 'outcomes.json');
      mkdirSync(path.dirname(target), { recursive: true });
      cpSync(path.join(fixtures, fixture), target);
    };
    put('cargo-mutants-domain.json', 'agent-mutation-domain-1');
    put('cargo-mutants-adapters.json', 'agent-mutation-domain-2');
    put('cargo-mutants-core-baseline-failed.json', 'agent-mutation-core');
    mkdirSync(path.join(root, 'in', 'api-mutation-domain'), { recursive: true });

    const written = mergeDirectory(path.join(root, 'in'), path.join(root, 'out'));
    assert.deepEqual(written.map((f) => path.relative(path.join(root, 'out'), f)).sort(), [
      path.join('agent-core', 'mutants.out', 'outcomes.json'),
      path.join('agent-domain', 'mutants.out', 'outcomes.json'),
    ]);
    const domain = JSON.parse(
      readFileSync(
        written.find((f) => f.includes('agent-domain')),
        'utf8',
      ),
    );
    assert.equal(domain.missed, 4);
    assert.equal(cargoMutantsScore(domain), 63.64);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('mergeDirectory with no reports writes nothing', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ngt-merge-'));
  try {
    assert.deepEqual(mergeDirectory(path.join(root, 'absent'), path.join(root, 'out')), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('mergeDirectory merges the four domain shards of the nightly into one agent-domain file (NGT-01)', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ngt-merge-'));
  try {
    for (const k of [1, 2, 3, 4]) {
      const target = path.join(root, 'in', `agent-mutation-domain-${k}`, 'mutants.out', 'outcomes.json');
      mkdirSync(path.dirname(target), { recursive: true });
      cpSync(path.join(fixtures, 'cargo-mutants-domain.json'), target);
    }
    const written = mergeDirectory(path.join(root, 'in'), path.join(root, 'out'));
    assert.equal(written.length, 1);
    const single = JSON.parse(readFileSync(path.join(fixtures, 'cargo-mutants-domain.json'), 'utf8'));
    const merged = JSON.parse(readFileSync(written[0], 'utf8'));
    assert.equal(merged.caught, single.caught * 4);
    assert.equal(merged.missed, single.missed * 4);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
