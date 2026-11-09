# continuous-delivery proofs

**HEAD**: 849ff36
**Tree**: clean
**Result**: 19 pass, 0 fail; mutations 0 killed, 0 not

| Check | Proof                                                                                                            | Ran           | Passed | Result |
| ----- | ---------------------------------------------------------------------------------------------------------------- | ------------- | ------ | ------ |
| C1    | `node --test --test-name-pattern "the skill tells the remote flow" scripts/test/phase-runner-skill.test.mjs`     | count unknown | -      | pass   |
| C2    | `node --test --test-name-pattern "the skill tells the remote flow" scripts/test/phase-runner-skill.test.mjs`     | count unknown | -      | pass   |
| C3    | `node --test --test-name-pattern "integrates only when the trailers reach the phase" scripts/test/phase-state.t` | count unknown | -      | pass   |
| C4    | `node --test --test-name-pattern "the skill tells the remote flow" scripts/test/phase-runner-skill.test.mjs`     | count unknown | -      | pass   |
| C5    | `node --test --test-name-pattern "the skill tells the remote flow" scripts/test/phase-runner-skill.test.mjs`     | count unknown | -      | pass   |
| C6    | `node --test --test-name-pattern "closes on the review and the merge, with no approval line" scripts/test/phase` | count unknown | -      | pass   |
| C7    | `node --test --test-name-pattern "an open maintainer item blocks only its feature" scripts/test/phase-state.tes` | count unknown | -      | pass   |
| C8    | `node --test --test-name-pattern "prints open maintainer items" scripts/test/phase-status-cli.test.mjs`          | count unknown | -      | pass   |
| C9    | `node --test --test-name-pattern "an answered maintainer item no longer blocks" scripts/test/phase-state.test.m` | count unknown | -      | pass   |
| C10   | `node --test --test-name-pattern "the templates tell the remote flow" scripts/test/phase-runner-skill.test.mjs`  | count unknown | -      | pass   |
| C11   | `node --test --test-name-pattern "the skill no longer leaves delivery to the maintainer" scripts/test/phase-run` | count unknown | -      | pass   |
| C12   | `pnpm test:harness`                                                                                              | 1             | -      | pass   |
| C13   | `pnpm contracts:check`                                                                                           | count unknown | -      | pass   |
| C14   | `node --test --test-name-pattern "the skill tells the remote flow" scripts/test/phase-runner-skill.test.mjs`     | count unknown | -      | pass   |
| C15   | `node --test --test-name-pattern "reads a merge on origin/main" scripts/test/phase-status-cli.test.mjs`          | count unknown | -      | pass   |
| C16   | `pnpm exec turbo run test:acceptance -- --grep @CDL-`                                                            | 10            | -      | pass   |
| Build | `pnpm lint`                                                                                                      | -             | -      | pass   |
| Build | `pnpm typecheck`                                                                                                 | -             | -      | pass   |
| Build | `pnpm test:harness`                                                                                              | -             | -      | pass   |
