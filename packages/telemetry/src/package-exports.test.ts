import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The package exports its source files (like @d2rmm/contracts), so every consumer reads the same TypeScript.
const packageJsonPath = fileURLToPath(new URL('../package.json', import.meta.url));

describe('@d2rmm/telemetry package entries', () => {
  it('entries resolve to source files', async () => {
    const manifest = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { exports: Record<string, string> };
    expect(manifest.exports).toStrictEqual({
      '.': './src/index.ts',
      './node': './src/node-sdk.ts',
      './web': './src/web-sdk.ts',
    });

    const root = await import('@d2rmm/telemetry');
    const node = await import('@d2rmm/telemetry/node');
    const web = await import('@d2rmm/telemetry/web');
    expect(root).toBeDefined();
    expect(node).toBeDefined();
    expect(web).toBeDefined();
  }, 30_000);
});
