// Acceptance steps for ocr-protection (ADR 023), one step per line of acceptance.feature. Black box: the steps read the
// repository's rule files and run the mutation config check as a command, on a temporary copy of the config. The
// Background ("a contributor has a clean checkout with dependencies installed") lives in harness-foundation.steps.ts.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect } from '@playwright/test';
import { Given, When, Then, type Scenario } from '../fixtures.ts';

const OWN_KEY = 'ocr-protection';
const RULE_FILES = ['AGENTS.md', '.claude/agents/feature-worker.md'];
const READING_MODULES = 'scripts/agent/reading-modules.json';
const MUTATION_CONFIG = 'apps/agent/src-tauri/.cargo/mutants.toml';
const CONFIG_CHECK = 'scripts/agent/mutation-config.mjs';
const EXCLUDED_WITHOUT_EVIDENCE = 'a mutant with no evidence behind it';

interface World {
  rules: Map<string, string>;
  copy: string | undefined;
  status: number | null | undefined;
  output: string;
}

function world(scenario: Scenario): World {
  const stored = scenario.values.get(OWN_KEY);
  if (stored !== undefined) return stored as World;
  const created: World = { rules: new Map(), copy: undefined, status: undefined, output: '' };
  scenario.values.set(OWN_KEY, created);
  return created;
}

When("the contributor reads AGENTS.md and the feature worker's instructions", ({ scenario }) => {
  for (const file of RULE_FILES) {
    world(scenario).rules.set(
      file,
      readFileSync(path.join(scenario.repoRoot, file), 'utf8').replace(/\s+/g, ' '),
    );
  }
});

Then(
  'both say that a survivor in a reading module is killed only by a test that pins the current behaviour',
  ({ scenario }) => {
    const { rules } = world(scenario);
    expect([...rules.keys()]).toEqual(RULE_FILES);
    for (const [file, text] of rules) {
      expect(text, file).toContain('survivor');
      expect(text, file).toMatch(/killed only by a test that pins? the current behaviour/);
    }
  },
);

Then('both name the list of reading modules', ({ scenario }) => {
  for (const [file, text] of world(scenario).rules) expect(text, file).toContain(READING_MODULES);
});

Given('a copy of the mutation config with an exclusion that has no evidence comment', ({ scenario }) => {
  const config = readFileSync(path.join(scenario.repoRoot, MUTATION_CONFIG), 'utf8');
  const copy = path.join(mkdtempSync(path.join(tmpdir(), 'ocr-protection-')), 'mutants.toml');
  // The config ends with its `exclude_re` list: add the bare entry as that list's last line.
  const end = config.lastIndexOf('\n]');
  if (end === -1) throw new Error('the mutation config has no exclude_re list');
  writeFileSync(copy, `${config.slice(0, end)}\n  "${EXCLUDED_WITHOUT_EVIDENCE}",${config.slice(end)}`);
  world(scenario).copy = copy;
});

When('the contributor runs the mutation config check on that copy', ({ scenario }) => {
  const { copy } = world(scenario);
  if (copy === undefined) throw new Error('no copy of the mutation config was made');
  const result = spawnSync(process.execPath, [path.join(scenario.repoRoot, CONFIG_CHECK), copy], {
    cwd: scenario.repoRoot,
    encoding: 'utf8',
  });
  const current = world(scenario);
  current.status = result.status;
  current.output = `${result.stdout}${result.stderr}`;
});

Then('the check fails and names the exclusion', ({ scenario }) => {
  const { status, output } = world(scenario);
  expect(status, output).not.toBe(0);
  expect(output).toContain(EXCLUDED_WITHOUT_EVIDENCE);
});
