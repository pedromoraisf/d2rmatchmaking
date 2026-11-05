import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyProof, checkMutationSpec } from '../lib/mutation-scope.mjs';

const ok = (cmd) => assert.equal(classifyProof(cmd).ok, true, cmd);
const refused = (cmd, fragment) => {
  const v = classifyProof(cmd);
  assert.equal(v.ok, false, cmd);
  if (fragment) assert.match(v.reason, fragment, cmd);
};

test('rust: a unit proof names the crate and --lib', () => {
  ok(
    "cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent-core --lib -E 'test(backoff_doubles_to_60s)'",
  );
  ok('cargo test -p d2rmm-agent-core --lib backoff');
  ok('cargo nextest run --package d2rmm-agent-core --lib');
});

test('rust: the workspace-wide proofs agent-skeleton used before ADR 026 are refused', () => {
  refused(
    "cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml --workspace -E 'test(claims_every_two_seconds_until_token)'",
    /--workspace/,
  );
});

test('rust: the three agent crates are proved by their --lib unit tests, never their tests/ directory', () => {
  for (const crate of ['d2rmm-agent-domain', 'd2rmm-agent-core', 'd2rmm-agent-adapters']) {
    ok(
      `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -p ${crate} --lib -E 'test(timing_constants_are_pinned)'`,
    );
    refused(
      `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -p ${crate} --tests`,
      /--tests/,
    );
    refused(`cargo nextest run -p ${crate} --lib --test stream_limits`, /--test/);
  }
});

test('rust: integration binaries, the tests/ directory and wide targets are refused', () => {
  refused('cargo nextest run -p d2rmm-agent-core --lib --test stream', /--test/);
  refused('cargo nextest run -p d2rmm-agent-core --tests', /--tests/);
  refused('cargo nextest run -p d2rmm-agent-core --all-targets', /--all-targets/);
  refused('cargo nextest run --workspace --lib', /--workspace/);
  refused('cargo nextest run -p d2rmm-agent-core --lib --doc', /--doc/);
});

test('rust: without -p or without --lib the proof is refused', () => {
  refused('cargo nextest run --lib', /-p <crate>/);
  refused('cargo nextest run -p d2rmm-agent-core', /--lib/);
});

test('harness: node --test only from the harness unit test directories', () => {
  ok('node --test --test-name-pattern="the tag must be an ancestor" scripts/test/release-workflows.test.mjs');
  ok('node --test .claude/hooks/test/gate-rules.test.mjs');
  refused('node --test tests/acceptance/x.test.mjs', /scripts\/test or \.claude\/hooks\/test/);
  refused('node --test', /scripts\/test or \.claude\/hooks\/test/);
});

test('vitest: a colocated unit file passes; integration, e2e, acceptance and load are refused', () => {
  ok('pnpm exec vitest run apps/api/src/modules/matchmaking/domain/ready-check/ready-check.test.ts');
  ok('vitest run packages/contracts/src/ids.test.ts');
  refused('vitest run apps/api/test/integration/queue.test.ts', /integration/);
  refused('vitest run apps/web/e2e/queue.test.ts', /e2e/);
  refused('vitest run tests/acceptance/steps/queue.test.ts', /acceptance/);
  refused('vitest run', /src\/ directory/);
  ok('pnpm --filter @d2rmm/api exec vitest run scripts/mutation-plan.test.ts');
  ok(
    'pnpm --filter @d2rmm/api exec vitest run src/modules/agents/domain -t "marks the agent offline after 45 s"',
  );
});

test('heavy tools and unknown runners are refused', () => {
  refused('pnpm test:integration', /never prove a mutation/);
  refused('pnpm exec playwright test --grep @FR-01', /never prove a mutation/);
  refused('docker compose run tests', /never prove a mutation/);
  refused('make test', /not a recognised unit-test runner/);
  refused('', /no proof command/);
});

test('checkMutationSpec reports each offending mutation by label', () => {
  const errors = checkMutationSpec([
    { label: 'good', proof: 'cargo nextest run -p d2rmm-agent-core --lib' },
    { label: 'bad one', proof: 'cargo nextest run --workspace' },
    { proof: 'pnpm test:e2e' },
  ]);
  assert.equal(errors.length, 2);
  assert.match(errors[0], /"bad one"/);
  assert.match(errors[1], /#3/);
  assert.deepEqual(checkMutationSpec([]), []);
  assert.equal(checkMutationSpec({}).length, 1);
});
