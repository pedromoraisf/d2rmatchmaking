// Unit tests of the release asset checker (AGR-03): drawn asset sets, each broken in one way.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkRelease } from '../agent/release-assets.mjs';

const TAG = 'agent-v0.4.0';
const VERSIONED = 'D2RMatchMaking_0.4.0_x64-setup.exe';
const hash = (content) => createHash('sha256').update(content).digest('hex');

/** A complete, agreeing set. `change` edits it before it is returned. */
function drawn(change = () => {}) {
  const installer = Buffer.from('installer bytes');
  const files = {
    [VERSIONED]: installer,
    [`${VERSIONED}.sig`]: Buffer.from('updater-signature\n'),
    'D2RMatchMaking-setup.exe': Buffer.from(installer),
    'latest.json': Buffer.from(
      JSON.stringify({
        version: '0.4.0',
        platforms: {
          'windows-x86_64': {
            signature: 'updater-signature',
            url: `https://github.com/o/r/releases/download/${TAG}/${VERSIONED}`,
          },
        },
      }),
    ),
    SHA256SUMS: Buffer.from(
      `${hash(installer)}  ${VERSIONED}\n${hash(installer)}  D2RMatchMaking-setup.exe\n`,
    ),
  };
  change(files);
  return files;
}
const problemsOf = (change) => checkRelease({ tag: TAG, files: drawn(change) });
const without = (name) => (files) => Reflect.deleteProperty(files, name);

test('a complete set that agrees has no problem', () => {
  assert.deepEqual(
    problemsOf(() => {}),
    [],
  );
});

test('a tag that is not an agent tag is refused', () => {
  assert.deepEqual(checkRelease({ tag: 'v0.4.0', files: drawn() }), ['not an agent release tag: v0.4.0']);
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
  assert.match(problems[0], /no installer for version 0\.4\.0/);
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
  const problems = problemsOf((files) => {
    const latest = JSON.parse(files['latest.json'].toString());
    latest.version = '0.3.0';
    files['latest.json'] = Buffer.from(JSON.stringify(latest));
  });
  assert.deepEqual(problems, ['latest.json says version 0.3.0, the tag is 0.4.0']);
});

test('latest.json must point at the installer of this release', () => {
  const problems = problemsOf((files) => {
    const latest = JSON.parse(files['latest.json'].toString());
    latest.platforms['windows-x86_64'].url =
      `https://github.com/o/r/releases/download/agent-v0.3.0/${VERSIONED}`;
    files['latest.json'] = Buffer.from(JSON.stringify(latest));
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /not at D2RMatchMaking_0\.4\.0_x64-setup\.exe of agent-v0\.4\.0/);
});

test('latest.json must carry the updater signature of the installer that ships', () => {
  const problems = problemsOf((files) => {
    files[`${VERSIONED}.sig`] = Buffer.from('signature-of-the-signed-file\n');
  });
  assert.deepEqual(problems, [`latest.json carries a signature that is not the one of ${VERSIONED}.sig`]);
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

test('the CLI exits 1 with one annotation per problem, and 0 on a good set', () => {
  const script = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'agent',
    'release-assets.mjs',
  );
  const write = (files) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'assets-'));
    for (const [name, content] of Object.entries(files)) writeFileSync(path.join(dir, name), content);
    return dir;
  };
  const ok = spawnSync('node', [script, '--dir', write(drawn()), '--tag', TAG], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  const bad = spawnSync('node', [script, '--dir', write(drawn(without('SHA256SUMS'))), '--tag', TAG], {
    encoding: 'utf8',
  });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /::error::SHA256SUMS is missing/);
});
