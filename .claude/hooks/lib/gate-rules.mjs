// The gate's rules (ADR 029). Pure functions: no I/O except the `isTracked` callback the caller passes.
//
// The gate is small on purpose. It denies what cannot be undone or leaks a secret, asks for what AGENTS.md keeps as the
// maintainer's, and allows everything else. Quality is CI's job, not the gate's.

export const ENV_FILE = /(^|\/)\.env($|\.(?!example$)[^/]*$)/;
const VENDORED = /^\.claude\/skills\/tlc-spec-driven\//;
const MIGRATION = /^apps\/api\/(src\/)?.*migrations\/[^/]+\.(sql|ts)$/;
// Sensors and their thresholds: loosening one is the maintainer's (AGENTS.md rule 4), so every edit asks.
const SENSORS = [
  /^\.claude\/settings\.json$/,
  /^\.claude\/hooks\//,
  /^\.quality-baseline\.json$/,
  /^lefthook\.yml$/,
  /^\.dependency-cruiser\.cjs$/,
  /^eslint\.config\.mjs$/,
  /^\.gitleaks\.toml$/,
  /(^|\/)stryker\.config\.[cm]?[jt]s(on)?$/,
];

// A `.env` file named anywhere in a shell command; `.env.example` is fine.
const ENV_IN_SHELL = /(^|[\s'"=/<>(])\.env(\.(?!example\b)[\w.-]+)?(?=$|[\s'";|&)<>])/;
const PROD_DB = /neon\.tech|NEON_DATABASE_URL|DATABASE_URL_PROD|PROD(UCTION)?_DATABASE_URL|PGPASSWORD=/i;
const SKIP_HOOKS = /--no-verify\b|\bLEFTHOOK=0\b|\bHUSKY=0\b|\blefthook\s+uninstall\b/;
const SETTINGS_API =
  /\brepos\/[^/\s]+\/[^/\s]+(\/(rulesets|environments|actions\/(secrets|variables|permissions)|collaborators|hooks|keys|branches\/[^\s]+\/protection))?\b/;

const deny = (reason) => ({ decision: 'deny', reason });
const ask = (reason) => ({ decision: 'ask', reason });

/** Quoted text removed, so a commit message or a grep pattern does not read as a flag. */
const unquoted = (cmd) => cmd.replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, '""');

/** The simple commands of a line, split on `;`, `&&`, `||`, `|` and newlines (quotes already removed). */
const segments = (cmd) =>
  unquoted(cmd)
    .split(/\n|;|&&|\|\||\|/)
    .map((s) => s.trim())
    .filter(Boolean);

function pushDecision(seg) {
  const args = seg.split(/\s+/).slice(2);
  const forced = args.some(
    (a) =>
      /^(-f|--force(-with-lease)?(=.*)?|--force-if-includes|--mirror|--prune|--delete|-d)$/.test(a) ||
      /^-[a-z]*f/.test(a),
  );
  if (forced) return deny('Force pushes and remote deletions are never allowed (AGENTS.md rule 7).');
  const refspecs = args.filter((a) => !a.startsWith('-')).slice(1);
  if (refspecs.some((r) => r.startsWith('+') || r.startsWith(':')))
    return deny('A `+` or `:` refspec force-pushes or deletes a remote branch (AGENTS.md rule 7).');
  return null;
}

// `rm -r` of the filesystem root, the home directory, a parent directory or a bare glob.
const RM_TARGET = /^(\/|\/\*|~\/?|\$HOME\/?|\$\{HOME\}\/?|\.\.(\/.*)?|\*)$/;

function rmDecision(seg) {
  const args = seg.split(/\s+/).slice(1);
  const recursive = args.some((a) => /^-[a-zA-Z]*[rR]/.test(a) || a === '--recursive');
  if (recursive && args.some((a) => !a.startsWith('-') && RM_TARGET.test(a)))
    return deny(
      'Recursive removal of the root, the home directory, a parent directory or a bare glob is never allowed.',
    );
  return null;
}

/** @returns {{decision: 'deny'|'ask', reason: string} | null} null = allow */
export function decideBash(command) {
  const cmd = String(command ?? '');
  if (ENV_IN_SHELL.test(cmd))
    return deny('`.env` files are never read, printed or written (AGENTS.md rule 6). Use `.env.example`.');
  if (PROD_DB.test(cmd)) return deny("The production database is the maintainer's (AGENTS.md rule 6).");
  for (const seg of segments(cmd)) {
    if (SKIP_HOOKS.test(seg))
      return deny('Local sensors are never bypassed (AGENTS.md rule 4). Fix what they report.');
    if (/^(sudo\s+)?rm\b/.test(seg)) {
      const d = rmDecision(seg);
      if (d) return d;
    }
    if (/^git\s+push\b/.test(seg)) {
      const d = pushDecision(seg);
      if (d) return d;
    }
    if (/^gh\s+repo\s+(delete|archive|rename|edit)\b/.test(seg))
      return deny("Repository settings and deletion are the maintainer's (AGENTS.md rule 7).");
    if (/^gh\s+(release|run|cache)\s+delete\b/.test(seg) || /^git\s+tag\s+(-d|--delete)\b/.test(seg))
      return deny('Remote deletions are never allowed (AGENTS.md rule 7).');
    if (
      /^gh\s+secret\b/.test(seg) ||
      /^gh\s+variable\s+(set|delete)\b/.test(seg) ||
      /\bwrangler\s+(pages\s+)?secret\b/.test(seg)
    )
      return ask("Secrets and variables are the maintainer's (AGENTS.md rule 7).");
    if (/^gh\s+api\b/.test(seg)) {
      const method = /(?:-X|--method)\s*=?\s*([A-Za-z]+)/.exec(seg)?.[1]?.toUpperCase();
      if (method === 'DELETE') return deny('Remote deletions are never allowed (AGENTS.md rule 7).');
      const writes =
        (method && method !== 'GET') || /\s(-f|-F|--field|--raw-field|--input)\s/.test(` ${seg} `);
      if (
        writes &&
        SETTINGS_API.test(seg) &&
        !/\/(pulls|issues|releases|actions\/(runs|workflows)|git\/refs)\b/.test(seg)
      )
        return ask(
          "Repository settings, rulesets, environments and secrets are the maintainer's (AGENTS.md rule 7).",
        );
    }
  }
  return null;
}

/**
 * @param {string} rel  repository-relative path, forward slashes
 * @param {{ write: boolean, isTracked: (rel: string) => boolean }} opts
 */
export function decidePath(rel, { write, isTracked }) {
  if (ENV_FILE.test(rel))
    return deny('`.env` files are never read or written (AGENTS.md rule 6). Use `.env.example`.');
  if (!write) return null;
  if (VENDORED.test(rel))
    return deny(
      'tlc-spec-driven is vendored and stays unmodified. Project behaviour goes in .claude/skills/d2rmm-phase-runner.',
    );
  if (MIGRATION.test(rel) && isTracked(rel))
    return deny(
      'This migration is already committed. Add a new migration instead of editing an applied one.',
    );
  if (SENSORS.some((re) => re.test(rel)))
    return ask("Sensors and their thresholds are the maintainer's (AGENTS.md rule 4).");
  return null;
}

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

/** @returns {{decision: 'deny'|'ask', reason: string} | null} */
export function decide(input, { toRelative, isTracked }) {
  const tool = input.tool_name;
  const ti = input.tool_input ?? {};
  if (tool === 'Bash') return decideBash(ti.command);
  if (tool === 'Read' || EDIT_TOOLS.has(tool)) {
    const rel = toRelative(ti.file_path ?? ti.notebook_path ?? '');
    if (!rel || rel.startsWith('../')) return null;
    return decidePath(rel, { write: EDIT_TOOLS.has(tool), isTracked });
  }
  return null;
}
