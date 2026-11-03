import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanupPlan, sweepPlan } from '../../load/lib/cleanup-plan.mjs';

const RUN = 'k7q2mz9a';
const OTHER = 'zzzzzzzz';
const WORK = `/var/folders/ab/T/d2rmm-load-${RUN}-AbC123`;
const UID = 501;

test('cleanup and sweep plans: removes every created container in reverse start order, then the network and the directory', () => {
  const plan = cleanupPlan({
    containers: [`d2rmm-load-${RUN}-postgres`, `d2rmm-load-${RUN}-sink`, `d2rmm-load-${RUN}-api`],
    network: `d2rmm-load-${RUN}-net`,
    workDir: WORK,
  });
  assert.deepEqual(plan.containers, [
    `d2rmm-load-${RUN}-api`,
    `d2rmm-load-${RUN}-sink`,
    `d2rmm-load-${RUN}-postgres`,
  ]);
  assert.deepEqual(plan.networks, [`d2rmm-load-${RUN}-net`]);
  assert.deepEqual(plan.directories, [WORK]);
});

test('cleanup and sweep plans: nothing created is an empty plan', () => {
  const empty = { containers: [], networks: [], directories: [] };
  assert.deepEqual(cleanupPlan({}), empty);
  assert.deepEqual(cleanupPlan({ containers: [], network: null, workDir: null }), empty);
  assert.deepEqual(cleanupPlan(), empty);
});

test('cleanup and sweep plans: a name outside the run prefix is never removed', () => {
  const plan = cleanupPlan({
    containers: [
      `postgres-prod`,
      `d2rmm-load-${RUN.toUpperCase()}-api`,
      `d2rmm-load-${RUN}`,
      `d2rmm-load-${RUN}-sink`,
    ],
    network: 'bridge',
    workDir: '/tmp/elsewhere',
  });
  assert.deepEqual(plan.containers, [`d2rmm-load-${RUN}-sink`]);
  assert.deepEqual(plan.networks, []);
  assert.deepEqual(plan.directories, []);

  for (const workDir of [`d2rmm-load-${RUN}-x`, `/tmp/../d2rmm-load-${RUN}-x`]) {
    assert.deepEqual(cleanupPlan({ workDir }).directories, [], `${workDir} is not removed`);
  }
});

test('cleanup and sweep plans: the sweep keeps only labelled, well-named, current-user resources', () => {
  const found = [
    { kind: 'container', name: `d2rmm-load-${RUN}-api`, labels: { 'd2rmm-load': RUN } },
    { kind: 'container', name: `d2rmm-load-${RUN}`, labels: { 'd2rmm-load': RUN } },
    { kind: 'container', name: `d2rmm-load-${RUN}-api` },
    { kind: 'container', name: `d2rmm-load-${RUN}-api`, labels: { 'd2rmm-load': OTHER } },
    { kind: 'container', name: 'postgres', labels: { 'd2rmm-load': RUN } },
    { kind: 'network', name: `d2rmm-load-${RUN}-net`, labels: { 'd2rmm-load': RUN } },
    { kind: 'network', name: `d2rmm-load-${RUN}-net` },
    { kind: 'directory', name: WORK, uid: UID, mode: 0o700 },
    { kind: 'directory', name: `/var/folders/ab/T/d2rmm-load-${RUN}-shared`, uid: UID, mode: 0o755 },
    { kind: 'directory', name: `/var/folders/ab/T/d2rmm-load-${RUN}-root`, uid: 0, mode: 0o700 },
    {
      kind: 'directory',
      name: `/var/folders/ab/T/d2rmm-load-${RUN}-link`,
      uid: UID,
      mode: 0o700,
      symlink: true,
    },
    { kind: 'directory', name: `/var/folders/ab/T/d2rmm-load-${RUN.toUpperCase()}-x`, uid: UID, mode: 0o700 },
  ];
  const plan = sweepPlan(found, { uid: UID });
  assert.deepEqual(plan.containers, [`d2rmm-load-${RUN}-api`, `d2rmm-load-${RUN}`]);
  assert.deepEqual(plan.networks, [`d2rmm-load-${RUN}-net`]);
  assert.deepEqual(plan.directories, [WORK]);
});

test('cleanup and sweep plans: the sweep reads the permission bits of a directory and ignores its type bits', () => {
  const plan = sweepPlan([{ kind: 'directory', name: WORK, uid: UID, mode: 0o40700 }], { uid: UID });
  assert.deepEqual(plan.directories, [WORK], 'an lstat mode with the directory bit is 0700 for the owner');
  assert.deepEqual(sweepPlan([], { uid: UID }), { containers: [], networks: [], directories: [] });
});
