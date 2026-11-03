// The publish command (LB-16; design.md § Pure rules, `publish.mjs`). `node scripts/load/publish.mjs [--root <dir>]` reads
// `<root>/reports/load/summary.json`, applies `publishPlan` and writes `<root>/docs/engineering/load-baseline.md` only when
// the plan allows it. A refusal (missing, smoke, failed or unreadable summary) prints the reason, exits 1 and writes
// nothing. The default root is the repository. Zero dependencies: node:fs/promises, node:path, node:url.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { publishPlan } from './lib/publish.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = join(HERE, '..', '..');
const SUMMARY_PATH = join('reports', 'load', 'summary.json');
const DOCUMENT_PATH = join('docs', 'engineering', 'load-baseline.md');
const USAGE = 'usage: node scripts/load/publish.mjs [--root <dir>]';

/**
 * The `--root` argument, or the repository root. Any other argument is refused.
 * @param {string[]} argv the arguments after the script name
 * @returns {{ root: string } | { error: string }}
 */
export function parseArguments(argv) {
  if (argv.length === 0) return { root: REPOSITORY_ROOT };
  if (argv.length === 2 && argv[0] === '--root' && argv[1] !== '') return { root: resolve(argv[1]) };
  return { error: USAGE };
}

async function readSummary(path) {
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  return JSON.parse(text);
}

/**
 * Publishes the baseline document of the summary under `root`, or refuses with a reason and writes nothing.
 * @param {string} root
 * @returns {Promise<{ exitCode: 0 | 1, message: string }>}
 */
export async function publishAt(root) {
  let summary;
  try {
    summary = await readSummary(join(root, SUMMARY_PATH));
  } catch (error) {
    const reason =
      error instanceof SyntaxError ? 'the summary is not valid JSON' : 'the summary could not be read';
    return { exitCode: 1, message: `not published: ${reason}` };
  }
  const plan = publishPlan(summary);
  if (!plan.allowed) return { exitCode: 1, message: `not published: ${plan.reason}` };

  const target = join(root, DOCUMENT_PATH);
  const staging = `${target}.${process.pid}.tmp`;
  await mkdir(dirname(target), { recursive: true });
  await writeFile(staging, plan.text, 'utf8');
  await rename(staging, target);
  return { exitCode: 0, message: `published ${target}` };
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  if ('error' in args) {
    console.error(args.error);
    process.exitCode = 1;
    return;
  }
  const result = await publishAt(args.root);
  if (result.exitCode === 0) console.log(result.message);
  else console.error(result.message);
  process.exitCode = result.exitCode;
}

const isEntry = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntry) {
  await main();
}
