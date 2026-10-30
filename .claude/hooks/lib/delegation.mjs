// Reads the active phase brief: which phase is running and what the user delegated at kickoff.
// The brief is the ONLY place where a human approval for the whole phase lives (ADR 021).
export const DELEGATION_SCOPES = [
  'specs-and-tasks',
  'sub-agents',
  'harness-edits',
  'local-merge-phase-branch',
];

const APPROVED_RE = /^\**\s*Approved\s*\**\s*:\s*\**\s*(\d{4}-\d{2}-\d{2})\b.*?\buser\s*:\s*["“]([^"”]*\S[^"”]*)["”]/i;

export function parseApproval(line) {
  const m = APPROVED_RE.exec(line.trim());
  return m ? { date: m[1], words: m[2] } : null;
}

export function approvalsIn(text) {
  if (!text) return [];
  let fence = false;
  const out = [];
  // HTML comments hold examples (templates) and never count as approvals.
  const visible = text.replace(/<!--[\s\S]*?-->/g, '');
  for (const line of visible.split('\n')) {
    if (line.trim().startsWith('```')) {
      fence = !fence;
      continue;
    }
    if (fence) continue;
    const a = parseApproval(line);
    if (a) out.push({ ...a, line: line.trim() });
  }
  return out;
}

/** Parse "- [x] scope-name: ..." lines under "## Delegation". */
export function delegatedScopes(briefText) {
  const scopes = new Set();
  if (!briefText) return scopes;
  const section = briefText.split(/^## /m).find((s) => s.toLowerCase().startsWith('delegation'));
  if (!section) return scopes;
  for (const line of section.split('\n')) {
    const m = /^\s*[-*]\s*\[(x|X)\]\s*`?([a-z0-9-]+)`?/.exec(line);
    if (m && DELEGATION_SCOPES.includes(m[2])) scopes.add(m[2]);
  }
  return scopes;
}

/**
 * The active phase: `.specs/phases/ACTIVE` holds the phase id (e.g. "F0").
 * Returns null when no phase is active or its brief is not approved by the user.
 */
export function activePhase(ctx) {
  const id = (ctx.readFile('.specs/phases/ACTIVE') ?? '').trim();
  if (!/^F\d+$/.test(id)) return null;
  const briefPath = `.specs/phases/${id}/brief.md`;
  const brief = ctx.readFile(briefPath);
  const approvals = approvalsIn(brief);
  if (approvals.length === 0) return { id, briefPath, approved: false, scopes: new Set(), approvals };
  return { id, briefPath, approved: true, scopes: delegatedScopes(brief), approvals };
}
