#!/usr/bin/env node
// Replaces the Windows updater signature in latest.json after SignPath re-signed the installer (AGS-29, AD-053). Only
// `platforms["windows-x86_64"].signature` changes; the version and every other field stay as they were.
//
//   node scripts/agent/latest-json.mjs --latest <latest.json> --signature <installer.sig> --out <latest.json>
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const WINDOWS_PLATFORM = 'windows-x86_64';

export function replaceWindowsSignature(latest, signature) {
  const text = typeof signature === 'string' ? signature.trim() : '';
  if (text === '') {
    throw new Error('the signature is empty');
  }
  const platform = latest?.platforms?.[WINDOWS_PLATFORM];
  if (typeof platform !== 'object' || platform === null) {
    throw new Error(`latest.json has no ${WINDOWS_PLATFORM} entry`);
  }
  return {
    ...latest,
    platforms: { ...latest.platforms, [WINDOWS_PLATFORM]: { ...platform, signature: text } },
  };
}

function option(argv, flag) {
  const index = argv.indexOf(flag);
  if (index < 0 || argv[index + 1] === undefined) {
    throw new Error(`missing ${flag}`);
  }
  return argv[index + 1];
}

function main(argv) {
  const latest = JSON.parse(readFileSync(option(argv, '--latest'), 'utf8'));
  const signature = readFileSync(option(argv, '--signature'), 'utf8');
  const next = replaceWindowsSignature(latest, signature);
  writeFileSync(option(argv, '--out'), `${JSON.stringify(next, null, 2)}\n`);
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
