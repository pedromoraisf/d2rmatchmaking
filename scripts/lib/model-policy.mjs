// Model policy (ADR 025): who does what, on which model, at which effort.
//
//   orchestrator  — the main Claude Code session: Opus 5.5 at medium effort (Sonnet allowed). It plans
//                   (Specify, Design, Tasks), runs the gates, integrates and reviews. It never writes feature code.
//   implementer   — `feature-worker` subagents on Haiku: execute TLC task batches in their own worktrees.
//   judges        — reviewers and the Verifier on Sonnet: independent judgment by a different model than the author.
//
// The gate hook enforces the dispatch side (which subagent for which step, no model/effort overrides);
// .claude/settings.json pins the orchestrator; the agents' frontmatter pins each subagent.

export const ORCHESTRATOR = {
  model: 'claude-opus-5-5',
  effort: 'medium',
  alternatives: ['sonnet', 'claude-sonnet-5-5'],
};

/** subagent type → pinned model and effort (must match the frontmatter in .claude/agents/<type>.md). */
export const SUBAGENTS = {
  'feature-worker': { model: 'haiku', effort: 'medium', role: 'implementer' },
  verifier: { model: 'sonnet', effort: 'medium', role: 'judge' },
  'spec-reviewer': { model: 'sonnet', effort: 'medium', role: 'judge' },
  'architecture-reviewer': { model: 'sonnet', effort: 'medium', role: 'judge' },
  'security-reviewer': { model: 'sonnet', effort: 'medium', role: 'judge' },
};

/** Read-only helpers the orchestrator may use for searching; they never write and are not budgeted. */
export const READ_ONLY_HELPERS = ['Explore'];

/** Dispatch step → subagent types allowed for it. Planning steps are not dispatchable: the orchestrator does them. */
export const STEP_AGENTS = [
  [/^execute-batch-[1-9]$/, ['feature-worker']],
  [/^verify(-r2)?$/, ['verifier']],
  [/^screens$/, ['verifier']],
  [/^review-spec$/, ['spec-reviewer']],
  [/^review-architecture$/, ['architecture-reviewer']],
  [/^review-security$/, ['security-reviewer']],
  [/^review-diff$/, ['architecture-reviewer', 'security-reviewer']],
];

export const DISPATCH_STEP_RE =
  /^(execute-batch-[1-9]|verify|verify-r2|screens|review-spec|review-architecture|review-security|review-diff)$/;

/** @returns {string|null} a denial reason, or null when the dispatch follows the policy. */
export function checkDispatchPolicy(step, input) {
  const type = input?.subagent_type ?? 'general-purpose';
  if (READ_ONLY_HELPERS.includes(type)) return null;
  const allowed = STEP_AGENTS.find(([re]) => re.test(step))?.[1];
  if (!allowed) {
    return `Step "${step}" is not dispatchable: Specify, Design and Tasks are done by the orchestrator itself (ADR 025).`;
  }
  if (!allowed.includes(type)) {
    return `Step "${step}" must be dispatched to ${allowed.join(' or ')} (got "${type}"). Implementation runs on feature-worker (Haiku); judgment on the Sonnet reviewers/Verifier (ADR 025).`;
  }
  if (input?.model !== undefined && input.model !== SUBAGENTS[type].model) {
    return `Do not override the model of ${type}: it is pinned to ${SUBAGENTS[type].model} (ADR 025). Changing it is a maintainer decision.`;
  }
  if (input?.effort !== undefined && input.effort !== SUBAGENTS[type].effort) {
    return `Do not override the effort of ${type}: it is pinned to ${SUBAGENTS[type].effort} (ADR 025).`;
  }
  return null;
}

/** Parse `model:` and `effort:` from an agent file's frontmatter (used by the consistency test). */
export function frontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---/.exec(String(text ?? ''));
  const out = {};
  for (const line of (m?.[1] ?? '').split('\n')) {
    const kv = /^([a-z]+):\s*(.+)$/.exec(line.trim());
    if (kv) out[kv[1]] = kv[2].trim();
  }
  return out;
}
