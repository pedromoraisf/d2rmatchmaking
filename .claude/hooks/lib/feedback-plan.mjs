// Decides which fast sensors run after the agent edits a file (PostToolUse).
// Pure: returns a list of steps; feedback.mjs executes them. Tested in feedback-plan.test.mjs.

const JS = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const FORMATTABLE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|json|md|ya?ml|css|html)$/; // .feature is checked, not reformatted
const IN_WORKSPACE = /^(apps|packages|tests)\/[^/]+\//;
const NOT_FORMATTED =
  /^(\.claude\/skills\/tlc-spec-driven\/|docs\/product\/prd\.md$|docs\/architecture\/design-doc\.md$|pnpm-lock\.yaml$)/;

/**
 * @param {string} rel repo-relative path
 * @param {(name: string) => boolean} has  whether a local binary/tool is available
 * @returns {{ id: string, cmd: string, args: string[], fix?: boolean, timeoutMs?: number }[]}
 */
export function planFeedback(rel, has) {
  const steps = [];
  if (!rel || rel.startsWith('..')) return steps;

  if (FORMATTABLE.test(rel) && !NOT_FORMATTED.test(rel) && has('prettier')) {
    steps.push({ id: 'prettier', cmd: 'prettier', args: ['--write', '--log-level', 'warn', rel], fix: true });
  }
  if (JS.test(rel) && !NOT_FORMATTED.test(rel) && has('eslint')) {
    steps.push({ id: 'eslint', cmd: 'eslint', args: ['--max-warnings', '0', '--no-warn-ignored', rel] });
  }
  if (JS.test(rel) && IN_WORKSPACE.test(rel) && has('depcruise')) {
    steps.push({
      id: 'dependency-cruiser',
      cmd: 'depcruise',
      args: ['--config', '.dependency-cruiser.cjs', rel],
    });
  }
  if (/\.(ts|tsx)$/.test(rel) && IN_WORKSPACE.test(rel) && has('vitest')) {
    steps.push({
      id: 'vitest-related',
      cmd: 'vitest',
      args: ['related', '--run', '--passWithNoTests', rel],
      timeoutMs: 180_000,
    });
  }
  if (/^(scripts|\.claude\/hooks)\/.*\.mjs$/.test(rel)) {
    const test = rel.endsWith('.test.mjs') ? rel : null;
    steps.push({
      id: 'harness-tests',
      cmd: 'node',
      args: ['--test', ...(test ? [test] : ['scripts/**/*.test.mjs', '.claude/hooks/**/*.test.mjs'])],
    });
  }
  if (rel.endsWith('.rs') && has('rustfmt')) {
    steps.push({ id: 'rustfmt', cmd: 'rustfmt', args: ['--edition', '2024', rel], fix: true });
  }
  const spec = /^\.specs\/features\/([^/]+)\/(spec|tasks)\.md$/.exec(rel);
  if (spec && has('python3')) {
    const script = spec[2] === 'spec' ? 'validate_spec.py' : 'validate_tasks.py';
    steps.push({
      id: script,
      cmd: 'python3',
      args: [`.claude/skills/tlc-spec-driven/scripts/${script}`, spec[1]],
    });
  }
  const acc = /^\.specs\/features\/([^/]+)\/(spec\.md|acceptance\.feature)$/.exec(rel);
  if (acc) {
    steps.push({ id: 'acceptance-check', cmd: 'node', args: ['scripts/acceptance-check.mjs', acc[1]] });
  }
  if (/^\.specs\//.test(rel)) {
    steps.push({ id: 'specs-check', cmd: 'node', args: ['scripts/specs-check.mjs'] });
  }
  return steps;
}

/** Reminders that do not block (added as context for the agent). */
export function reminders(rel) {
  const out = [];
  if (
    /^packages\/contracts\/src\//.test(rel) ||
    /^apps\/api\/src\/modules\/[^/]+\/adapters\/http\//.test(rel)
  ) {
    out.push(
      'Contract or route changed: run `pnpm contracts:openapi` and commit openapi.json/asyncapi.json (ADR 020). The Stop hook checks drift.',
    );
  }
  if (/^apps\/api\/(src\/)?.*migrations\//.test(rel)) {
    out.push(
      'New migration: it must be backward compatible with the running version (expand → migrate → contract).',
    );
  }
  if (/^apps\/agent\/src-tauri\//.test(rel)) {
    out.push(
      'Agent code: read-only pixels and OS signals only. No memory reads, injection, network interception or in-game confirmation (ADR 010).',
    );
  }
  return out;
}
