// Checks on the API's Stryker disable comments (ADR 038), modelled on scripts/agent/mutation-config.mjs.
//   node scripts/api/mutation-disables.mjs [file ...]
// A mutant that no test can tell apart from the original (an equivalent mutant) is retired with
//   // Stryker disable next-line <Mutator>: equivalent — <reason>
// The check fails (exit 1) on a disable with no reason, no mutator, `all`, several mutators, an unknown mutator, a
// reason that does not start with `equivalent — `, the block `disable` form, a comment with nothing to disable below it
// (blank line, another comment or end of file) and a stale disable: the line it covers no longer holds a construct the
// named mutator produces. The functions are exported so the harness tests can check fixtures.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const apiSource = path.join(root, 'apps', 'api', 'src');

const METHODS =
  'endsWith|startsWith|toUpperCase|toLowerCase|trim|trimStart|trimEnd|substr|substring|slice|filter|some|every|sort|reverse|min|max|padStart|padEnd|charAt';

/** What each mutator needs on the covered line (strings and the trailing comment already blanked out). */
const CONSTRUCTS = {
  StringLiteral: (code, raw) => /['"`]/.test(raw),
  ConditionalExpression: (code) =>
    /\b(if|while|for|case|do)\b|\?(?!\.)|&&|\|\||\?\?|[<>]=?|[!=]==?(?!>)/.test(code) ||
    /\)\s*\{?\s*$/.test(code),
  BlockStatement: (code) => /\{/.test(code),
  EqualityOperator: (code) => /[<>]=?|[!=]==?(?!>)/.test(code.replace(/=>/g, '')),
  LogicalOperator: (code) => /&&|\|\||\?\?/.test(code),
  BooleanLiteral: (code) => /\b(true|false)\b|!(?!=)/.test(code),
  ArithmeticOperator: (code) => /[^+\-*/%=<>!&|?]\s*[+\-*/%]\s*[^+\-*/%=]/.test(code.replace(/=>/g, '')),
  MethodExpression: (code) => new RegExp(`\\.(${METHODS})\\s*\\(`).test(code),
  OptionalChaining: (code) => /\?\./.test(code),
  ArrayDeclaration: (code) => /\[|\bArray\b/.test(code),
  ObjectLiteral: (code) => /\{/.test(code),
  UnaryOperator: (code) => /(^|[=(,:?&|!\s])[+-][\w(]/.test(code),
  UpdateOperator: (code) => /\+\+|--/.test(code),
  AssignmentOperator: (code) => /(\+|-|\*|\/|%|&&|\|\||\?\?|<<|>>>?|&|\||\^)=/.test(code),
  ArrowFunction: (code) => /=>/.test(code),
  Regex: (code, raw) => /\/(?![/*]).+\/[dgimsuvy]*/.test(raw),
};
export const MUTATORS = Object.keys(CONSTRUCTS);

/** The code of a line with string contents blanked out and the trailing `//` comment cut off. */
function codeOf(line) {
  let out = '';
  let quote = null;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quote) {
      if (char === '\\') i += 1;
      else if (char === quote) {
        quote = null;
        out += char;
      }
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      out += char;
      continue;
    }
    if (char === '/' && line[i + 1] === '/') break;
    out += char;
  }
  return out;
}

const DISABLE = /\/\/\s*Stryker\s+(disable(?:[ -]next-line|-line)?)(?![\w-])(.*)$/;
const REASON_PREFIX = /^equivalent — \S/;
const isCommentLine = (line) => /^\s*(\/\/|\/\*|\*)/.test(line);

/** Problems of the disable comments in one file's text; `name` prefixes each message. */
export function disableProblems(text, name = 'file') {
  const lines = text.split('\n');
  const problems = [];
  lines.forEach((line, index) => {
    const found = DISABLE.exec(line);
    if (!found) return;
    const where = `${name}:${index + 1}`;
    const form = found[1].replace(/\s+/g, ' ');
    const rest = found[2];
    const colon = rest.indexOf(':');
    const mutatorText = (colon === -1 ? rest : rest.slice(0, colon)).trim();
    const reason = colon === -1 ? '' : rest.slice(colon + 1).trim();
    const mutators = mutatorText === '' ? [] : mutatorText.split(/[,\s]+/).filter(Boolean);
    const before = problems.length;

    if (form === 'disable') problems.push(`${where}: use "disable next-line <Mutator>", not the block form`);
    if (mutators.length === 0) problems.push(`${where}: names no mutator`);
    else if (mutators.includes('all')) problems.push(`${where}: "all" is not allowed; name the one mutator`);
    else if (mutators.length > 1)
      problems.push(`${where}: names ${mutators.length} mutators; one disable names one mutator`);
    else if (!(mutators[0] in CONSTRUCTS)) problems.push(`${where}: unknown mutator "${mutators[0]}"`);
    if (reason === '') problems.push(`${where}: has no reason after the colon`);
    else if (!REASON_PREFIX.test(reason))
      problems.push(`${where}: the reason must start with "equivalent — " and say why`);
    if (problems.length > before) return;

    let target;
    if (form === 'disable-line') {
      target = line.slice(0, line.indexOf('//'));
      if (target.trim() === '') problems.push(`${where}: disable-line has no code on its line`);
    } else {
      target = lines[index + 1];
      if (target === undefined || target.trim() === '')
        problems.push(`${where}: nothing to disable on the next line (blank or end of file)`);
      else if (isCommentLine(target))
        problems.push(`${where}: the next line is a comment, not the code to disable`);
    }
    if (problems.length > before) return;
    if (!CONSTRUCTS[mutators[0]](codeOf(target), target.replace(/\/\/.*$/, '')))
      problems.push(`${where}: stale; the covered line holds no construct ${mutators[0]} produces`);
  });
  return problems;
}

function walk(dir, found = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, found);
    else if (full.endsWith('.ts')) found.push(full);
  }
  return found;
}

/** Disable-comment problems of every `.ts` file under `dir` (a file whose text mentions no Stryker comment has none). */
export function treeProblems(dir = apiSource) {
  return walk(dir).flatMap((file) => disableProblems(readFileSync(file, 'utf8'), path.relative(root, file)));
}

/** Files under a `testing/` folder that a product file (neither a test nor itself under `testing/`) imports. */
export function testingFolderProblems(dir = apiSource) {
  const files = walk(dir).map((file) => path.relative(dir, file).split(path.sep).join('/'));
  const inTesting = (file) => file.split('/').includes('testing');
  const support = files.filter(inTesting);
  const problems = [];
  for (const file of files.filter((candidate) => !inTesting(candidate) && !candidate.endsWith('.test.ts'))) {
    const text = readFileSync(path.join(dir, file), 'utf8');
    for (const target of support) {
      const base = target.replace(/\.ts$/, '').split('/').pop();
      if (new RegExp(`/testing/${base}(\\.ts)?['"]`).test(text))
        problems.push(`${file} (product) imports ${target}`);
    }
  }
  return problems;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const given = process.argv.slice(2);
  const problems =
    given.length > 0
      ? given.flatMap((file) => disableProblems(readFileSync(file, 'utf8'), file))
      : [...treeProblems(), ...testingFolderProblems()];
  for (const problem of problems) console.error(problem);
  process.exit(problems.length > 0 ? 1 : 0);
}
