#!/usr/bin/env node
// What the `publish` job does with a release draft (AGR-06): publish it as Latest, publish it without Latest, or leave it
// alone. A re-run of a tag that is already public changes nothing, and a re-run of an older tag never moves Latest back.
//
//   node scripts/agent/publish-release.mjs --tag agent-vX.Y.Z --draft true|false --tags "<agent-v* tags, one per line>"
//
// Prints `latest`, `not-latest` or `skip`. Pure rules (`decidePublication`) and a thin CLI.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TAG = /^agent-v([0-9]+)\.([0-9]+)\.([0-9]+)$/;
const parts = (tag) => TAG.exec(tag)?.slice(1).map(Number);

/** Negative when `a` is the older version. Tags that are not agent tags are never compared. */
export function compareTags(a, b) {
  const left = parts(a);
  const right = parts(b);
  if (left === undefined || right === undefined) throw new Error(`not an agent release tag: ${a} or ${b}`);
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return 0;
}

/** @returns {'latest' | 'not-latest' | 'skip'} */
export function decidePublication({ tag, isDraft, tags }) {
  if (parts(tag) === undefined) throw new Error(`not an agent release tag: ${tag}`);
  if (!isDraft) return 'skip';
  const newest = [...tags.filter((candidate) => parts(candidate) !== undefined), tag].reduce((a, b) =>
    compareTags(a, b) >= 0 ? a : b,
  );
  return newest === tag ? 'latest' : 'not-latest';
}

function option(argv, flag) {
  const index = argv.indexOf(flag);
  if (index < 0 || argv[index + 1] === undefined) throw new Error(`missing ${flag}`);
  return argv[index + 1];
}

function main(argv) {
  const isDraft = option(argv, '--draft');
  if (isDraft !== 'true' && isDraft !== 'false') throw new Error('--draft is true or false');
  const tags = option(argv, '--tags')
    .split('\n')
    .map((line) => line.trim().replace(/^.*refs\/tags\//, ''))
    .filter((line) => line !== '');
  process.stdout.write(
    `${decidePublication({ tag: option(argv, '--tag'), isDraft: isDraft === 'true', tags })}\n`,
  );
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
