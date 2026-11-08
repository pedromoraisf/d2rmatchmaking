# budget-v2 proofs

**HEAD**: a5c8fe0
**Tree**: clean
**Result**: 15 pass, 0 fail; mutations 0 killed, 0 not

| Check | Proof                                                                                 | Ran           | Passed | Result |
| ----- | ------------------------------------------------------------------------------------- | ------------- | ------ | ------ |
| C1    | `node --test scripts/test/env-signatures.test.mjs`                                    | count unknown | -      | pass   |
| C2    | `node --test scripts/test/budget.test.mjs`                                            | count unknown | -      | pass   |
| C3    | `node --test --test-name-pattern "Docker failure" scripts/test/attempt-cli.test.mjs`  | count unknown | -      | pass   |
| C4    | `node --test --test-name-pattern "rerun" scripts/test/attempt-cli.test.mjs`           | count unknown | -      | pass   |
| C5    | `node --test --test-name-pattern "full output" scripts/test/attempt-cli.test.mjs`     | count unknown | -      | pass   |
| C6    | `node --test --test-name-pattern "reset" scripts/test/attempt-cli.test.mjs`           | count unknown | -      | pass   |
| C7    | `node --test .claude/hooks/test/budget-rules.test.mjs`                                | count unknown | -      | pass   |
| C8    | `node --test --test-name-pattern "red stop" .claude/hooks/test/budget-rules.test.mjs` | count unknown | -      | pass   |
| C9    | `node --test scripts/test/retry-budget-docs.test.mjs`                                 | count unknown | -      | pass   |
| C10   | `pnpm exec turbo run test:acceptance -- --grep @BUD-`                                 | 55            | -      | pass   |
| C11   | `pnpm test:harness`                                                                   | 1             | -      | pass   |
| C12   | `pnpm contracts:check`                                                                | count unknown | -      | pass   |
| Build | `pnpm lint`                                                                           | -             | -      | pass   |
| Build | `pnpm typecheck`                                                                      | -             | -      | pass   |
| Build | `pnpm test:harness`                                                                   | -             | -      | pass   |
