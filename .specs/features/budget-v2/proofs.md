# budget-v2 proofs

**HEAD**: 360f81f
**Tree**: clean
**Result**: 21 pass, 0 fail; mutations 12 killed, 0 not

| Check | Proof                                                                                                            | Ran           | Passed | Result |
| ----- | ---------------------------------------------------------------------------------------------------------------- | ------------- | ------ | ------ |
| C1    | `node --test scripts/test/env-signatures.test.mjs`                                                               | count unknown | -      | pass   |
| C2    | `node --test scripts/test/budget.test.mjs`                                                                       | count unknown | -      | pass   |
| C3    | `node --test --test-name-pattern "Docker failure" --test-name-pattern "killed command" --test-name-pattern "sto` | count unknown | -      | pass   |
| C4    | `node --test --test-name-pattern "rerun" --test-name-pattern "empty commit" --test-name-pattern "runs after a c` | count unknown | -      | pass   |
| C5    | `node --test --test-name-pattern "full output" scripts/test/attempt-cli.test.mjs`                                | count unknown | -      | pass   |
| C6    | `node --test --test-name-pattern "reset" --test-name-pattern "needs a reason" --test-name-pattern "unit option"` | count unknown | -      | pass   |
| C7    | `node --test .claude/hooks/test/budget-rules.test.mjs`                                                           | count unknown | -      | pass   |
| C8    | `node --test --test-name-pattern "red stop" .claude/hooks/test/budget-rules.test.mjs`                            | count unknown | -      | pass   |
| C9    | `node --test scripts/test/retry-budget-docs.test.mjs`                                                            | count unknown | -      | pass   |
| C10   | `pnpm exec turbo run test:acceptance -- --grep @BUD-`                                                            | 55            | -      | pass   |
| C11   | `pnpm test:harness`                                                                                              | 1             | -      | pass   |
| C12   | `pnpm contracts:check`                                                                                           | count unknown | -      | pass   |
| C13   | `node --test --test-name-pattern "isUnchangedRerun" scripts/test/budget.test.mjs`                                | count unknown | -      | pass   |
| C14   | `node --test --test-name-pattern "hidden behind another wrapper call" .claude/hooks/test/budget-rules.test.mjs`  | count unknown | -      | pass   |
| C15   | `node --test --test-name-pattern "2>&1" .claude/hooks/test/budget-rules.test.mjs`                                | count unknown | -      | pass   |
| C16   | `node --test --test-name-pattern "a covered branch not started touches nothing" .claude/hooks/test/guard.test.m` | count unknown | -      | pass   |
| C17   | `node --test --test-name-pattern "exists only on the remote" --test-name-pattern "git cannot answer" --test-nam` | count unknown | -      | pass   |
| C18   | `node --test --test-name-pattern "however the wrapper is spelled" .claude/hooks/test/budget-rules.test.mjs`      | count unknown | -      | pass   |
| Build | `pnpm lint`                                                                                                      | -             | -      | pass   |
| Build | `pnpm typecheck`                                                                                                 | -             | -      | pass   |
| Build | `pnpm test:harness`                                                                                              | -             | -      | pass   |

## Mutations

| Mutation                                                                                                                                           | Location                                 | Killed |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ------ |
| unchanged rerun ignores the command                                                                                                                | `scripts/lib/budget.mjs:173`             | yes    |
| env-blocked needs four instead of three                                                                                                            | `scripts/lib/budget.mjs:150`             | yes    |
| a test-failure marker no longer wins over a signature                                                                                              | `scripts/lib/env-signatures.mjs:63`      | yes    |
| gate allows a second orchestrator reset                                                                                                            | `.claude/hooks/lib/budget-rules.mjs:88`  | yes    |
| red stop uncounted when only some failures are the machine                                                                                         | `.claude/hooks/lib/budget-rules.mjs:344` | yes    |
| wrapper allows a second orchestrator reset                                                                                                         | `scripts/attempt.mjs:249`                | yes    |
| unresolved covered branch touches nothing even when the phase branch does not resolve                                                              | `.claude/hooks/lib/guard.mjs:81`         | yes    |
| the guard ignores a covered branch that exists only on the remote (replaces an equivalent mutation: touches is only called with refs that resolve) | `.claude/hooks/lib/guard.mjs:65`         | yes    |
| any commit beyond the phase counts as touching a covered branch                                                                                    | `.claude/hooks/lib/guard.mjs:85`         | yes    |
| a ref holding some unproven commits passes as subset of the proven head                                                                            | `.claude/hooks/lib/guard.mjs:94`         | yes    |
| any redirection target is ignored as a write, not only /dev/null                                                                                   | `.claude/hooks/lib/gate-rules.mjs:356`   | yes    |
| only the first wrapper call is read for a reset                                                                                                    | `.claude/hooks/lib/budget-rules.mjs:199` | yes    |
