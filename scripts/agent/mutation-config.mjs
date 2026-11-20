// Checks on the agent's cargo-mutants config (ocr-protection, OCP-02, OCP-03, OCP-06).
//   node scripts/agent/mutation-config.mjs [path/to/mutants.toml]
// fails (exit 1) when a reading module is missing or outside `examine_globs`, or when an `exclude_re` entry has no
// evidence comment. The functions are exported so the harness tests can check fixtures.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const agentRoot = path.join(root, 'apps', 'agent', 'src-tauri');
export const defaultConfig = path.join(agentRoot, '.cargo', 'mutants.toml');
export const readingModulesFile = path.join(root, 'scripts', 'agent', 'reading-modules.json');

export const readingModules = () => JSON.parse(readFileSync(readingModulesFile, 'utf8')).modules;

/** The quoted strings of a TOML array `key = [ ... ]`, with the comment block that precedes each one. */
function entriesOf(toml, key) {
  const lines = toml.split('\n');
  const entries = [];
  let comments = [];
  let inside = false;
  for (const line of lines) {
    const text = line.trim();
    if (text.startsWith('#')) {
      comments.push(text);
      continue;
    }
    if (text === '') {
      comments = [];
      continue;
    }
    if (!inside && new RegExp(`^${key}\\s*=\\s*\\[`).test(text)) inside = true;
    if (inside) {
      const body = text.replace(new RegExp(`^${key}\\s*=\\s*\\[`), '');
      const found = [...body.replace(/\].*$/, '').matchAll(/"((?:[^"\\]|\\.)*)"/g)];
      for (const match of found) entries.push({ value: match[1], comments: [...comments] });
      if (text.includes(']')) inside = false;
      // The comment block above `key = [` belongs to the first entry when the opening line holds none.
      if (found.length > 0 || !text.startsWith(`${key}`)) comments = [];
      continue;
    }
    comments = [];
  }
  return entries;
}

export const examineGlobs = (toml) => entriesOf(toml, 'examine_globs').map((entry) => entry.value);

const globToRegExp = (glob) =>
  new RegExp(
    `^${glob
      .split('**/')
      .map((part) =>
        part
          .split('*')
          .map((piece) => piece.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
          .join('[^/]*'),
      )
      .join('(?:.*/)?')}$`,
  );

/** The listed reading modules that do not exist, or that no `examine_globs` entry covers. */
export function readingModuleProblems(toml, modules = readingModules(), base = agentRoot) {
  const globs = examineGlobs(toml).map(globToRegExp);
  const problems = [];
  for (const module of modules) {
    if (!existsSync(path.join(base, module))) problems.push(`${module} does not exist`);
    else if (!globs.some((glob) => glob.test(module))) problems.push(`${module} is outside examine_globs`);
  }
  return problems;
}

/** The `exclude_re` entries whose preceding comment lacks the `file:line`, the reason or the `Evidence:` line. */
export function exclusionProblems(toml) {
  const problems = [];
  for (const { value, comments } of entriesOf(toml, 'exclude_re')) {
    const text = comments.map((line) => line.replace(/^#\s?/, ''));
    const missing = [];
    if (!text.some((line) => /[\w/]+\.rs:\d+/.test(line))) missing.push('a file:line');
    if (!text.some((line) => /^Evidence:\s*\S/.test(line))) missing.push('an "Evidence:" line');
    const evidenceAt = text.findIndex((line) => /^Evidence:/.test(line));
    if (text.filter((_, index) => index !== evidenceAt).length < 2) missing.push('the reason');
    if (missing.length > 0) problems.push(`exclusion "${value}" lacks ${missing.join(', ')}`);
  }
  return problems;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = process.argv[2] ? path.resolve(process.argv[2]) : defaultConfig;
  const toml = readFileSync(file, 'utf8');
  const problems = [...readingModuleProblems(toml), ...exclusionProblems(toml)];
  for (const problem of problems) console.error(problem);
  process.exit(problems.length > 0 ? 1 : 0);
}
