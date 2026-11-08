# budget-v2 proofs

**HEAD**: a97390d
**Tree**: clean
**Result**: 19 pass, 0 fail; mutations 6 killed, 0 not

| Check | Proof                                                                                                            | Ran            | Passed                                          | Result                             |
| ----- | ---------------------------------------------------------------------------------------------------------------- | -------------- | ----------------------------------------------- | ---------------------------------- |
| C1    | `node --test scripts/test/env-signatures.test.mjs`                                                               | count unknown  | -                                               | pass                               |
| C2    | `node --test scripts/test/budget.test.mjs`                                                                       | count unknown  | -                                               | pass                               |
| C3    | `node --test --test-name-pattern "Docker failure                                                                 | killed command | stops a command at its timeout                  | bad timeout                        | time` | count unknown | -   | pass |
| C4    | `node --test --test-name-pattern "rerun                                                                          | empty commit   | runs after a change                             | runs again after a machine failure | wit`  | count unknown | -   | pass |
| C5    | `node --test --test-name-pattern "full output" scripts/test/attempt-cli.test.mjs`                                | count unknown  | -                                               | pass                               |
| C6    | `node --test --test-name-pattern "reset                                                                          | needs a reason | unit option" scripts/test/attempt-cli.test.mjs` | count unknown                      | -     | pass          |
| C7    | `node --test .claude/hooks/test/budget-rules.test.mjs`                                                           | count unknown  | -                                               | pass                               |
| C8    | `node --test --test-name-pattern "red stop" .claude/hooks/test/budget-rules.test.mjs`                            | count unknown  | -                                               | pass                               |
| C9    | `node --test scripts/test/retry-budget-docs.test.mjs`                                                            | count unknown  | -                                               | pass                               |
| C10   | `pnpm exec turbo run test:acceptance -- --grep @BUD-`                                                            | 55             | -                                               | pass                               |
| C11   | `pnpm test:harness`                                                                                              | 1              | -                                               | pass                               |
| C12   | `pnpm contracts:check`                                                                                           | count unknown  | -                                               | pass                               |
| C13   | `node --test --test-name-pattern "isUnchangedRerun" scripts/test/budget.test.mjs`                                | count unknown  | -                                               | pass                               |
| C14   | `node --test --test-name-pattern "hidden behind another wrapper call" .claude/hooks/test/budget-rules.test.mjs`  | count unknown  | -                                               | pass                               |
| C15   | `node --test --test-name-pattern "2>&1" .claude/hooks/test/budget-rules.test.mjs`                                | count unknown  | -                                               | pass                               |
| C16   | `node --test --test-name-pattern "a covered branch not started touches nothing" .claude/hooks/test/guard.test.m` | count unknown  | -                                               | pass                               |
| Build | `pnpm lint`                                                                                                      | -              | -                                               | pass                               |
| Build | `pnpm typecheck`                                                                                                 | -              | -                                               | pass                               |
| Build | `pnpm test:harness`                                                                                              | -              | -                                               | pass                               |

## Mutations

| Mutation                                                   | Location                                 | Killed |
| ---------------------------------------------------------- | ---------------------------------------- | ------ |
| unchanged rerun ignores the command                        | `scripts/lib/budget.mjs:173`             | yes    |
| env-blocked needs four instead of three                    | `scripts/lib/budget.mjs:150`             | yes    |
| a test-failure marker no longer wins over a signature      | `scripts/lib/env-signatures.mjs:63`      | yes    |
| gate allows a second orchestrator reset                    | `.claude/hooks/lib/budget-rules.mjs:87`  | yes    |
| red stop uncounted when only some failures are the machine | `.claude/hooks/lib/budget-rules.mjs:343` | yes    |
| wrapper allows a second orchestrator reset                 | `scripts/attempt.mjs:249`                | yes    |
