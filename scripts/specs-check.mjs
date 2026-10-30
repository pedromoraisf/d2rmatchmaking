#!/usr/bin/env node
// Validates the phase-delegation layer on top of TLC's .specs/ (ADR 021). Exit 1 on any error.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { checkSpecs } from './lib/specs.mjs';
import { checkRoadmap } from './lib/roadmap.mjs';

const root = process.cwd();
const read = (rel) => (existsSync(path.join(root, rel)) ? readFileSync(path.join(root, rel), 'utf8') : null);
const list = (rel) => {
  const abs = path.join(root, rel);
  return existsSync(abs) ? readdirSync(abs).filter((n) => statSync(path.join(abs, n)).isDirectory()) : [];
};
const errors = checkSpecs(read, list);
const briefs = Object.fromEntries(list('.specs/phases').filter((p) => /^F\d+$/.test(p)).map((p) => [p, read(`.specs/phases/${p}/brief.md`)]));
errors.push(...checkRoadmap(read('docs/product/prd.md'), read('.specs/phases/ROADMAP.md'), briefs));
if (errors.length) {
  console.error(`specs-check: ${errors.length} problem(s)`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log('specs-check: OK');
