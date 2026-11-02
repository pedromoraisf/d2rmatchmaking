// Proves that `.env.example` (repo root) lists every OTEL_* variable the API config reads (OBS-40). The names come from the
// config source itself, so a new read that is not documented fails here. The file holds placeholders only; the
// gitleaks and secretlint allowlists cover it by name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const configSource = readFileSync(path.join(root, 'apps', 'api', 'src', 'main', 'config.ts'), 'utf8');
const envExample = readFileSync(path.join(root, '.env.example'), 'utf8');

/** The OTEL_* names the config reads: every `env['OTEL_…']` access, as the config writes them. */
function otelVariablesRead(source) {
  return [
    ...new Set([...source.matchAll(/env\[['"](OTEL_[A-Z0-9_]+)['"]\]/g)].map((match) => match[1])),
  ].sort();
}

test('.env.example lists every OTEL variable the config reads', () => {
  const read = otelVariablesRead(configSource);
  assert.ok(read.length >= 4, `expected the config to read the OTEL settings, found ${read.length}`);

  const declared = new Set(
    envExample
      .split('\n')
      .map((line) => /^([A-Z0-9_]+)=/.exec(line)?.[1])
      .filter((name) => name !== undefined),
  );
  const missing = read.filter((name) => !declared.has(name));
  assert.deepEqual(missing, [], `these OTEL variables are read by the config but missing from .env.example`);
});
