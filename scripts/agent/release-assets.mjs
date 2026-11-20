#!/usr/bin/env node
// Checks the assets of an agent release draft as a set, before it is made public (AGR-03). The updater, the download link
// and the checksums are each written by a different step; a stale `latest.json` signature fails every installed agent's
// update after the release is already Latest, so the set is checked once, here.
//
//   node scripts/agent/release-assets.mjs --dir <downloaded assets> --tag agent-vX.Y.Z
//
// Pure rules over file contents (`checkRelease`) and a thin CLI. Exit 1, one line per problem, when any check fails.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FIXED_INSTALLER = 'D2RMatchMaking-setup.exe';
export const CHECKSUMS = 'SHA256SUMS';
export const LATEST_JSON = 'latest.json';
export const WINDOWS_PLATFORM = 'windows-x86_64';
const TAG = /^agent-v([0-9]+\.[0-9]+\.[0-9]+)$/;

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const text = (bytes) => Buffer.from(bytes).toString('utf8');

/**
 * @param {{ tag: string, files: Record<string, Uint8Array | string> }} input `files` maps an asset name to its bytes.
 * @returns {string[]} the problems found, empty when the set can be published.
 */
export function checkRelease({ tag, files }) {
  const match = TAG.exec(tag);
  if (match === null) return [`not an agent release tag: ${tag}`];
  const version = match[1];
  const names = Object.keys(files);
  const bytes = (name) => Buffer.from(files[name]);
  const problems = [];

  const versioned = names.filter(
    (name) => name !== FIXED_INSTALLER && name.endsWith('-setup.exe') && name.includes(`_${version}_`),
  );
  if (versioned.length !== 1) {
    problems.push(
      versioned.length === 0
        ? `no installer for version ${version} among the assets`
        : `more than one installer for version ${version}: ${versioned.join(', ')}`,
    );
  }
  const installer = versioned.length === 1 ? versioned[0] : undefined;

  for (const required of [FIXED_INSTALLER, CHECKSUMS, LATEST_JSON]) {
    if (!(required in files)) problems.push(`${required} is missing`);
  }
  if (installer !== undefined && !(`${installer}.sig` in files)) {
    problems.push(`${installer}.sig is missing`);
  }

  if (
    installer !== undefined &&
    FIXED_INSTALLER in files &&
    !bytes(installer).equals(bytes(FIXED_INSTALLER))
  ) {
    problems.push(`${FIXED_INSTALLER} is not the same file as ${installer}`);
  }

  if (CHECKSUMS in files) {
    const listed = new Set();
    for (const line of text(files[CHECKSUMS]).split('\n')) {
      if (line.trim() === '') continue;
      const parsed = /^([0-9a-f]{64}) {1}[ *](.+)$/.exec(line.trim());
      if (parsed === null) {
        problems.push(`${CHECKSUMS} has a line that is not "<sha256>  <name>": ${line.trim().slice(0, 80)}`);
        continue;
      }
      const [, hash, name] = parsed;
      listed.add(name);
      if (!(name in files)) problems.push(`${CHECKSUMS} lists ${name}, which is not an asset`);
      else if (sha256(bytes(name)) !== hash) problems.push(`${CHECKSUMS} has the wrong hash for ${name}`);
    }
    for (const name of [FIXED_INSTALLER, installer]) {
      if (name !== undefined && name in files && !listed.has(name)) {
        problems.push(`${CHECKSUMS} does not list ${name}`);
      }
    }
  }

  if (LATEST_JSON in files) {
    let latest;
    try {
      latest = JSON.parse(text(files[LATEST_JSON]));
    } catch {
      problems.push(`${LATEST_JSON} is not JSON`);
    }
    if (latest !== undefined) {
      if (latest?.version !== version) {
        problems.push(`${LATEST_JSON} says version ${String(latest?.version)}, the tag is ${version}`);
      }
      const platform = latest?.platforms?.[WINDOWS_PLATFORM];
      if (typeof platform !== 'object' || platform === null) {
        problems.push(`${LATEST_JSON} has no ${WINDOWS_PLATFORM} entry`);
      } else {
        if (
          installer !== undefined &&
          !String(platform.url).endsWith(`/releases/download/${tag}/${installer}`)
        ) {
          problems.push(`${LATEST_JSON} points at ${String(platform.url)}, not at ${installer} of ${tag}`);
        }
        if (installer !== undefined && `${installer}.sig` in files) {
          if (text(files[`${installer}.sig`]).trim() !== String(platform.signature ?? '').trim()) {
            problems.push(`${LATEST_JSON} carries a signature that is not the one of ${installer}.sig`);
          }
        }
      }
    }
  }
  return problems;
}

function option(argv, flag) {
  const index = argv.indexOf(flag);
  if (index < 0 || argv[index + 1] === undefined) throw new Error(`missing ${flag}`);
  return argv[index + 1];
}

function main(argv) {
  const dir = option(argv, '--dir');
  const tag = option(argv, '--tag');
  const files = Object.fromEntries(
    readdirSync(dir).map((name) => [name, readFileSync(path.join(dir, name))]),
  );
  const problems = checkRelease({ tag, files });
  for (const problem of problems) process.stderr.write(`::error::${problem}\n`);
  if (problems.length > 0) process.exit(1);
  process.stdout.write(`the assets of ${tag} agree: ${Object.keys(files).length} files\n`);
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
