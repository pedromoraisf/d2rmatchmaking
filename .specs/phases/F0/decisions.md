# Phase F0 — decisions queue

Everything the runner decided on its own during the phase. The maintainer confirms or reverses each item in the phase
review. Reversals become tasks in a follow-up feature.

## Assumed decisions

| AD     | Feature            | Decision                                                                                | Reversal cost           | Maintainer |
| ------ | ------------------ | --------------------------------------------------------------------------------------- | ----------------------- | ---------- |
| AD-026 | harness-foundation | `apps/agent` is the TS UI workspace only; the Rust crate comes with agent-skeleton      | add the crate earlier   |            |
| AD-027 | harness-foundation | Shared kernel written here; domain mutation covers `modules/*/domain` + `shared-kernel` | narrow the Stryker glob |            |
| AD-028 | harness-foundation | release-please config + manifest only; workflow in agent-skeleton                       | move the workflow       |            |

## Blocked

| Feature / task                      | Gate                       | Attempts                                                                                                                                          | Last error                                                                                                  | Options                                                                                                                                                                                                            |
| ----------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| harness-foundation / spec amendment | dispatch `review-spec`     | 3 dispatches (1 FAIL, 1 PASS, 1 from an earlier session)                                                                                          | Fourth review needed for the HF-07 vs HF-09 contradiction; gate refuses the dispatch and blocks the feature | (a) reset `dispatch:harness-foundation/review-spec` and let the runner re-review; (b) maintainer approves the amended spec in their own words; (c) revert the amendment and drop HF-09's empty-report path instead |
| harness-foundation / T4–T7          | dispatch `execute-batch-1` | 3 dispatches (attempt 1 stopped at T1 on an invocation error; retry 1 T1 gate passed, commit refused by plan order; retry 2 committed T3, T1, T2) | Fourth dispatch for T4–T7 after the T2→T4 arch-check replan; gate refuses it and blocks the feature         | (a) reset `dispatch:harness-foundation/execute-batch-1` and let the runner continue T4–T7; (b) maintainer decides another route                                                                                    |

## Escalations raised

| When       | What                                                                                                                          | Answer                                                                                                                                                                                              |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-30 | harness-foundation blocked by the retry budget on `review-spec`; every other F0 feature depends on it (`phaseBlocked: true`)  | maintainer: "I approve the amendment" (2026-10-30). The gate refuses a direct approval line in spec.md during a phase run, and the ledger still blocks the feature; a reset is required to continue |
| 2026-10-30 | harness-foundation blocked by the retry budget on `execute-batch-1` (T4–T7 not started); every other F0 feature depends on it | maintainer reset `dispatch:harness-foundation/execute-batch-1` (2026-10-30, by pedromoraisf); runner continues T4–T7                                                                                |
