import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';
import { startLocal } from './local.ts';

const directory = mkdtempSync(join(tmpdir(), 'local-start-'));
afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe('startLocal', () => {
  it('does not start when the agent configuration file fails its schema (RCF-12)', async () => {
    const file = join(directory, 'agent-config.json');
    writeFileSync(file, '{"version":1,"cadence":{"lookIntervalMs":1}}');
    // The port 1 would refuse a connection: the rejection below is the file's, raised before any connection is tried.
    const config = loadConfig({ DATABASE_URL: 'postgres://user:pw@127.0.0.1:1/none' });
    await expect(startLocal(config, file)).rejects.toThrow(/agent configuration file is refused \(invalid\)/);
  });

  it('does not start when the agent configuration file is missing', async () => {
    const config = loadConfig({ DATABASE_URL: 'postgres://user:pw@127.0.0.1:1/none' });
    await expect(startLocal(config, join(directory, 'missing.json'))).rejects.toThrow();
  });
});
