# ci-fast-path proofs

**HEAD**: 9813225
**Tree**: clean
**Result**: 21 pass, 0 fail; mutations 0 killed, 0 not

| Check | Proof                                                                                                            | Ran           | Passed | Result |
| ----- | ---------------------------------------------------------------------------------------------------------------- | ------------- | ------ | ------ |
| C1    | `node --test --test-name-pattern "verify runs no mutation" scripts/test/ci-workflow.test.mjs`                    | count unknown | -      | pass   |
| C2    | `node --test --test-name-pattern "the mutation job runs beside the required checks" scripts/test/ci-workflow.te` | count unknown | -      | pass   |
| C3    | `pnpm -C apps/api exec vitest run scripts/mutation-plan.test.ts scripts/mutation.test.ts`                        | 2             | -      | pass   |
| C4    | `pnpm -C apps/api exec vitest run scripts/mutation.test.ts -t "says no mutable file changed"`                    | 1             | -      | pass   |
| C5    | `node --test --test-name-pattern "the mutation job runs beside the required checks" scripts/test/ci-workflow.te` | count unknown | -      | pass   |
| C6    | `pnpm -C apps/api exec vitest run scripts/mutation-summary.test.ts`                                              | 1             | -      | pass   |
| C7    | `node --test --test-name-pattern "integration waits only for verify" scripts/test/ci-workflow.test.mjs`          | count unknown | -      | pass   |
| C8    | `node --test --test-name-pattern "the agent mutation job" scripts/test/ci-workflow.test.mjs`                     | count unknown | -      | pass   |
| C9    | `node --test --test-name-pattern "the nightly agent mutation runs on Linux" scripts/test/nightly-workflow.test.` | count unknown | -      | pass   |
| C10   | `node --test scripts/test/specs.test.mjs`                                                                        | count unknown | -      | pass   |
| C11   | `node --test scripts/test/rulesets.test.mjs`                                                                     | count unknown | -      | pass   |
| C12   | `node --test scripts/test/smoke-healthz.test.mjs`                                                                | count unknown | -      | pass   |
| C13   | `node --test --test-name-pattern "the smoke job boots the API the way Render does" scripts/test/ci-workflow.tes` | count unknown | -      | pass   |
| C14   | `node --test --test-name-pattern "the agent build job compiles the release without signing" scripts/test/ci-wor` | count unknown | -      | pass   |
| C15   | `node --test --test-name-pattern "the new jobs read no secret and pin their actions" scripts/test/ci-workflow.t` | count unknown | -      | pass   |
| C16   | `node --test scripts/test/dependabot.test.mjs`                                                                   | count unknown | -      | pass   |
| C17   | `pnpm contracts:check`                                                                                           | count unknown | -      | pass   |
| C18   | `pnpm exec turbo run test:acceptance -- --grep @CFP-`                                                            | 16            | -      | pass   |
| Build | `pnpm lint`                                                                                                      | -             | -      | pass   |
| Build | `pnpm typecheck`                                                                                                 | -             | -      | pass   |
| Build | `pnpm test:harness`                                                                                              | -             | -      | pass   |
