// Proves the sensor for the encrypted-zip exception (scripts/check-encrypted-zip.mjs). Zips are built here, tiny and
// empty of any image: only the headers matter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { checkEncryptedZips, zipProblems } from '../check-encrypted-zip.mjs';

/** A zip with one entry per `{ name, encrypted, method, strength }`; data is a few placeholder bytes. */
function buildZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, encrypted = true, method = 99, strength = 3 } of entries) {
    const nameBuf = Buffer.from(name);
    const aes = Buffer.alloc(11);
    aes.writeUInt16LE(0x9901, 0);
    aes.writeUInt16LE(7, 2);
    aes.writeUInt16LE(2, 4);
    aes.write('AE', 6, 'latin1');
    aes[8] = strength;
    aes.writeUInt16LE(8, 9);
    const extra = method === 99 ? aes : Buffer.alloc(0);
    const flags = encrypted ? 1 : 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(51, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(4, 18);
    local.writeUInt32LE(4, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(extra.length, 28);
    const body = Buffer.concat([local, nameBuf, extra, Buffer.from('data')]);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(51, 4);
    central.writeUInt16LE(51, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(4, 20);
    central.writeUInt32LE(4, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(extra.length, 30);
    central.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([central, nameBuf, extra]));
    locals.push(body);
    offset += body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

test('a zip whose every entry is AES-256 encrypted passes', () => {
  assert.deepEqual(zipProblems(buildZip([{ name: 'a.png' }, { name: 'b.png' }])), []);
});

test('an entry without the encrypted flag is refused', () => {
  const problems = zipProblems(buildZip([{ name: 'a.png' }, { name: 'b.png', encrypted: false, method: 0 }]));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /"b.png" is not encrypted/);
});

test('legacy ZipCrypto and AES-128 are refused', () => {
  assert.match(zipProblems(buildZip([{ name: 'a.png', method: 8 }]))[0], /ZipCrypto/);
  assert.match(zipProblems(buildZip([{ name: 'a.png', strength: 1 }]))[0], /not AES-256/);
});

test('a file that is not a zip, and an empty zip, are refused', () => {
  assert.match(zipProblems(Buffer.from('not a zip at all, just text....'))[0], /not a zip/);
  assert.match(zipProblems(buildZip([]))[0], /no file entries/);
});

test('only encrypted zips and a README may live in the lab folder', () => {
  const read = () => buildZip([{ name: 'a.png' }]);
  assert.deepEqual(
    checkEncryptedZips(['apps/agent/ocr-lab/real-prints.zip', 'apps/agent/ocr-lab/README.md'], read),
    [],
  );
  const other = checkEncryptedZips(['apps/agent/ocr-lab/notes.txt', 'apps/agent/ocr-lab/x/y.zip'], read);
  assert.equal(other.length, 2);
  assert.match(other[0], /only encrypted .zip files and a README/);
});

test('an unencrypted zip in the lab folder is refused, and zips elsewhere are not this sensor', () => {
  const plain = () => buildZip([{ name: 'a.png', encrypted: false, method: 0 }]);
  assert.equal(checkEncryptedZips(['apps/agent/ocr-lab/real-prints.zip'], plain).length, 1);
  assert.deepEqual(checkEncryptedZips(['docs/x.zip'], plain), []);
});

test('every file committed in the lab folder passes', () => {
  const files = execFileSync('git', ['ls-files', 'apps/agent/ocr-lab/'], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
  assert.deepEqual(
    checkEncryptedZips(files, (f) => readFileSync(f)),
    [],
  );
});
