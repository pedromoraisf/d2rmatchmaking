#!/usr/bin/env node
// commit-msg hook (Lefthook): on feature branches, require the progress trailers (ADR 024).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { checkTrailers } from './lib/trailers.mjs';
import { taskIds } from './lib/steps.mjs';

const msgFile = process.argv[2];
const message = msgFile && existsSync(msgFile) ? readFileSync(msgFile, 'utf8') : '';
let branch = '';
try {
  branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim();
} catch {
  process.exit(0);
}
const feature = /^feat\/F\d+-(.+)$/.exec(branch)?.[1];
const tasksFile = feature ? `.specs/features/${feature}/tasks.md` : null;
const ids = tasksFile && existsSync(tasksFile) ? taskIds(readFileSync(tasksFile, 'utf8')) : [];
const errors = checkTrailers(branch, message, ids);
if (errors.length) {
  console.error(`commit-trailers: this commit on ${branch} must record progress (ADR 024):`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
