// The maintainer's Windows OCR check of the Party panel (apps/agent/README.md). It reads the three Party screenshots in a
// folder the maintainer names, prints one PASS or FAIL per file with what the engine read, and exits non-zero when a file
// fails. The screenshots are never committed (.gitignore: apps/agent/fixtures/**/maintainer-*). Windows only: the engine is
// the Windows OCR engine. Usage: node scripts/agent/ocr-check.mjs <folder>
import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCREENSHOTS = [
  'maintainer-party-revealed.png',
  'maintainer-party-revealed-tooltip.png',
  'maintainer-party-masked.png',
];

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const manifest = path.join(root, 'apps/agent/src-tauri/Cargo.toml');

// Pure: the folder's problems, or none. A missing screenshot is named, so the maintainer knows which file to copy.
export function folderProblems(folder, exists = existsSync, isDirectory = (p) => statSync(p).isDirectory()) {
  if (!folder) return ['give the folder of the three screenshots as the argument'];
  if (!exists(folder) || !isDirectory(folder)) return [`${folder} is not a folder`];
  return SCREENSHOTS.filter((name) => !exists(path.join(folder, name))).map(
    (name) => `${name} is missing from ${folder}`,
  );
}

// Pure: the arguments of the nextest run that executes the ignored check test with the folder in its environment.
export function nextestArgs() {
  return [
    'nextest',
    'run',
    '--manifest-path',
    manifest,
    '-p',
    'd2rmm-agent',
    '--run-ignored',
    'only',
    '-E',
    'test(ocr_check)',
    '--no-capture',
  ];
}

function main() {
  if (process.platform !== 'win32') {
    console.error('The Party OCR check runs on Windows only: the engine is the Windows OCR engine.');
    process.exit(1);
  }
  const folder = process.argv[2] ? path.resolve(process.argv[2]) : undefined;
  const problems = folderProblems(folder);
  if (problems.length > 0) {
    for (const problem of problems) console.error(problem);
    process.exit(2);
  }
  const run = spawnSync('cargo', nextestArgs(), {
    stdio: 'inherit',
    env: { ...process.env, D2RMM_OCR_CHECK_DIR: folder },
  });
  process.exit(run.status ?? 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
