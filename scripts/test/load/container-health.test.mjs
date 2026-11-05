import assert from 'node:assert/strict';
import { test } from 'node:test';
import { containerOk, peakOf } from '../../load/lib/container-health.mjs';

const inspect = (overrides = {}) => ({
  RestartCount: 0,
  State: {
    Running: true,
    OOMKilled: false,
    StartedAt: '2026-11-03T10:00:00.000000000Z',
    ...overrides.State,
  },
  ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== 'State')),
});

test('container is not ok after a restart, an OOM kill or a stop', () => {
  const before = inspect();
  assert.equal(containerOk(before, inspect()), true, 'an unchanged container is ok');
  assert.equal(containerOk(before, inspect({ RestartCount: 1 })), false, 'a restart count that went up');
  assert.equal(containerOk(before, inspect({ State: { OOMKilled: true } })), false, 'an OOM kill');
  assert.equal(containerOk(before, inspect({ State: { Running: false } })), false, 'a stopped container');
  assert.equal(
    containerOk(before, inspect({ State: { StartedAt: '2026-11-03T10:05:00.000000000Z' } })),
    false,
    'a container started again',
  );
});

test('peak CPU and memory from the samples', () => {
  const samples = [
    { CPUPerc: '12.50%', MemUsage: '45.5MiB / 512MiB' },
    { CPUPerc: '48.00%', MemUsage: '100MiB / 512MiB' },
    { CPUPerc: '3.10%', MemUsage: '2GiB / 4GiB' },
  ];
  assert.deepEqual(peakOf(samples), { peakCpuPercent: 48, peakMemoryBytes: 2 * 2 ** 30 });
  assert.deepEqual(peakOf([{ CPUPerc: '0.00%', MemUsage: '512KiB / 512MiB' }]), {
    peakCpuPercent: 0,
    peakMemoryBytes: 512 * 1024,
  });
});

test('no samples give zero peaks', () => {
  assert.deepEqual(peakOf([]), { peakCpuPercent: 0, peakMemoryBytes: 0 });
});

test('unreadable inspect or stats text is refused', () => {
  assert.throws(() => containerOk({}, inspect()), TypeError);
  assert.throws(() => peakOf([{ CPUPerc: 'high', MemUsage: '1MiB / 2MiB' }]), TypeError);
  assert.throws(() => peakOf([{ CPUPerc: '1%', MemUsage: '1 furlongs / 2MiB' }]), TypeError);
});
