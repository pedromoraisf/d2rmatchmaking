// The local Windows-target check (AD-071): the image name, the mounts and volumes, the exact clippy command, and the exit
// code of the container passed through. The docker argument builders are pure; the exit-code test runs the script with
// a fake `docker` first on PATH, so no image is built here.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import {
  BUILD_CONTEXT,
  CLIPPY_COMMAND,
  DOCKERFILE,
  IMAGE,
  REGISTRY_VOLUME,
  TARGET_VOLUME,
  buildArgs,
  runArgs,
} from '../agent/win-check.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const script = path.join(root, 'scripts', 'agent', 'win-check.mjs');

test('the image is named d2rmm-win-check and built from the crate directory', () => {
  assert.equal(IMAGE, 'd2rmm-win-check');
  assert.deepEqual(buildArgs('/repo'), [
    'build',
    '--file',
    path.join('/repo', 'apps/agent/src-tauri/win-check.Dockerfile'),
    '--tag',
    'd2rmm-win-check',
    path.join('/repo', 'apps/agent/src-tauri'),
  ]);
  assert.equal(DOCKERFILE, 'apps/agent/src-tauri/win-check.Dockerfile');
  assert.equal(BUILD_CONTEXT, 'apps/agent/src-tauri');
});

test('the container mounts the repository at /work and keeps build state in named volumes', () => {
  const args = runArgs('/repo');
  assert.deepEqual(args.slice(0, 2), ['run', '--rm']);
  assert.ok(args.includes('/repo:/work'), 'the repository is mounted at /work');
  assert.ok(args.includes(`${TARGET_VOLUME}:/cargo-target`), 'the target directory is a named volume');
  assert.ok(
    args.includes(`${REGISTRY_VOLUME}:/home/builder/.cargo/registry`),
    'the registry is a named volume',
  );
  assert.equal(args[args.indexOf('--workdir') + 1], '/work');
  assert.equal(TARGET_VOLUME, 'd2rmm-win-check-target');
  assert.equal(REGISTRY_VOLUME, 'd2rmm-win-check-cargo');
});

test('the container runs the exact clippy command for the Windows target, after the image name', () => {
  assert.deepEqual(CLIPPY_COMMAND, [
    'cargo',
    'clippy',
    '--locked',
    '--manifest-path',
    'apps/agent/src-tauri/Cargo.toml',
    '--target',
    'x86_64-pc-windows-msvc',
    '--all-targets',
    '--all-features',
    '--',
    '-D',
    'warnings',
  ]);
  assert.equal(
    CLIPPY_COMMAND.join(' '),
    'cargo clippy --locked --manifest-path apps/agent/src-tauri/Cargo.toml --target x86_64-pc-windows-msvc --all-targets --all-features -- -D warnings',
  );
  const args = runArgs('/repo');
  const imageAt = args.indexOf('d2rmm-win-check');
  assert.ok(imageAt > 0, 'the image name is an argument of run');
  assert.deepEqual(args.slice(imageAt + 1), CLIPPY_COMMAND);
});

// A fake `docker` that records its arguments; `build` exits 0 and `run` exits with `runExitCode`.
const fakeDocker = (runExitCode) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'win-check-'));
  const log = path.join(dir, 'args.log');
  const bin = path.join(dir, 'docker');
  writeFileSync(
    bin,
    `#!/bin/sh\nprintf '%s\\n' "$*" >> "${log}"\nif [ "$1" = build ]; then exit 0; fi\nexit ${runExitCode}\n`,
  );
  chmodSync(bin, 0o755);
  return { dir, log };
};

const runScript = (dir) =>
  spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH ?? ''}` },
  });

test('the container exit code is the script exit code', () => {
  const { dir } = fakeDocker(7);
  const result = runScript(dir);
  assert.equal(result.status, 7);
});

test('a successful build and run exit 0 and the run reaches docker with the clippy command', () => {
  const { dir, log } = fakeDocker(0);
  const result = runScript(dir);
  assert.equal(result.status, 0);
  const calls = spawnSync('sh', ['-c', `cat "${log}"`], { encoding: 'utf8' })
    .stdout.trim()
    .split('\n');
  assert.equal(calls.length, 2, 'docker build then docker run');
  assert.match(calls[0], /^build --file .*win-check\.Dockerfile --tag d2rmm-win-check /);
  assert.match(calls[1], /^run --rm --volume .*:\/work /);
  assert.ok(calls[1].endsWith(CLIPPY_COMMAND.join(' ')), 'the run ends with the clippy command');
});
