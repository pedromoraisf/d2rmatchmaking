// Unit tests of the release asset checker (AGR-03): drawn asset sets, each broken in one way, signed with a drawn minisign
// key the way `tauri signer sign` signs (prehashed, "ED").
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkRelease, parseMinisignPublicKey, updaterSignatureProblem } from '../agent/release-assets.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const script = path.join(root, 'scripts', 'agent', 'release-assets.mjs');
const TAG = 'agent-v0.4.0';
const REPO = 'pedromoraisf/d2rmatchmaking';
const VERSIONED = 'D2RMatchMaking_0.4.0_x64-setup.exe';
const MSI = 'D2RMatchMaking_0.4.0_x64_en-US.msi';
const hash = (content) => createHash('sha256').update(content).digest('hex');
const urlOf = (name, tag = TAG, repo = REPO) => `https://github.com/${repo}/releases/download/${tag}/${name}`;

const keyId = Buffer.from('0123456789abcdef', 'hex');
function drawKey() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const raw = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url');
  const pubkeyText = `untrusted comment: minisign public key: 0123456789ABCDEF\n${Buffer.concat([Buffer.from('Ed'), keyId, raw]).toString('base64')}\n`;
  return { privateKey, pubkey: Buffer.from(pubkeyText).toString('base64') };
}
const KEY = drawKey();
const OTHER_KEY = drawKey();

/** A Tauri updater signature file's content (base64 of a minisign signature) for `bytes`. */
function updaterSignature(bytes, { privateKey } = KEY, { algorithm = 'ED', id = keyId } = {}) {
  const signed = algorithm === 'ED' ? createHash('blake2b512').update(bytes).digest() : bytes;
  const signature = sign(null, signed, privateKey);
  const trusted = 'timestamp:1 file:setup';
  const global = sign(null, Buffer.concat([signature, Buffer.from(trusted)]), privateKey);
  const text = `untrusted comment: signature from tauri secret key\n${Buffer.concat([Buffer.from(algorithm), id, signature]).toString('base64')}\ntrusted comment: ${trusted}\n${global.toString('base64')}\n`;
  return Buffer.from(text).toString('base64');
}

/** A complete, agreeing set. `change` edits it before it is returned. */
function drawn(change = () => {}) {
  const installer = Buffer.from('installer bytes');
  const msi = Buffer.from('msi bytes');
  const signature = updaterSignature(installer);
  const files = {
    [VERSIONED]: installer,
    [`${VERSIONED}.sig`]: Buffer.from(signature),
    [MSI]: msi,
    [`${MSI}.sig`]: Buffer.from(updaterSignature(msi)),
    'D2RMatchMaking-setup.exe': Buffer.from(installer),
    'latest.json': Buffer.from(
      JSON.stringify({
        version: '0.4.0',
        platforms: { 'windows-x86_64': { signature, url: urlOf(VERSIONED) } },
      }),
    ),
    SHA256SUMS: Buffer.from(
      `${hash(installer)}  ${VERSIONED}\n${hash(installer)}  D2RMatchMaking-setup.exe\n`,
    ),
  };
  change(files);
  return files;
}
const problemsOf = (change, options = {}) =>
  checkRelease({ tag: TAG, repo: REPO, pubkey: KEY.pubkey, files: drawn(change), ...options });
const without = (name) => (files) => Reflect.deleteProperty(files, name);
const latestOf = (files) => JSON.parse(files['latest.json'].toString());
const setLatest = (files, change) => {
  const latest = latestOf(files);
  change(latest);
  files['latest.json'] = Buffer.from(JSON.stringify(latest));
};

test('a complete set that agrees has no problem', () => {
  assert.deepEqual(
    problemsOf(() => {}),
    [],
  );
});

test('a tag that is not an agent tag is refused', () => {
  assert.deepEqual(
    problemsOf(() => {}, { tag: 'v0.4.0' }),
    ['not an agent release tag: v0.4.0'],
  );
});

test('a missing asset is named', () => {
  for (const name of ['SHA256SUMS', 'latest.json', 'D2RMatchMaking-setup.exe', `${VERSIONED}.sig`]) {
    const problems = problemsOf(without(name));
    assert.ok(
      problems.some((problem) => problem.includes(name)),
      `${name}: ${problems.join(' | ')}`,
    );
  }
  assert.match(problemsOf(without(VERSIONED))[0], /no installer for version 0\.4\.0/);
});

test('an installer of another version is not the installer of this tag', () => {
  const problems = problemsOf((files) => {
    files['D2RMatchMaking_0.3.0_x64-setup.exe'] = files[VERSIONED];
    Reflect.deleteProperty(files, VERSIONED);
  });
  assert.ok(problems.some((problem) => /no installer for version 0\.4\.0/.test(problem)));
});

test('the fixed-name installer must be the versioned one', () => {
  const problems = problemsOf((files) => {
    files['D2RMatchMaking-setup.exe'] = Buffer.from('an old installer');
  });
  assert.ok(problems.some((problem) => /is not the same file/.test(problem)));
});

