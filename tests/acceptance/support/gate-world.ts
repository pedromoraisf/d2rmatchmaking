// The state the gate steps share within one scenario: the temporary repository the hooks and the attempt wrapper run in,
// the last decision the gate gave, and the temporary directories to remove afterwards. harness-bootstrap.steps.ts and
// budget-v2.steps.ts both read and write it, so a step text is defined once and reused (playwright-bdd refuses duplicates).
import type { Scenario } from '../fixtures.ts';

/** The gate's answer to one PreToolUse call: the decision it gives (none when it prints nothing) and its reason. */
export interface GateAnswer {
  decision: string | undefined;
  reason: string;
}

export interface GateWorld {
  /** The temporary repository (or directory) the hooks and the wrapper run in. */
  repo: string | undefined;
  /** The last decision the gate gave in this scenario. */
  answer: GateAnswer | undefined;
  /** Directories this scenario created; the After hook of harness-bootstrap removes them. */
  temporary: string[];
}

const KEY = 'gate-world';

/** The gate world of the scenario that owns `scenario`. Created on first use. */
export function gateWorldOf(scenario: Scenario): GateWorld {
  const stored = scenario.values.get(KEY);
  if (stored !== undefined) return stored as GateWorld;
  const created: GateWorld = { repo: undefined, answer: undefined, temporary: [] };
  scenario.values.set(KEY, created);
  return created;
}

/** The repository the gate runs in; a step that needs one throws when no repository is set up. */
export function requireGateRepo(world: GateWorld): string {
  if (world.repo === undefined) throw new Error('no temporary repository is set up in this scenario');
  return world.repo;
}

/** The gate's answer to a call, as the hook printed it: empty output means no decision. */
export function answerOf(text: string): GateAnswer {
  if (text === '') return { decision: undefined, reason: '' };
  const output =
    (JSON.parse(text) as { hookSpecificOutput?: Record<string, unknown> }).hookSpecificOutput ?? {};
  const decision = output['permissionDecision'];
  const reason = output['permissionDecisionReason'];
  return {
    decision: typeof decision === 'string' ? decision : undefined,
    reason: typeof reason === 'string' ? reason : '',
  };
}
