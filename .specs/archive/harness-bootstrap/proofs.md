# harness-bootstrap proofs

**HEAD**: d09af1b
**Tree**: clean
**Result**: 25 pass, 0 fail; mutations 8 killed, 0 not

| Check | Proof                                                                                                            | Ran           | Passed | Result |
| ----- | ---------------------------------------------------------------------------------------------------------------- | ------------- | ------ | ------ |
| C1    | `node --test scripts/test/attempt-cli.test.mjs`                                                                  | count unknown | -      | pass   |
| C2    | `node --test .claude/hooks/test/delegation.test.mjs`                                                             | count unknown | -      | pass   |
| C3    | `node --test .claude/hooks/test/verdicts.test.mjs`                                                               | count unknown | -      | pass   |
| C4    | `pnpm exec turbo run test:acceptance -- --grep @HBS-30`                                                          | 1             | -      | pass   |
| C5    | `pnpm exec turbo run test:acceptance -- --grep "@HBS-01 "`                                                       | 17            | -      | pass   |
| C6    | `pnpm exec turbo run test:acceptance -- --grep @HBS-04`                                                          | 10            | -      | pass   |
| C7    | `pnpm exec turbo run test:acceptance -- --grep @HBS-08`                                                          | 13            | -      | pass   |
| C8    | `node --test scripts/test/harness-settings.test.mjs`                                                             | count unknown | -      | pass   |
| C9    | `pnpm exec turbo run test:acceptance -- --grep "@HBS-1[0-7] "`                                                   | 37            | -      | pass   |
| C10   | `pnpm exec turbo run test:acceptance -- --grep "@HBS-[12][0-9] "`                                                | 57            | -      | pass   |
| C11   | `node --test --test-name-pattern "the brief template offers harness-self" scripts/test/phase-runner-skill.test.` | count unknown | -      | pass   |
| C12   | `pnpm exec turbo run test:acceptance -- --grep "@HBS-2[6-9] "`                                                   | 9             | -      | pass   |
| C13   | `pnpm exec turbo run test:acceptance -- --grep @HBS-31`                                                          | 7             | -      | pass   |
| C14   | `node --test .claude/hooks/test/guard.test.mjs`                                                                  | count unknown | -      | pass   |
| C15   | `pnpm exec turbo run test:acceptance -- --grep "@HBS-3[2-6] "`                                                   | 26            | -      | pass   |
| C16   | `pnpm exec turbo run test:acceptance -- --grep "@HBS-3[7-9] "`                                                   | 1             | -      | pass   |
| C17   | `pnpm contracts:check`                                                                                           | count unknown | -      | pass   |
| C18   | `pnpm test:harness`                                                                                              | 1             | -      | pass   |
| C19   | `pnpm exec turbo run test:acceptance -- --grep "@HBS-4[0-2] "`                                                   | 1             | -      | pass   |
| C20   | `pnpm exec turbo run test:acceptance -- --grep @HBS-49`                                                          | 3             | -      | pass   |
| C21   | `pnpm exec turbo run test:acceptance -- --grep @HBS-45`                                                          | 1             | -      | pass   |
| C22   | `pnpm exec turbo run test:acceptance -- --grep "@HBS-4[6-8] "`                                                   | 14            | -      | pass   |
| Build | `pnpm test:harness`                                                                                              | -             | -      | pass   |
| Build | `pnpm lint`                                                                                                      | -             | -      | pass   |
| Build | `pnpm typecheck`                                                                                                 | -             | -      | pass   |

## Mutations

| Mutation                                      | Location                            | Killed |
| --------------------------------------------- | ----------------------------------- | ------ |
| verdict PASS accepted by prefix               | `.claude/hooks/lib/verdicts.mjs:21` | yes    |
| dirty-tree attempt proves a head              | `.claude/hooks/lib/guard.mjs:100`   | yes    |
| merge subset check weakened to some           | `.claude/hooks/lib/guard.mjs:85`    | yes    |
| push -f combined with u no longer denied      | `.claude/hooks/lib/delivery.mjs:72` | yes    |
| gh pr merge pin not compared                  | `.claude/hooks/lib/guard.mjs:253`   | yes    |
| moved head still records the reported verdict | `.claude/hooks/lib/verdicts.mjs:73` | yes    |
| operand-ful merge of covered branch unguarded | `.claude/hooks/lib/guard.mjs:168`   | yes    |
| string true background review not denied      | `.claude/hooks/lib/verdicts.mjs:83` | yes    |