test('SHA256SUMS must match the assets it names and name both installers', () => {
  const wrong = problemsOf((files) => {
    files.SHA256SUMS = Buffer.from(`${hash('other')}  ${VERSIONED}\n`);
  });
  assert.ok(wrong.some((problem) => /wrong hash for D2RMatchMaking_0\.4\.0_x64-setup\.exe/.test(problem)));
  assert.ok(wrong.some((problem) => /does not list D2RMatchMaking-setup\.exe/.test(problem)));

  const ghost = problemsOf((files) => {
    files.SHA256SUMS = Buffer.from(`${hash('x')}  ghost.exe\n`);
  });
  assert.ok(ghost.some((problem) => /lists ghost\.exe, which is not an asset/.test(problem)));

  const garbage = problemsOf((files) => {
    files.SHA256SUMS = Buffer.from('not a checksum line\n');
  });
  assert.ok(garbage.some((problem) => /not "<sha256> {2}<name>"/.test(problem)));
});

test('latest.json must carry the tag version', () => {
  const problems = problemsOf((files) => setLatest(files, (latest) => (latest.version = '0.3.0')));
  assert.deepEqual(problems, ['latest.json says version 0.3.0, the tag is 0.4.0']);
});

test('latest.json must point at the installer of this release, at exactly this repository and tag', () => {
  const urls = [
    urlOf(VERSIONED, 'agent-v0.3.0'),
    urlOf(VERSIONED, TAG, 'someone-else/d2rmatchmaking'),
    `https://evil.example/pedromoraisf/d2rmatchmaking/releases/download/${TAG}/${VERSIONED}`,
    `https://evil.example/?next=${urlOf(VERSIONED)}`,
    `${urlOf(VERSIONED)}?x=1`,
    `http://github.com/${REPO}/releases/download/${TAG}/${VERSIONED}`,
    urlOf('D2RMatchMaking-setup.exe'),
  ];
  for (const url of urls) {
    const problems = problemsOf((files) =>
      setLatest(files, (latest) => (latest.platforms['windows-x86_64'].url = url)),
    );
    assert.equal(problems.length, 1, url);
    assert.match(problems[0], /not exactly/, url);
  }
});

test('latest.json must carry the updater signature of the installer that ships', () => {
  const stale = updaterSignature(Buffer.from('the signed file'));
  const problems = problemsOf((files) => {
    files[`${VERSIONED}.sig`] = Buffer.from(stale);
  });
  assert.ok(problems.includes(`latest.json carries a signature that is not the one of ${VERSIONED}.sig`));
});

test('latest.json that is not JSON, or has no Windows entry, is refused', () => {
  assert.deepEqual(
    problemsOf((files) => (files['latest.json'] = Buffer.from('{'))),
    ['latest.json is not JSON'],
  );
  const noWindows = problemsOf(
    (files) => (files['latest.json'] = Buffer.from('{"version":"0.4.0","platforms":{}}')),
  );
  assert.deepEqual(noWindows, ['latest.json has no windows-x86_64 entry']);
});

test('latest.json may list no platform but windows-x86_64', () => {
  const problems = problemsOf((files) =>
    setLatest(files, (latest) => {
      latest.platforms['darwin-aarch64'] = { signature: 'x', url: 'https://example.test/app.tar.gz' };
    }),
  );
  assert.deepEqual(problems, ['latest.json lists a platform other than windows-x86_64: darwin-aarch64']);
});

test('an asset that is not on the list of what a release holds is refused', () => {
  for (const extra of [
    'notes.txt',
    'D2RMatchMaking_0.3.0_x64-setup.exe',
    'D2RMatchMaking_0.4.0_x64-setup.exe.sig.bak',
    'evil.exe',
  ]) {
    const problems = problemsOf((files) => (files[extra] = Buffer.from('x')));
    assert.ok(
      problems.includes(`${extra} is not an asset of a release`),
      `${extra}: ${problems.join(' | ')}`,
    );
  }
  // The msi is optional: a release without it is complete.
  assert.deepEqual(
    problemsOf((files) => {
      Reflect.deleteProperty(files, MSI);
      Reflect.deleteProperty(files, `${MSI}.sig`);
    }),
    [],
  );
});

test('every .sig must verify against its file with the updater public key', () => {
  const wrongKey = problemsOf((files) => {
    files[`${VERSIONED}.sig`] = Buffer.from(updaterSignature(files[VERSIONED], OTHER_KEY));
    setLatest(
      files,
      (latest) => (latest.platforms['windows-x86_64'].signature = files[`${VERSIONED}.sig`].toString()),
    );
  });
  assert.deepEqual(wrongKey, [
    `${VERSIONED}.sig does not verify against ${VERSIONED}: the signature does not match the file, or is not by the updater key`,
  ]);

  const otherFile = problemsOf((files) => {
    files[`${MSI}.sig`] = Buffer.from(updaterSignature(Buffer.from('another file')));
  });
  assert.deepEqual(otherFile, [
    `${MSI}.sig does not verify against ${MSI}: the signature does not match the file, or is not by the updater key`,
  ]);
});

