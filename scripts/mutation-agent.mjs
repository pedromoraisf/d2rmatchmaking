// `pnpm test:mutation:agent`: cargo-mutants on the three agent crates, unit tests only (ADR 026, --lib).
// Every crate is measured even when an earlier one exits non-zero (missed mutants exit 2); the exit code is the worst one.
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const MANIFEST = '--manifest-path apps/agent/src-tauri/Cargo.toml';
// The core crate runs in place: its tests include_str! the sidecars of apps/agent/fixtures, outside the Cargo workspace
// that cargo-mutants copies to a temp dir.
const COMMANDS = [
  `cargo mutants ${MANIFEST} --package d2rmm-agent-domain --output reports/mutation/agent-domain -- --lib`,
  `cargo mutants ${MANIFEST} --package d2rmm-agent-core --in-place --output reports/mutation/agent-core -- --lib`,
  `cargo mutants ${MANIFEST} --package d2rmm-agent-adapters --output reports/mutation/agent-adapters -- --lib`,
];

mkdirSync('reports/mutation', { recursive: true });
let exitCode = 0;
for (const command of COMMANDS) {
  const result = spawnSync(command, { shell: true, stdio: 'inherit' });
  if (result.status !== 0) exitCode = result.status ?? 1;
}
process.exit(exitCode);
