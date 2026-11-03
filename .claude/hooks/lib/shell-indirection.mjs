// Shell indirection for the PreToolUse gate: commands that run another command the gate would not see by looking at
// the head of a shell segment — `bash -c "…"`, `eval …`, `sudo/env/timeout …`, `xargs …`, `find -exec …`, inline
// interpreter code (`python -c`, `node -e`), scripts and shells reading stdin.
// Pure: string in, findings out. The gate decides what each finding means (gate-rules.mjs).

const ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/;
const SHELL = /^(ba|z|da|k|fi)?sh$/;
const PREFIXES = new Set([
  'sudo',
  'doas',
  'env',
  'nohup',
  'time',
  'timeout',
  'nice',
  'ionice',
  'stdbuf',
  'command',
  'builtin',
  'exec',
  'caffeinate',
  'chronic',
  'unbuffer',
]);
// Flags of a prefix command that take a value (the value is not the command).
const PREFIX_VALUES = {
  sudo: ['-u', '-g', '-h', '-p', '-C', '-D', '-U', '-r', '-t'],
  doas: ['-u', '-C'],
  env: ['-u', '-C', '-S', '--unset', '--chdir'],
  timeout: ['-s', '-k', '--signal', '--kill-after'],
  nice: ['-n'],
  ionice: ['-c', '-n', '-p'],
};
const XARGS_VALUES = [
  '-I',
  '-n',
  '-P',
  '-L',
  '-l',
  '-d',
  '-s',
  '-E',
  '-e',
  '-a',
  '--max-args',
  '--max-procs',
  '--delimiter',
  '--arg-file',
  '--replace',
];
const FIND_EXEC = new Set(['-exec', '-execdir', '-ok', '-okdir']);
// Interpreter → flags whose next word is inline code.
const CODE_FLAGS = [
  [/^python[\d.]*$/, (a) => a === '-c'],
  [/^(node|bun|tsx|ts-node)$/, (a) => ['-e', '--eval', '-p', '--print'].includes(a)],
  [/^(perl|ruby)$/, (a) => /^-[a-zA-Z]*[eE]$/.test(a)],
];
const INTERPRETER = /^(python[\d.]*|node|bun|deno|tsx|ts-node|perl|ruby)$/;
// Interpreter flags that take a value; `-m` means "run a module", not a file.
const INTERP_VALUES = [
  '-W',
  '-X',
  '-Q',
  '--import',
  '--require',
  '-r',
  '--loader',
  '--experimental-loader',
  '--env-file',
  '--conditions',
  '-C',
];
const REDIRECT_OP = /^(\d*|&)(<<?<?|>>?)$/;
const REDIRECT = /^(\d*|&)(<|>)/;
const MAX_DEPTH = 5;

/** Split a command line on ; && || | & and newlines that are outside quotes. */
export function splitShell(cmd) {
  const out = [];
  let cur = '';
  let quote = null;
  const s = String(cmd ?? '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      cur += ch;
      if (ch === '\\' && quote === '"' && i + 1 < s.length) cur += s[++i];
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '\\' && i + 1 < s.length) {
      cur += ch + s[++i];
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === '\n' || ch === ';' || ch === '|' || ch === '&') {
      if ((ch === '&' || ch === '|') && s[i + 1] === ch) i++;
      else if (ch === '&' && (s[i + 1] === '>' || /[<>]$/.test(cur))) {
        cur += ch; // &> and >& are redirections, not separators
        continue;
      }
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

/** Words of one segment, with quotes removed and quoted spaces kept. */
export function shellWords(segment) {
  const words = [];
  let cur = '';
  let started = false;
  let quote = null;
  const s = String(segment ?? '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === '\\' && quote === '"' && /["\\$`]/.test(s[i + 1] ?? '')) cur += s[++i];
      else cur += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      started = true;
      continue;
    }
    if (ch === '\\' && i + 1 < s.length) {
      cur += s[++i];
      started = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (started) words.push(cur);
      cur = '';
      started = false;
      continue;
    }
    cur += ch;
    started = true;
  }
  if (started) words.push(cur);
  return words;
}

const quoteWord = (w) => (/^[\w@%+=:,./{}-]+$/.test(w) ? w : `'${w.replace(/'/g, `'\\''`)}'`);
const joinWords = (ws) => ws.map(quoteWord).join(' ');

function stripRedirects(args) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (REDIRECT_OP.test(args[i]))
      i++; // operator alone: its target is the next word
    else if (!REDIRECT.test(args[i])) out.push(args[i]);
  }
  return out;
}

