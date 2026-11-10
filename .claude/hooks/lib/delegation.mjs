// Reads the active phase brief: which phase is running and what the user delegated at kickoff.
// The brief is the ONLY place where a human approval for the whole phase lives (ADR 021).
export const DELEGATION_SCOPES = [
  'specs-and-tasks',
  'sub-agents',
  'harness-edits',
  'local-merge-phase-branch',
  'harness-self', // ADR 028 § 3: the named features edit the gate in their own worktree, under the guard
];

const APPROVED_RE =
  /^\**\s*Approved\s*\**\s*:\s*\**\s*(\d{4}-\d{2}-\d{2})\b.*?\buser\s*:\s*["“]([^"”]*\S[^"”]*)["”]/i;

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

/** The text of a `## <name>` section of a brief (matched by its first word, case-insensitive), or null. */
function sectionOf(briefText, name) {
  if (!briefText) return null;
  return briefText.split(/^## /m).find((s) => s.toLowerCase().startsWith(name)) ?? null;
}

/** The feature names of the `## Features` table: first cells of its rows, without backticks. */
export function featureRows(briefText) {
  const rows = new Set();
  for (const line of (sectionOf(briefText, 'features') ?? '').split('\n')) {
    const m = /^\s*\|([^|]+)\|/.exec(line);
    if (!m) continue;
    const name = m[1].trim().replace(/^`|`$/g, '');
    if (/^[a-z0-9][a-z0-9-]*$/.test(name)) rows.add(name); // the header ("Feature") and separators are not names
  }
  return rows;
}

/**
 * HBS-19: the features a ticked `harness-self` line covers. Only backticked names that are rows of `## Features`
 * count (a backticked path is not one); an unticked line, or a brief with no approval line, covers nothing.
 */
export function coveredFeatures(briefText) {
  if (approvalsIn(briefText).length === 0) return [];
  const line = (sectionOf(briefText, 'delegation') ?? '')
    .split('\n')
    .find((l) => /^\s*[-*]\s*\[(x|X)\]\s*`?harness-self`?(?![\w-])/.test(l));
  if (!line) return [];
  const rows = featureRows(briefText);
  const names = [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  return [...new Set(names.filter((n) => rows.has(n)))];
}

/**
 * The active phase: `.specs/phases/ACTIVE` holds the phase id (e.g. "F0").
 * The phase and its brief are read from the MAIN checkout when the context can (HBS-19): a worktree's own copy of
 * the brief never widens the delegation. Returns null when no phase is active.
 * `approved` is false when the brief carries no user approval line; `covered` lists the covered features (HBS-19).
 */
export function activePhase(ctx) {
  const read = ctx.readMainFile ?? ctx.readFile;
  const id = (read('.specs/phases/ACTIVE') ?? '').trim();
  if (!/^F\d+$/.test(id)) return null;
  const briefPath = `.specs/phases/${id}/brief.md`;
  const brief = read(briefPath);
  const approvals = approvalsIn(brief);
  const covered = coveredFeatures(brief);
  if (approvals.length === 0) {
    return { id, briefPath, approved: false, scopes: new Set(), approvals, covered };
  }
  return { id, briefPath, approved: true, scopes: delegatedScopes(brief), approvals, covered };
}
