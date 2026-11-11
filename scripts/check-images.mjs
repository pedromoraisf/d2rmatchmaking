#!/usr/bin/env node
// No game screenshot is ever committed (AGENTS.md "Never do"; lesson of 2026-11-11). The repository is public and game
// screenshots carry Blizzard's UI art and other players' names. Images may live only where the project draws or owns
// them, and agent fixtures must be the small images `xtask` draws, never a capture.
//
//   node scripts/check-images.mjs [file …]   checks the given files, or every committed image when none is given
import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const IMAGE = /\.(png|jpe?g|webp|gif|bmp|tiff?|avif|heic)$/i;
/** Where images may be committed: the agent's icons, its drawn fixtures, and the site's own public assets. */
export const ALLOWED_DIRS = ['apps/agent/src-tauri/icons/', 'apps/agent/fixtures/', 'apps/web/public/'];
/** A drawn agent fixture is a few kilobytes; a 1920-wide game capture is megabytes. */
export const MAX_FIXTURE_BYTES = 64 * 1024;
/** Names that say "a capture of the game", whatever the size. */
export const CAPTURE_NAME = /(maintainer|screenshot|screen[-_ ]?shot|print|capture|captura)/i;

/**
 * The problems of a list of image paths. `sizeOf(path)` returns the size in bytes.
 * @param {string[]} files
 * @param {(file: string) => number} sizeOf
 * @returns {string[]}
 */
export function checkImages(files, sizeOf) {
  const problems = [];
  for (const file of files.filter((f) => IMAGE.test(f))) {
    const normalized = file.replaceAll('\\', '/');
    if (!ALLOWED_DIRS.some((dir) => normalized.startsWith(dir))) {
      problems.push(`${normalized}: images may be committed only under ${ALLOWED_DIRS.join(', ')}`);
      continue;
    }
    if (CAPTURE_NAME.test(normalized.split('/').pop() ?? '')) {
      problems.push(
        `${normalized}: the name says it is a game capture; game screenshots never enter the repository`,
      );
    }
    if (normalized.startsWith('apps/agent/fixtures/') && sizeOf(file) > MAX_FIXTURE_BYTES) {
      problems.push(
        `${normalized}: ${sizeOf(file)} bytes is a capture, not a drawn fixture (max ${MAX_FIXTURE_BYTES}); draw it with xtask or keep the screenshot outside the repository`,
      );
    }
  }
  return problems;
}

function committedImages() {
  return execFileSync('git', ['ls-files'], { encoding: 'utf8' })
    .split('\n')
    .filter((f) => IMAGE.test(f));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2);
  // A staged deletion has no file left to measure: it removes an image, so it is never a problem.
  const files = (args.length > 0 ? args : committedImages()).filter((f) => existsSync(f));
  const problems = checkImages(files, (f) => statSync(f).size);
  if (problems.length > 0) {
    console.error(
      `check-images: ${problems.length} problem(s)\n${problems.map((p) => `  ✗ ${p}`).join('\n')}`,
    );
    process.exit(1);
  }
  console.log('check-images: OK');
}
