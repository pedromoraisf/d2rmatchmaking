# harness-bootstrap proofs

**HEAD**: 5f9c324
**Tree**: clean
**Result**: 21 pass, 0 fail; mutations 0 killed, 0 not

| Check | Proof                                                                                                            | Ran                                   | Passed        | Result |
| ----- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ------------- | ------ |
| C1    | `node --test --test-name-pattern "records the command, head and clean tree                                       | records a dirty tree as not clean" s` | count unknown | -      | pass |
| C2    | `node --test .claude/hooks/test/delegation.test.mjs`                                                             | count unknown                         | -             | pass   |
| C3    | `node --test .claude/hooks/test/verdicts.test.mjs`                                                               | count unknown                         | -             | pass   |
| C4    | `pnpm exec turbo run test:acceptance -- --grep @HBS-30`                                                          | 1                                     | -             | pass   |
| C5    | `pnpm exec turbo run test:acceptance -- --grep "@HBS-01 "`                                                       | 17                                    | -             | pass   |
| C6    | `pnpm exec turbo run test:acceptance -- --grep @HBS-04`                                                          | 10                                    | -             | pass   |
| C7    | `pnpm exec turbo run test:acceptance -- --grep @HBS-08`                                                          | 13                                    | -             | pass   |
| C8    | `node --test scripts/test/harness-settings.test.mjs`                                                             | count unknown                         | -             | pass   |
| C9    | `pnpm exec turbo run test:acceptance -- --grep "@HBS-1[0-7] "`                                                   | 37                                    | -             | pass   |
| C10   | `pnpm exec turbo run test:acceptance -- --grep "@HBS-(1[89]                                                      | 2[0-3]) "`                            | 11            | -      | pass |
| C11   | `node --test --test-name-pattern "the brief template offers harness-self" scripts/test/phase-runner-skill.test.` | count unknown                         | -             | pass   |
| C12   | `pnpm exec turbo run test:acceptance -- --grep "@HBS-(2[6-9]                                                     | 45) "`                                | 10            | -      | pass |
| C13   | `pnpm exec turbo run test:acceptance -- --grep @HBS-31`                                                          | 7                                     | -             | pass   |
| C14   | `node --test .claude/hooks/test/guard.test.mjs`                                                                  | count unknown                         | -             | pass   |
| C15   | `pnpm exec turbo run test:acceptance -- --grep "@HBS-(3[2-6]                                                     | 4[6-8]) "`                            | 36            | -      | pass |
| C16   | `pnpm exec turbo run test:acceptance -- --grep "@HBS-(3[7-9]                                                     | 4[0-2]) "`                            | 2             | -      | pass |
| C17   | `pnpm contracts:check`                                                                                           | count unknown                         | -             | pass   |
| C18   | `pnpm test:harness`                                                                                              | 1                                     | -             | pass   |
| Build | `pnpm test:harness`                                                                                              | -                                     | -             | pass   |
| Build | `pnpm lint`                                                                                                      | -                                     | -             | pass   |
| Build | `pnpm typecheck`                                                                                                 | -                                     | -             | pass   |