function skipFlags(args, valued, { assignments = false } = {}) {
  let j = 0;
  while (j < args.length && (args[j].startsWith('-') || (assignments && ASSIGN.test(args[j])))) {
    j += valued.includes(args[j]) ? 2 : 1;
  }
  return args.slice(j);
}

function analyzeWords(words) {
  let i = 0;
  while (i < words.length && ASSIGN.test(words[i])) i++;
  const head = words.slice(i);
  if (head.length === 0 || head[0].startsWith('#')) return []; // empty, a comment or a shebang
  const c0 = head[0];
  const name = c0.split('/').pop();
  const args = stripRedirects(head.slice(1));

  if (name === 'eval') return args.length ? [{ kind: 'shell', text: args.join(' ') }] : [];

  if (PREFIXES.has(name)) {
    let rest = skipFlags(args, PREFIX_VALUES[name] ?? [], { assignments: name === 'env' });
    if (name === 'timeout') rest = rest.slice(1); // the duration
    return rest.length ? [{ kind: 'shell', text: joinWords(rest) }] : [];
  }

  if (name === 'xargs') {
    // xargs appends its input as arguments: an unknown `{}` target stands in for them.
    const rest = skipFlags(args, XARGS_VALUES);
    if (rest.length === 0) return [];
    const text = joinWords(rest);
    return [{ kind: 'shell', text: rest.some((w) => w.includes('{}')) ? text : `${text} {}` }];
  }

  if (name === 'find') {
    const out = [];
    for (let j = 0; j < args.length; j++) {
      if (!FIND_EXEC.has(args[j])) continue;
      const run = [];
      for (j++; j < args.length && ![';', '+'].includes(args[j]); j++) run.push(args[j]);
      if (run.length) out.push({ kind: 'shell', text: joinWords(run) });
    }
    return out;
  }

  if (SHELL.test(name)) {
    const c = args.findIndex((a) => /^-[A-Za-z]*c[A-Za-z]*$/.test(a));
    if (c >= 0) return [{ kind: 'shell', text: args[c + 1] ?? '' }];
    const file = args.find((a) => !a.startsWith('-'));
    return file ? [{ kind: 'script', path: file, via: name }] : [{ kind: 'stdin', lang: name }];
  }

  if (name === 'source' || name === '.') return args[0] ? [{ kind: 'script', path: args[0], via: 'sh' }] : [];

  for (const [re, isCodeFlag] of CODE_FLAGS) {
    if (!re.test(name)) continue;
    const j = args.findIndex((a) => isCodeFlag(a) || /^--(eval|print)=/.test(a));
    if (j >= 0) {
      const eq = /^--(eval|print)=(.*)$/s.exec(args[j]);
      return [{ kind: 'code', lang: name, text: eq ? eq[2] : (args[j + 1] ?? '') }];
    }
  }
  if (name === 'deno' && args[0] === 'eval') return [{ kind: 'code', lang: name, text: args[1] ?? '' }];

  if (INTERPRETER.test(name)) {
    if (args.length === 0) return [{ kind: 'stdin', lang: name }];
    const rest = (name === 'deno' || name === 'bun') && args[0] === 'run' ? args.slice(1) : args;
    for (let j = 0; j < rest.length; j++) {
      const a = rest[j];
      if (a === '-') return [{ kind: 'stdin', lang: name }];
      if (a === '-m' || a === '--test' || a === 'test') return []; // a module or the test runner, not a file
      if (INTERP_VALUES.includes(a)) {
        j++;
        continue;
      }
      if (a.startsWith('-')) continue;
      if ((name === 'deno' || name === 'bun') && !/[./]/.test(a)) return []; // a subcommand (`bun test`)
      return [{ kind: 'script', path: a, via: name }];
    }
    return [];
  }

  if (c0.includes('/') && !/(^|\/)node_modules\/\.bin\//.test(c0)) {
    return [{ kind: 'script', path: c0, via: null }];
  }
  return [];
}

/** Every indirection in a command line, segment by segment (not recursive). */
export function indirections(cmd) {
  return splitShell(cmd).flatMap((seg) => analyzeWords(shellWords(seg)));
}

/** Commands run by nested shells (`bash -c`, `eval`, prefixes…), outermost first, recursively. */
export function innerShellCommands(cmd, depth = 0) {
  if (depth >= MAX_DEPTH) return [];
  const out = [];
  for (const x of indirections(cmd)) {
    if (x.kind !== 'shell') continue;
    out.push(x.text, ...innerShellCommands(x.text, depth + 1));
  }
  return out;
}

export { MAX_DEPTH, SHELL };
