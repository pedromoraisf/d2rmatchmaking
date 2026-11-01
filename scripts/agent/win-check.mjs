// The local Windows-target check of the agent's #[cfg(windows)] adapters (AD-071): builds the check image from
// apps/agent/src-tauri/win-check.Dockerfile, then runs the clippy command for x86_64-pc-windows-msvc inside it. The
// repository is mounted at /work; the target directory and the cargo registry are named volumes, so no Linux artefacts
// land in the host's target/. The exit code of the container is this script's exit code. Nothing runs on the host.
// Usage: node scripts/agent/win-check.mjs
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const IMAGE = 'd2rmm-win-check';
export const TARGET_VOLUME = 'd2rmm-win-check-target';
export const REGISTRY_VOLUME = 'd2rmm-win-check-cargo';
export const CONTAINER_WORKDIR = '/work';
export const CONTAINER_TARGET_DIR = '/cargo-target';
export const CONTAINER_REGISTRY_DIR = '/home/builder/.cargo/registry';
export const DOCKERFILE = 'apps/agent/src-tauri/win-check.Dockerfile';
export const BUILD_CONTEXT = 'apps/agent/src-tauri';

// The clippy command of the Windows gate (tasks.md, Gate Check Commands, Rust Windows).
export const CLIPPY_COMMAND = [
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
];

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Pure: the arguments of `docker build` for the check image.
export function buildArgs(repoRoot = root) {
  return [
    'build',
    '--file',
    path.join(repoRoot, DOCKERFILE),
    '--tag',
    IMAGE,
    path.join(repoRoot, BUILD_CONTEXT),
  ];
}

// Pure: the arguments of `docker run` for the clippy check in the container.
export function runArgs(repoRoot = root) {
  return [
    'run',
    '--rm',
    '--volume',
    `${repoRoot}:${CONTAINER_WORKDIR}`,
    '--volume',
    `${TARGET_VOLUME}:${CONTAINER_TARGET_DIR}`,
    '--volume',
    `${REGISTRY_VOLUME}:${CONTAINER_REGISTRY_DIR}`,
    '--workdir',
    CONTAINER_WORKDIR,
    IMAGE,
    ...CLIPPY_COMMAND,
  ];
}

function docker(args) {
  const result = spawnSync('docker', args, { stdio: 'inherit' });
  if (result.error) {
    console.error(`win-check: cannot run docker: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

export function main(repoRoot = root) {
  const built = docker(buildArgs(repoRoot));
  if (built !== 0) return built;
  return docker(runArgs(repoRoot));
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
