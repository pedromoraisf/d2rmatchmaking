# ci-and-review-fixes proofs

**HEAD**: de2c13c
**Tree**: clean
**Result**: 44 pass, 0 fail; mutations 0 killed, 0 not

| Check | Proof                                                                                                            | Ran           | Passed | Result |
| ----- | ---------------------------------------------------------------------------------------------------------------- | ------------- | ------ | ------ |
| C1    | `pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep @CR` | 1             | -      | pass   |
| C2    | `node --test "--test-name-pattern=the acceptance task depends on the site build" scripts/test/ci-workflow.test.` | count unknown | -      | pass   |
| C3    | `rm -rf apps/web/dist && pnpm exec turbo run test:acceptance -- --grep @CRF-24`                                  | 1             | -      | pass   |
| C4    | `pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep @CR` | 1             | -      | pass   |
| C5    | `node --test "--test-name-pattern=the integration job runs acceptance through the command" scripts/test/ci-work` | count unknown | -      | pass   |
| C6    | `node --test "--test-name-pattern=the agent core source is inside the nightly's report directory" scripts/test/` | count unknown | -      | pass   |
| C7    | `pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep @CR` | 1             | -      | pass   |
| C8    | `node --test "--test-name-pattern=agent core score at the baseline path" scripts/test/collect.test.mjs`          | count unknown | -      | pass   |
| C9    | `node --test "--test-name-pattern=the agent core metric keeps its rule" scripts/test/collect.test.mjs`           | count unknown | -      | pass   |
| C10   | `node --test "--test-name-pattern=agent core metric stays unset without a score" scripts/test/collect.test.mjs`  | count unknown | -      | pass   |
| C11   | `node --test "--test-name-pattern=the agent mutation command covers the three crates" scripts/test/agent-mutati` | count unknown | -      | pass   |
| C12   | `node --test "--test-name-pattern=each agent mutation command uses unit tests only" scripts/test/agent-mutation` | count unknown | -      | pass   |
| C13   | `node --test "--test-name-pattern=each agent mutation command writes where the nightly writes" scripts/test/age` | count unknown | -      | pass   |
| C14   | `pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep @CR` | 1             | -      | pass   |
| C15   | `node --test "--test-name-pattern=quality waits for the agent mutation job" scripts/test/nightly-workflow.test.` | count unknown | -      | pass   |
| C16   | `node --test "--test-name-pattern=quality runs unless cancelled" scripts/test/nightly-workflow.test.mjs`         | count unknown | -      | pass   |
| C17   | `node --test "--test-name-pattern=the agent reports are downloaded before the ratchet" scripts/test/nightly-wor` | count unknown | -      | pass   |
| C18   | `node --test "--test-name-pattern=the download is skipped with the agent job" scripts/test/nightly-workflow.tes` | count unknown | -      | pass   |
| C19   | `node --test "--test-name-pattern=the download action is pinned by its full commit" scripts/test/nightly-workfl` | count unknown | -      | pass   |
| C20   | `node --test "--test-name-pattern=a failed download does not fail quality" scripts/test/nightly-workflow.test.m` | count unknown | -      | pass   |
| C21   | `pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep @CR` | 1             | -      | pass   |
| C22   | `pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep @CR` | 1             | -      | pass   |
| C23   | `node --test "--test-name-pattern=the review does not run the verification validator" scripts/test/phase-runner` | count unknown | -      | pass   |
| C24   | `node --test "--test-name-pattern=the review reads the phase status and each feature's budget" scripts/test/pha` | count unknown | -      | pass   |
| C25   | `node --test "--test-name-pattern=the verify step still runs the validator" scripts/test/phase-runner-skill.tes` | count unknown | -      | pass   |
| C26   | `node --test "--test-name-pattern=the review produces the agent reports before the phase ratchet" scripts/test/` | count unknown | -      | pass   |
| C27   | `pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep @CR` | 1             | -      | pass   |
| C28   | `node --test "--test-name-pattern=the review template names the agent mutation command" scripts/test/phase-runn` | count unknown | -      | pass   |
| C29   | `node --test "--test-name-pattern=the agent guide names the agent mutation command" scripts/test/phase-runner-s` | count unknown | -      | pass   |
| C30   | `pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep @CR` | 1             | -      | pass   |
| C31   | `pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep @CR` | 1             | -      | pass   |
| C32   | `node --test "--test-name-pattern=the agent job creates the reports directory first" scripts/test/nightly-workf` | count unknown | -      | pass   |
| C33   | `node --test "--test-name-pattern=the agent mutation command creates the reports directory first" scripts/test/` | count unknown | -      | pass   |
| C34   | `pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep @CR` | 1             | -      | pass   |
| C35   | `node --test "--test-name-pattern=the shared sampler vector lives in the adapters crate" scripts/test/agent-mut` | count unknown | -      | pass   |
| C36   | `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent-adapters --lib -E 't` | 1             | -      | pass   |
| C37   | `pnpm --filter @d2rmm/telemetry exec vitest run src/sdk/sampler.test.ts`                                         | 1             | -      | pass   |
| C38   | `pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep @CR` | 1             | -      | pass   |
| C39   | `node --test "--test-name-pattern=the agent job uploads its reports even when a command fails" scripts/test/nig` | count unknown | -      | pass   |
| C40   | `mkdir -p reports/mutation && cargo mutants --manifest-path apps/agent/src-tauri/Cargo.toml --package d2rmm-age` | count unknown | -      | pass   |
| Build | `pnpm build`                                                                                                     | -             | -      | pass   |
| Build | `pnpm typecheck`                                                                                                 | -             | -      | pass   |
| Build | `pnpm lint`                                                                                                      | -             | -      | pass   |
| Build | `pnpm arch`                                                                                                      | -             | -      | pass   |
