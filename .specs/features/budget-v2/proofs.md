# budget-v2 proofs

**HEAD**: b202433
**Tree**: clean
**Result**: 28 pass, 0 fail; mutations 0 killed, 0 not

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
| C10   | `pnpm exec turbo run test:acceptance -- --grep @BUD-`                                                            | 57            | -      | pass   |
| C11   | `pnpm test:harness`                                                                                              | 1             | -      | pass   |
| C12   | `pnpm contracts:check`                                                                                           | count unknown | -      | pass   |
| C13   | `node --test --test-name-pattern "isUnchangedRerun" scripts/test/budget.test.mjs`                                | count unknown | -      | pass   |
| C14   | `node --test --test-name-pattern "hidden behind another wrapper call" .claude/hooks/test/budget-rules.test.mjs`  | count unknown | -      | pass   |
| C15   | `node --test --test-name-pattern "2>&1" .claude/hooks/test/budget-rules.test.mjs`                                | count unknown | -      | pass   |
| C16   | `node --test --test-name-pattern "a covered branch not started touches nothing" .claude/hooks/test/guard.test.m` | count unknown | -      | pass   |
| C17   | `node --test --test-name-pattern "exists only on the remote" --test-name-pattern "git cannot answer" --test-nam` | count unknown | -      | pass   |
| C18   | `node --test --test-name-pattern "however the wrapper is spelled" .claude/hooks/test/budget-rules.test.mjs`      | count unknown | -      | pass   |
| C19   | `node --test --test-name-pattern "blocks at the fourth machine failure in total" scripts/test/budget.test.mjs`   | count unknown | -      | pass   |
| C20   | `node --test --test-name-pattern "at most two red stops uncounted per session" .claude/hooks/test/budget-rules.` | count unknown | -      | pass   |
| C21   | `node --test --test-name-pattern "a merge keeps the uncounted stops" --test-name-pattern "a merge keeps the lar` | count unknown | -      | pass   |
| C22   | `node --test --test-name-pattern "a subagent of an unknown session counts its red stops" .claude/hooks/test/bud` | count unknown | -      | pass   |
| C23   | `node --test --test-name-pattern "only a reset clears the machine-failure total" scripts/test/budget.test.mjs`   | count unknown | -      | pass   |
| C24   | `node --test --test-name-pattern "a reset is judged through quotes, escapes, case and hidden code" .claude/hook` | count unknown | -      | pass   |
| C25   | `node --test --test-name-pattern "the guard reads both the local and the remote head" .claude/hooks/test/guard.` | count unknown | -      | pass   |
| Build | `pnpm lint`                                                                                                      | -             | -      | pass   |
| Build | `pnpm typecheck`                                                                                                 | -             | -      | pass   |
| Build | `pnpm test:harness`                                                                                              | -             | -      | pass   |
