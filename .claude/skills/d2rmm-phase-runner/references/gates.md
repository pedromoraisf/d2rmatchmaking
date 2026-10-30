# Automatic gates, defaults and budgets

Every gate is a command with an exit code or a reviewer verdict line. "I checked it" is not a gate.

## Spec gate

| # | Gate | Pass condition |
| --- | --- | --- |
| 1 | `python3 .claude/skills/tlc-spec-driven/scripts/validate_spec.py <feature>` | exit 0 |
| 2 | Traceability (below) | every requirement sourced; every FR/NFR assigned by the brief covered |
| 3 | `node scripts/acceptance-check.mjs <feature>` | exit 0: every requirement has an English Gherkin scenario tagged with its ID (ADR 023) |
| 4 | `spec-reviewer` subagent (dispatch step `review-spec`) | last line `VERDICT: PASS` |

## Design gate (Large/Complex)

`architecture-reviewer` → `VERDICT: PASS`; `security-reviewer` → `VERDICT: PASS` when the feature touches auth/session,
the desktop agent, tokens/secrets, file uploads (dispute prints), CORS/cookies/proxy, or anything reachable from the
internet without auth.

## Tasks gate

Every `## Checks` claim for a requirement with scenarios uses the scenarios as its proof:
`**Proof**: \`pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep @<REQ-ID>\``.
Scenario steps are implemented in the task that delivers the behaviour (missing steps fail generation).

`validate_tasks.py <feature>` exit 0 → write the delegated approval → `validate_tasks.py <feature> --execute` exit 0.
`**Mutations**:` at least 3; at least 5 for features with domain rules (ranking, ready check, room state machine).

## Per-task gate

The task's `Gate` command (TLC), run as `node scripts/attempt.mjs run --feature <f> --step T<n> -- "<gate>"`,
+ the hooks (feedback on edit, Stop hook) + `check_commit.py` on the message. The commit is refused unless that gate
passed after the previous commit.

## Feature done

`check_proofs.py` → Verifier → fixes → `check_proofs.py --mutations` → `validate_verification.py` exit 0.

## Integration gate (feature branch → `phase/<F>`)

```sh
pnpm check                                        # format, lint, types, depcruise, tests, specs, harness L4, ratchet
pnpm contracts:check                              # OpenAPI/AsyncAPI drift
pnpm quality:collect && pnpm quality:ratchet --context pr
```

## Traceability

- `spec.md ## Sources` lists the PRD/Design Doc/ADR anchors used (`docs/product/prd.md#FR-14`, `ADR 017`).
- Each requirement ID in the spec maps to at least one source; each FR/NFR the brief assigns to the feature appears in
  at least one requirement. The `spec-reviewer` checks this table explicitly.
- A requirement with no source is either removed or becomes an assumed decision (AD-NNN).

## Conservative defaults

When a gray area is a product decision the docs do not settle, choose the option that:

1. **adds no user-visible commitment** the PRD does not already make (hide/disable rather than invent behaviour);
2. **is reversible** without a data migration (config flag, constant in one place, feature hidden);
3. **is stricter on safety/fairness** (e.g. fewer agent capabilities, shorter retention, no ranking impact on doubt);
4. **is the smallest scope** that still meets the exit criteria.

If no option satisfies 1 and 2, it is not a conservative default — escalate.

Record it in `.specs/STATE.md` (TLC format, plus the `(assumed)` marker on the heading):

```markdown
### AD-0NN (assumed)
- **Decision**: <the conservative default, one sentence>
- **Reason**: <feature, requirement, why the docs do not settle it; why this default is conservative>
- **Trade-off**: <what the maintainer gives up if it stands; reversal cost>
- **Scope**: <feature / module>
- **Date**: YYYY-MM-DD
- **Status**: active (pending phase review: .specs/phases/<F>/decisions.md)
```

Numbering: AD-001…AD-024 mirror ADR 001…024. New decisions continue from AD-025; if one becomes an ADR, it keeps its number.

## Budgets

**Retry budget (fixed, not overridable by a brief): 1 attempt + 2 retries per unit** — gates, subagent dispatches,
red stops, repeated sensor failures and repeated denials. Enforced by code; full rules in
[`retry-budget.md`](retry-budget.md) (ADR 022).

| Budget | Limit | On exhaustion |
| --- | --- | --- |
| Gate attempts per `gate:<feature>/<step>` | 1 + 2 retries (cumulative) | unit + feature **blocked**; `attempt.mjs` exits 3 and never runs the 4th attempt |
| Dispatches per `dispatch:<feature>/<step>` (reviewers included) | 1 + 2 retries | 4th dispatch refused; feature blocked |
| Red stops per agent session | 2 forced continuations | session exhausted: record the blocker and report |
| Same sensor failing on the same file | 1 + 2 retries (consecutive) | session exhausted |
| Same gate-hook denial | 1 + 2 retries | session exhausted |
| Wall-clock per feature (Large / Complex) | 6 h / 10 h of agent time (the brief may lower it) | feature blocked |
| Verifier rounds | 2 (TLC: `verify`, `verify-r2`) | what still fails goes to the review |

The runner then continues with features that do not depend on the blocked one.
