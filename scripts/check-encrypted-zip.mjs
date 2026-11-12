#!/usr/bin/env node
// The one exception to "no game screenshot is ever committed" (maintainer decision, 2026-11-11): a single AES-256
// encrypted zip of real screenshots at apps/agent/ocr-lab/real-prints.zip, opened in CI with the repository secret
// OCR_PRINTS_PASSWORD. This sensor makes the exception safe: every entry of every zip in that folder must be encrypted
// (ZIP general-purpose flag bit 0) with AES-256 (method 99 and the AE-x extra field, strength 3), and nothing else but a
// README may live there. scripts/check-images.mjs is unchanged: the zip is not an image.
//
//   node scripts/check-encrypted-zip.mjs [file …]   checks the given files, or every committed file under the folder
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const LAB_DIR = 'apps/agent/ocr-lab/';
const README = /^README(\.md)?$/i;
const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const AES_EXTRA = 0x9901;

/**
 * The reasons a zip is not wholly AES-256 encrypted (empty when it is).
 * @param {Buffer} zip
 * @returns {string[]}
 */
export function zipProblems(zip) {
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
    if (zip.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return ['not a zip file (no end-of-central-directory record)'];
  const count = zip.readUInt16LE(eocd + 10);
  let offset = zip.readUInt32LE(eocd + 16);
  const problems = [];
  let files = 0;
  for (let n = 0; n < count; n++) {
    if (offset + 46 > zip.length || zip.readUInt32LE(offset) !== CENTRAL) {
      problems.push('corrupt central directory');
      break;
    }
    const flags = zip.readUInt16LE(offset + 8);
    const method = zip.readUInt16LE(offset + 10);
    const nameLen = zip.readUInt16LE(offset + 28);
    const extraLen = zip.readUInt16LE(offset + 30);
    const commentLen = zip.readUInt16LE(offset + 32);
    const localOffset = zip.readUInt32LE(offset + 42);
    const name = zip.toString('utf8', offset + 46, offset + 46 + nameLen);
    const extra = zip.subarray(offset + 46 + nameLen, offset + 46 + nameLen + extraLen);
    offset += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue; // a directory entry holds no data
    files++;
    const localFlags =
      localOffset + 8 <= zip.length && zip.readUInt32LE(localOffset) === LOCAL
        ? zip.readUInt16LE(localOffset + 6)
        : 0;
    if ((flags & 1) === 0 || (localFlags & 1) === 0) {
      problems.push(`entry "${name}" is not encrypted`);
      continue;
    }
    if (method !== 99) {
      problems.push(`entry "${name}" uses legacy ZipCrypto (method ${method}); AES-256 is required`);
      continue;
    }
    let strength = -1;
    for (let p = 0; p + 4 <= extra.length;) {
      const id = extra.readUInt16LE(p);
      const size = extra.readUInt16LE(p + 2);
      if (id === AES_EXTRA && size >= 7 && p + 4 + 5 <= extra.length) strength = extra[p + 4 + 4];
      p += 4 + size;
    }
    if (strength !== 3) problems.push(`entry "${name}" is not AES-256 (AE-x strength ${strength})`);
  }
  if (files === 0 && problems.length === 0) problems.push('the zip has no file entries');
  return problems;
}

/**
 * The problems of a list of paths. Only paths under apps/agent/ocr-lab/ matter.
 * @param {string[]} files
 * @param {(file: string) => Buffer} read
 * @returns {string[]}
 */
export function checkEncryptedZips(files, read) {
  const problems = [];
  for (const file of files) {
    const normalized = file.replaceAll('\\', '/');
    if (!normalized.startsWith(LAB_DIR)) continue;
    const name = normalized.slice(LAB_DIR.length);
    if (/\.zip$/i.test(name) && !name.includes('/')) {
      for (const p of zipProblems(read(file))) problems.push(`${normalized}: ${p}`);
    } else if (!README.test(name)) {
      problems.push(`${normalized}: only encrypted .zip files and a README may live in ${LAB_DIR}`);
    }
  }
  return problems;
}

function committedFiles() {
  return execFileSync('git', ['ls-files', LAB_DIR], { encoding: 'utf8' }).split('\n').filter(Boolean);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2);
  // A staged deletion has no file left to read.
  const files = (args.length > 0 ? args : committedFiles()).filter((f) => existsSync(f));
  const problems = checkEncryptedZips(files, (f) => readFileSync(f));
  if (problems.length > 0) {
    console.error(
      `check-encrypted-zip: ${problems.length} problem(s)\n${problems.map((p) => `  ✗ ${p}`).join('\n')}`,
    );
    process.exit(1);
  }
  console.log('check-encrypted-zip: OK');
}
