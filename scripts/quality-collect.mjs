#!/usr/bin/env node
// Collects every sensor report into reports/quality.json (input for quality-ratchet.mjs).
// Usage: node scripts/quality-collect.mjs [--out reports/quality.json]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { collect } from './lib/collect.mjs';

const root = process.cwd();
const outArg = process.argv.indexOf('--out');
const out = outArg > 0 ? process.argv[outArg + 1] : 'reports/quality.json';
const baseline = JSON.parse(readFileSync(path.join(root, '.quality-baseline.json'), 'utf8'));
const metrics = collect(baseline, root);
mkdirSync(path.dirname(path.join(root, out)), { recursive: true });
writeFileSync(path.join(root, out), `${JSON.stringify(metrics, null, 2)}\n`);
console.log(`quality-collect: ${Object.keys(metrics).length} metric(s) → ${out}`);
for (const [k, v] of Object.entries(metrics)) console.log(`  ${k} = ${v}`);
