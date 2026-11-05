# Site Stale Read Fix verification

**Verdict**: FAIL in the Verifier's round 1; its one finding is closed by `dfd558b`, and round 2 is `check_proofs.py --mutations`
**Mutations**: 3 - probed SSR-01 counter, SSR-01 apply-when-overtaken, SSR-05 404 clear
**Proofs**: `proofs.md` at 189d3e6
**Verifier**: independent sub-agent (author != verifier)

## Findings

| Finding                                                                                                                                  | Evidence                                                                                                                                                                                                                                                                                                              | Fix                                                                                                                                                                                                                                      | Closed    |
| ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| C10 (`@SSR-03` acceptance scenario) is not stable: it passed in `proofs.md` and failed in the `--mutations` run at the same HEAD 189d3e6 | `check_proofs.py ... --mutations` reported `16 pass, 1 fail` with `C10: fail - pnpm exec turbo run test:acceptance -- --grep @SSR-03`; the untouched tree passed it before. The Verifier could not rerun it alone: its shell gate denied the command 3 times (retry budget exhausted), so the cause is not diagnosed. | Find why the `@SSR-03` scenario or its step ("the site read the room exactly once after its stream opened", the route's read count) depends on timing, and make it deterministic without retries or a longer timeout (ADR 022, ADR 023). | `dfd558b` |

Mutations (all killed, `3 killed, 0 not`):

- `streamEvents.current += 1` to `+= 0` - killed by `ignores a read that answers after a stream event`.
- `if (!overtaken) {` to `if (true) {` - killed by the same test.
- `room.failure === 'not-found' ? null : current.room` to `current.room` - killed by `clears the room when a read answers no room and no stream event arrived`.

Not done: own examples (no value outside the spec's cases was tried) because the shell gate budget ran out after the mutation run.

## Orchestrator's note on the finding

Written by the orchestrator, not the Verifier.

- **The failure's cause is not proven.** Its report was overwritten by later proofs, and 12 of 12 repeats of `@SSR-03` passed at `189d3e6`, before the fix.
- **`dfd558b` removes two timing dependencies found by reading the steps.** A read of the previous page could enter the read count, and the agent's `POST` can answer before the relay publishes, because `relay.wake()` is not awaited.
- **Repeats after the fix:** 24 of 24 `@SSR-*` runs passed at `dfd558b` with the default 4 workers. A run with `--workers=8` finished 11 of 40, with stacks that did not start and 60 s timeouts. That starved the machine and says nothing about the scenarios.
- **Open:** the own examples stay undone, and the phase review lists them.
