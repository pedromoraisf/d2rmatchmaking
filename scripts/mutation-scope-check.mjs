#!/usr/bin/env node
// Mutation scope check (ADR 026): every mutation of every feature is proved by unit tests only.
//
//   node scripts/mutation-scope-check.mjs                  all .specs/features/*/mutations.json
//   node scripts/mutation-scope-check.mjs --feature <f>    one feature
//   node scripts/mutation-scope-check.mjs --file <path>    one mutate.py spec (the gate uses this)
//
// Exit 1 on any mutation whose proof is not a unit test.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { checkMutationSpec } from './lib/mutation-scope.mjs';

const root = process.cwd();
const argv = process.argv.slice(2);
const opt = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

function specFiles() {
  const file = opt('--file');
  if (file) return [path.resolve(root, file)];
  const features = path.join(root, '.specs', 'features');
  const only = opt('--feature');
  const names = only ? [only] : existsSync(features) ? readdirSync(features) : [];
  return names.map((n) => path.join(features, n, 'mutations.json')).filter((p) => existsSync(p));
}

const problems = [];
for (const file of specFiles()) {
  const rel = path.relative(root, file);
  let spec;
  try {
    spec = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    problems.push(`${rel}: not valid JSON (${e.message})`);
    continue;
  }
  for (const err of checkMutationSpec(spec)) problems.push(`${rel}: ${err}`);
}

if (problems.length) {
  console.error(
    `mutation-scope: ${problems.length} problem(s) — mutations run against unit tests only (ADR 026)`,
  );
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}
console.log('mutation-scope: OK');
