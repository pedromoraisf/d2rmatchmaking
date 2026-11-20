#!/usr/bin/env node
// Checks the assets of an agent release draft as a set, before it is made public (AGR-03). The updater, the download link
// and the checksums are each written by a different step; a stale `latest.json` signature fails every installed agent's
// update after the release is already Latest, so the set is checked once, here:
//   - only the assets a release holds are there (an allowlist, `latest.json` lists only windows-x86_64);
//   - the fixed-name installer is the versioned one and SHA256SUMS agrees with the files;
//   - `latest.json` has the tag's version, points at exactly this repository's download URL of the installer, and carries
//     the signature of that installer's `.sig`;
//   - every `.sig` verifies against its file with the updater public key, as the agent's updater will (prehashed minisign).
//
//   node scripts/agent/release-assets.mjs --dir <assets> --tag agent-vX.Y.Z --repo owner/name --tauri-conf <tauri.conf.json>
//
// Pure rules over file contents (`checkRelease`) and a thin CLI. Exit 1, one line per problem, when any check fails.
import { createHash, createPublicKey, verify } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PRODUCT = 'D2RMatchMaking';
export const FIXED_INSTALLER = `${PRODUCT}-setup.exe`;
export const CHECKSUMS = 'SHA256SUMS';
export const LATEST_JSON = 'latest.json';
export const WINDOWS_PLATFORM = 'windows-x86_64';
const TAG = /^agent-v([0-9]+\.[0-9]+\.[0-9]+)$/;
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const text = (bytes) => Buffer.from(bytes).toString('utf8');

/** The names a release of `version` may hold: the two installers, the msi, their `.sig` files, the checksums and latest.json. */
export function allowedAssets(version) {
  const installer = `${PRODUCT}_${version}_x64-setup.exe`;
  const msi = `${PRODUCT}_${version}_x64_en-US.msi`;
  return new Set([FIXED_INSTALLER, installer, `${installer}.sig`, msi, `${msi}.sig`, CHECKSUMS, LATEST_JSON]);
}

/** The key id and the 32 key bytes of a Tauri updater public key (the base64 of a minisign public key file). */
export function parseMinisignPublicKey(base64) {
  const blob = Buffer.from(text(Buffer.from(String(base64), 'base64')).split('\n')[1] ?? '', 'base64');
  if (blob.length !== 42 || blob.subarray(0, 2).toString() !== 'Ed') {
    throw new Error('not a minisign public key');
  }
  return { keyId: blob.subarray(2, 10), publicKey: blob.subarray(10) };
}

function ed25519Key(raw) {
  return createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, raw]), format: 'der', type: 'spki' });
}

/** @returns {string | undefined} why `signature` (the content of a `.sig` file) is not a valid signature of `bytes`. */
export function updaterSignatureProblem(bytes, signature, pubkey) {
  let parsed;
  try {
    const lines = text(Buffer.from(text(signature).trim(), 'base64')).split('\n');
    const blob = Buffer.from(lines[1] ?? '', 'base64');
    const trusted = /^trusted comment: (.*)$/.exec(lines[2] ?? '');
    const global = Buffer.from(lines[3] ?? '', 'base64');
    if (blob.length !== 74 || trusted === null || global.length !== 64) throw new Error('shape');
    parsed = {
      algorithm: blob.subarray(0, 2).toString(),
      keyId: blob.subarray(2, 10),
      signature: blob.subarray(10),
      trusted: trusted[1],
      global,
    };
  } catch {
    return 'it is not a minisign signature';
  }
  if (parsed.algorithm !== 'ED')
    return 'it is not a prehashed minisign signature (ED), which the updater requires';
  const key = parseMinisignPublicKey(pubkey);
  if (!parsed.keyId.equals(key.keyId)) return 'it was made with another key id than the updater key';
  const publicKey = ed25519Key(key.publicKey);
  const prehashed = createHash('blake2b512').update(bytes).digest();
  if (!verify(null, prehashed, publicKey, parsed.signature)) {
    return 'the signature does not match the file, or is not by the updater key';
  }
  const comment = Buffer.concat([parsed.signature, Buffer.from(parsed.trusted)]);
  if (!verify(null, comment, publicKey, parsed.global))
    return 'its trusted comment is not signed by the updater key';
  return undefined;
}

