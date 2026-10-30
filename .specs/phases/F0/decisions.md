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

| Feature / task | Gate | Attempts | Last error | Options |
| -------------- | ---- | -------- | ---------- | ------- |

## Escalations raised

| When | What | Answer |
| ---- | ---- | ------ |
