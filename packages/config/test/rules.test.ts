import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// Lints a text as if it were the file at `repoPath` (repo-relative), with the shared preset as the only configuration.
// The file need not exist: ESLint only uses the path to pick the rules that apply to it.
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const presetFile = fileURLToPath(new URL('../eslint.mjs', import.meta.url));

async function ruleIdsFor(repoPath: string, text: string): Promise<(string | null)[]> {
  const eslint = new ESLint({ cwd: repoRoot, overrideConfigFile: presetFile });
  const [result] = await eslint.lintText(text, { filePath: `${repoRoot}${repoPath}` });
  return (result?.messages ?? []).map((message) => message.ruleId);
}

describe('shared ESLint preset rules', () => {
  it('n/no-process-env reports a process.env read in a module file', async () => {
    const ruleIds = await ruleIdsFor(
      'apps/api/src/modules/a/application/x.ts',
      'export const databaseUrl = process.env.DATABASE_URL;\n',
    );
    expect(ruleIds).toStrictEqual(['n/no-process-env']);
  });

  it('reports process.env in the telemetry package', async () => {
    const ruleIds = await ruleIdsFor(
      'packages/telemetry/src/node-sdk.ts',
      'export const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;\n',
    );
    expect(ruleIds).toStrictEqual(['n/no-process-env']);
  });

  it('n/no-process-env allows process.env in the composition root', async () => {
    const ruleIds = await ruleIdsFor(
      'apps/api/src/main/config.ts',
      'export const databaseUrl = process.env.DATABASE_URL;\n',
    );
    expect(ruleIds).toStrictEqual([]);
  });

  it('reports a literal string in a component', async () => {
    const ruleIds = await ruleIdsFor('apps/web/src/app/x.tsx', 'export const App = () => <p>Hello</p>;\n');
    expect(ruleIds).toStrictEqual(['i18next/no-literal-string']);
  });

  it('reports a literal string in an agent component', async () => {
    const ruleIds = await ruleIdsFor(
      'apps/agent/src/views/x.tsx',
      'export const View = () => <p>Hello</p>;\n',
    );
    expect(ruleIds).toStrictEqual(['i18next/no-literal-string']);
  });

  it('bans Math.random in the API outside the domain', async () => {
    const ruleIds = await ruleIdsFor('apps/api/src/platform/x.ts', 'export const roll = Math.random();\n');
    expect(ruleIds).toStrictEqual(['no-restricted-properties']);
  });
});
