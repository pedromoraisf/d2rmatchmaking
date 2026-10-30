#!/usr/bin/env node
// Checks every feature's acceptance.feature against its spec (ADR 023). Exit 1 on any error.
// Usage: node scripts/acceptance-check.mjs [feature]
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { checkAcceptance } from './lib/acceptance.mjs';

const root = process.cwd();
const base = path.join(root, '.specs', 'features');
const only = process.argv[2];
const features = existsSync(base)
  ? readdirSync(base).filter((n) => statSync(path.join(base, n)).isDirectory() && (!only || n === only))
  : [];
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null);
const errors = [];
for (const f of features) {
  const spec = read(path.join(base, f, 'spec.md'));
  if (spec === null) continue;
  errors.push(...checkAcceptance(f, spec, read(path.join(base, f, 'acceptance.feature'))));
}
if (errors.length) {
  console.error(`acceptance-check: ${errors.length} problem(s)`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log(`acceptance-check: OK (${features.length} feature(s))`);
