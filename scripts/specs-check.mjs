#!/usr/bin/env node
// Validates the phase-delegation layer on top of TLC's .specs/ (ADR 021). Exit 1 on any error.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { checkSpecs } from './lib/specs.mjs';

const root = process.cwd();
const read = (rel) => (existsSync(path.join(root, rel)) ? readFileSync(path.join(root, rel), 'utf8') : null);
const list = (rel) => {
  const abs = path.join(root, rel);
  return existsSync(abs) ? readdirSync(abs).filter((n) => statSync(path.join(abs, n)).isDirectory()) : [];
};
const errors = checkSpecs(read, list);
if (errors.length) {
  console.error(`specs-check: ${errors.length} problem(s)`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log('specs-check: OK');
