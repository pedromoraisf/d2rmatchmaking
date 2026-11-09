# CI Fast Path verification

**Verdict**: FAIL
**Mutations**: 3 - probed M1 (smoke deadline), M2-M4 (specs rule), M5 (changed-files filter); 5 run, 4 killed, 1 survived
**Proofs**: `proofs.md` at 9813225
**Verifier**: independent sub-agent (author != verifier)

## Mutations

| Mutation                                                | Location                            | Proof                                               | Outcome                                                                          |
| ------------------------------------------------------- | ----------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------- |
| smoke deadline `>=` to `>`                              | `scripts/ci/smoke-healthz.mjs`      | `node --test scripts/test/smoke-healthz.test.mjs`   | killed                                                                           |
| specs rule drops `cargo-mutants`                        | `scripts/lib/specs.mjs`             | `node --test scripts/test/specs.test.mjs`           | killed                                                                           |
| open box counted outside `Done when` (drop `inDone &&`) | `scripts/lib/specs.mjs`             | `node --test scripts/test/specs.test.mjs`           | SURVIVED                                                                         |
| done tasks refused too (drop `task.open &&`)            | `scripts/lib/specs.mjs`             | `node --test scripts/test/specs.test.mjs`           | killed                                                                           |
| changed filter leaks shared-kernel files                | `apps/api/scripts/mutation-plan.ts` | vitest `mutation-plan.test.ts` + `mutation.test.ts` | killed (`mutation-plan.test.ts` alone does not kill it; `mutation.test.ts` does) |

The proof wrapper hit its 3-attempt budget on `proofs`; no further runs were made.

## Examples nobody named

Not run (budget). Candidates: a `- [ ]` under `**What**` of an otherwise ticked task, and a gate with `pnpm test:mutation:agent`.

## Assertions looser than the criterion

- CFP-11/12: `specs.test.mjs` never places an unticked box outside `**Done when**`, so the "open" definition is not pinned to that section.
- CFP-03: `mutation-plan.test.ts` alone leaves the changed-set filter under-tested (unchanged files in a layer with a changed file are not asserted absent); only `mutation.test.ts` pins it. C3 runs both, so the check holds.

## Findings

| Finding                                                                                                                | Evidence                                                                        | Fix                                                                                                                               | Closed  |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Open-task detection is not limited to `Done when`: an unticked box elsewhere in a task marks it open and no test fails | mutation `inDone && /^\s*- \[ \]/` to `/^\s*- \[ \]/` survived `specs.test.mjs` | add a fixture with a ticked `Done when` and an unticked `- [ ]` in another section of a mutation-gated task, and assert it passes | 59913d6 |
| `mutation-plan.test.ts` does not assert unchanged files are excluded in a layer that has a changed file                | the shared-kernel leak was killed only by `mutation.test.ts`                    | in the `planLayer` changed-set test, include an unchanged shared-kernel file and assert it is absent                              | 97030db |
