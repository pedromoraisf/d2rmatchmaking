#!/usr/bin/env node
// Quality ratchet gate (ADR 021). Fails when any metric regresses against .quality-baseline.json.
// Usage:
//   node scripts/quality-ratchet.mjs [--context pr|nightly|phase] [--current reports/quality.json]
//   node scripts/quality-ratchet.mjs --update   # after a green run: write improvements (never loosens)
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { collect } from './lib/collect.mjs';
import { evaluate, tighten, compareBaselines } from './lib/ratchet.mjs';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const context = opt('--context', process.env.QUALITY_CONTEXT ?? 'pr');
const currentPath = opt('--current', null);
const update = args.includes('--update');

const baseline = JSON.parse(readFileSync('.quality-baseline.json', 'utf8'));
const current =
  currentPath && existsSync(currentPath) ? JSON.parse(readFileSync(currentPath, 'utf8')) : collect(baseline, process.cwd());

const { failures, notes, improvements } = evaluate(baseline, current, context);
for (const n of notes) console.log(`  · ${n}`);
if (failures.length > 0) {
  console.error(`quality-ratchet [${context}]: ${failures.length} regression(s)`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  console.error('Fix the regression. Lowering the baseline is a maintainer decision (ADR 021).');
  process.exit(1);
}
console.log(`quality-ratchet [${context}]: OK${Object.keys(improvements).length ? ` — ${Object.keys(improvements).length} improvement(s)` : ''}`);
if (update && Object.keys(improvements).length > 0) {
  const next = tighten(baseline, improvements, new Date().toISOString().slice(0, 10));
  if (compareBaselines(baseline, next).length > 0) throw new Error('tighten() produced a looser baseline — bug');
  writeFileSync('.quality-baseline.json', `${JSON.stringify(next, null, 2)}\n`);
  for (const [k, v] of Object.entries(improvements)) console.log(`  ↑ ${k} = ${v}`);
}