/**
 * @param {{ tag: string, repo: string, pubkey?: string, files: Record<string, Uint8Array | string> }} input `files` maps an
 *   asset name to its bytes; `repo` is `owner/name`; `pubkey` is the updater public key as `tauri.conf.json` holds it.
 * @returns {string[]} the problems found, empty when the set can be published.
 */
export function checkRelease({ tag, repo, pubkey, files }) {
  const match = TAG.exec(tag);
  if (match === null) return [`not an agent release tag: ${tag}`];
  const version = match[1];
  const names = Object.keys(files);
  const bytes = (name) => Buffer.from(files[name]);
  const problems = [];

  const allowed = allowedAssets(version);
  for (const name of names) {
    if (!allowed.has(name)) problems.push(`${name} is not an asset of a release`);
  }

  const installer = `${PRODUCT}_${version}_x64-setup.exe`;
  if (!(installer in files)) problems.push(`no installer for version ${version} among the assets`);
  for (const required of [FIXED_INSTALLER, CHECKSUMS, LATEST_JSON, `${installer}.sig`]) {
    if (!(required in files) && (installer in files || required !== `${installer}.sig`)) {
      problems.push(`${required} is missing`);
    }
  }

  if (installer in files && FIXED_INSTALLER in files && !bytes(installer).equals(bytes(FIXED_INSTALLER))) {
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
      if (name in files && !listed.has(name)) problems.push(`${CHECKSUMS} does not list ${name}`);
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
      const platforms = latest?.platforms ?? {};
      const others = Object.keys(platforms).filter((name) => name !== WINDOWS_PLATFORM);
      if (others.length > 0) {
        problems.push(`${LATEST_JSON} lists a platform other than ${WINDOWS_PLATFORM}: ${others.join(', ')}`);
      }
      const platform = platforms[WINDOWS_PLATFORM];
      if (typeof platform !== 'object' || platform === null) {
        problems.push(`${LATEST_JSON} has no ${WINDOWS_PLATFORM} entry`);
      } else {
        const expected = `https://github.com/${repo}/releases/download/${tag}/${installer}`;
        if (String(platform.url) !== expected) {
          problems.push(`${LATEST_JSON} points at ${String(platform.url)}, not exactly at ${expected}`);
        }
        if (`${installer}.sig` in files) {
          if (text(files[`${installer}.sig`]).trim() !== String(platform.signature ?? '').trim()) {
            problems.push(`${LATEST_JSON} carries a signature that is not the one of ${installer}.sig`);
          }
        }
      }
    }
  }

  const signatures = names.filter(
    (name) => name.endsWith('.sig') && allowed.has(name) && name.slice(0, -4) in files,
  );
  if (signatures.length > 0 && (pubkey === undefined || pubkey === '')) {
    problems.push('no updater public key to verify the signatures with');
  } else {
    for (const name of signatures) {
      const file = name.slice(0, -4);
      const why = updaterSignatureProblem(bytes(file), files[name], pubkey);
      if (why !== undefined) problems.push(`${name} does not verify against ${file}: ${why}`);
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
  const repo = option(argv, '--repo');
  const conf = JSON.parse(readFileSync(option(argv, '--tauri-conf'), 'utf8'));
  const files = Object.fromEntries(
    readdirSync(dir).map((name) => [name, readFileSync(path.join(dir, name))]),
  );
  const problems = checkRelease({ tag, repo, pubkey: conf?.plugins?.updater?.pubkey, files });
  for (const problem of problems) process.stderr.write(`::error::${problem}\n`);
  if (problems.length > 0) process.exit(1);
  process.stdout.write(`the assets of ${tag} agree: ${Object.keys(files).length} files\n`);
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