test('a signature that is not a prehashed minisign signature, or is for another key id, is refused', () => {
  const legacy = problemsOf((files) => {
    files[`${VERSIONED}.sig`] = Buffer.from(updaterSignature(files[VERSIONED], KEY, { algorithm: 'Ed' }));
    setLatest(
      files,
      (latest) => (latest.platforms['windows-x86_64'].signature = files[`${VERSIONED}.sig`].toString()),
    );
  });
  assert.match(legacy[0], /not a prehashed minisign signature/);

  const otherId = problemsOf((files) => {
    files[`${VERSIONED}.sig`] = Buffer.from(
      updaterSignature(files[VERSIONED], KEY, { id: Buffer.from('ffffffffffffffff', 'hex') }),
    );
    setLatest(
      files,
      (latest) => (latest.platforms['windows-x86_64'].signature = files[`${VERSIONED}.sig`].toString()),
    );
  });
  assert.match(otherId[0], /another key id/);

  const garbage = problemsOf((files) => {
    files[`${VERSIONED}.sig`] = Buffer.from('not base64 minisign');
  });
  assert.ok(garbage.some((problem) => /is not a minisign signature/.test(problem)));
});

test('without the updater public key no signature can be trusted, so the check refuses', () => {
  const problems = problemsOf(() => {}, { pubkey: undefined });
  assert.deepEqual(problems, ['no updater public key to verify the signatures with']);
});

test('the updater public key of the agent parses as a minisign public key', () => {
  const conf = JSON.parse(readFileSync(path.join(root, 'apps/agent/src-tauri/tauri.conf.json'), 'utf8'));
  const parsed = parseMinisignPublicKey(conf.plugins.updater.pubkey);
  assert.equal(parsed.keyId.length, 8);
  assert.equal(parsed.publicKey.length, 32);
  assert.throws(() => parseMinisignPublicKey('AAAA'), /not a minisign public key/);
});

test('the CLI reads the repository and the key, exits 1 with one annotation per problem, and 0 on a good set', () => {
  const write = (files) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'assets-'));
    for (const [name, content] of Object.entries(files)) writeFileSync(path.join(dir, name), content);
    return dir;
  };
  const conf = path.join(mkdtempSync(path.join(tmpdir(), 'conf-')), 'tauri.conf.json');
  writeFileSync(conf, JSON.stringify({ plugins: { updater: { pubkey: KEY.pubkey } } }));
  const run = (dir) =>
    spawnSync('node', [script, '--dir', dir, '--tag', TAG, '--repo', REPO, '--tauri-conf', conf], {
      encoding: 'utf8',
    });
  const ok = run(write(drawn()));
  assert.equal(ok.status, 0, ok.stderr);
  const bad = run(write(drawn(without('SHA256SUMS'))));
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /::error::SHA256SUMS is missing/);
});

// Made by the real "tauri signer generate" and "tauri signer sign" (a throwaway key, nothing secret is kept here), so the
// verifier is checked against what the updater's own tool writes, not only against signatures this file draws.
const REAL_SIGNER = {
  pubkey:
    'dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEQyNDg4NkNGMTk3OThGMTMKUldRVGoza1p6NFpJMGlJOEJGNFl4RklMSEFkYS9qYndUSG5WMksvMS9sZkN2dkY4cTFvYkJpWVAK',
  signature:
    'dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVRVGoza1p6NFpJMHF1ZDZ4bWhqVGc5cytzOFlUUXBtaGxRMDRvZVN1RGw4TEZXRDdDSnZNVko3a1Rna0RWVFZlTDVERlhWVGIvUWdEc2Ywd2I5dlErNlovZ3AwQzdzU1E0PQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzk1MjEwMzE1CWZpbGU6ZmlsZS5iaW4KSVJBczBuNTdXWmpqdkNRMEluZDgwL0dvSDdwSHViTXBSN3ZENXEwYmJwS1pZNXlGU2pIdm1FQ3RPdGZyTzNrUklITnFYYVJFRGx1dWpYY1hyUDlzQUE9PQo=',
  file: Buffer.from('hello installer'),
};

test('a signature written by the real Tauri signer verifies, and fails for another file', () => {
  assert.equal(
    updaterSignatureProblem(REAL_SIGNER.file, REAL_SIGNER.signature, REAL_SIGNER.pubkey),
    undefined,
  );
  assert.match(
    updaterSignatureProblem(Buffer.from('tampered'), REAL_SIGNER.signature, REAL_SIGNER.pubkey) ?? '',
    /does not match the file/,
  );
  assert.match(
    updaterSignatureProblem(REAL_SIGNER.file, REAL_SIGNER.signature, KEY.pubkey) ?? '',
    /another key id/,
  );
});
