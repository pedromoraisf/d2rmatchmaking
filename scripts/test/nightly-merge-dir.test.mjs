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
