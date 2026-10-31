// Runs a command that must fail, and passes only when it fails and its output names the expected failure id (AGS-21,
// AGS-22). A success does not pass, and neither does a failure that lacks the id, such as a build error. The fixtures
// of the agent's read-only boundary (boundary-fixtures/) are checked this way in the CI `agent` job.
// Usage: node scripts/agent/expect-failure.mjs <id> -- <command> [args...]
import { spawnSync } from 'node:child_process';

const separator = process.argv.indexOf('--');
const id = process.argv[2];
const command = process.argv.slice(separator + 1);

if (id === undefined || id === '--' || separator !== 3 || command.length === 0) {
  console.error('usage: expect-failure.mjs <id> -- <command> [args...]');
  process.exit(2);
}

const result = spawnSync(command[0], command.slice(1), {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});
const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;

if (result.status === 0) {
  console.error(`expect-failure: the command succeeded; it must fail with "${id}"`);
  process.exit(1);
}
if (!output.includes(id)) {
  console.error(`expect-failure: the command failed, but its output does not name "${id}"`);
  process.stderr.write(output);
  process.exit(1);
}
console.log(`expect-failure: failed with "${id}" as expected`);
