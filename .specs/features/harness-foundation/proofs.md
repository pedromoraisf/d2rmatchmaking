# harness-foundation proofs

**HEAD**: 9ca3d4a
**Tree**: clean
**Result**: 23 pass, 0 fail; mutations 9 killed, 0 not

| Check | Proof                                                                                                            | Ran           | Passed | Result        |
| ----- | ---------------------------------------------------------------------------------------------------------------- | ------------- | ------ | ------------- |
| C1    | `pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep "@H` | 1             | -      | pass          |
| C2    | `pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep "@H` | 1             | -      | pass          |
| C3    | `pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep "@H` | 1             | -      | pass          |
| C4    | `pnpm --filter @d2rmm/config exec vitest run test/presets.test.ts`                                               | 1             | -      | pass          |
| C5    | `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="domain-is-pure" scripts/test` | 1             | -      | pass          |
| C6    | `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="application-no-adapters" scr` | 1             | -      | pass          |
| C7    | `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="no-cross-module-internals" s` | 1             | -      | pass          |
| C8    | `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="nobody-imports-main" scripts` | 1             | -      | pass          |
| C9    | `pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep "@H` | 1             | -      | pass          |
| C10   | `pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep "@H` | 1             | -      | pass          |
| C11   | `pnpm --filter @d2rmm/api exec vitest run src/shared-kernel`                                                     | 3             | -      | pass          |
| C12   | `pnpm --filter @d2rmm/api test:mutation && node -e "for (const l of ['domain','application']) require('node:fs'` | 15            | -      | pass          |
| C13   | `pnpm --filter @d2rmm/api exec vitest run scripts/mutation-plan.test.ts -t "break threshold"`                    | 1             | -      | pass          |
| C14   | `pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep "@H` | 1             | -      | pass          |
| C15   | `node -e "const m=require('./.quality-baseline.json').metrics; const k=Object.keys(m).filter(n=>n==='mutation.a` | count unknown | -      | pass          |
| C16   | `pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep "@H` | 1             | -      | pass          |
| C17   | `pnpm --filter @d2rmm/api exec vitest run scripts/mutation-plan.test.ts -t "empty layer"`                        | 1             | -      | pass          |
| C18   | `walk - the maintainer pushes phase/F0 after the phase review and the PR checks page shows the three jobs green` | -             | -      | pass (Walked) |
| C19   | `pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep "@H` | 1             | -      | pass          |
| Build | `pnpm build`                                                                                                     | -             | -      | pass          |
| Build | `pnpm typecheck`                                                                                                 | -             | -      | pass          |
| Build | `pnpm lint`                                                                                                      | -             | -      | pass          |
| Build | `pnpm arch`                                                                                                      | -             | -      | pass          |

## Mutations

| Mutation                                                         | Location                                        | Killed |
| ---------------------------------------------------------------- | ----------------------------------------------- | ------ |
| FakeClock constructor stores the caller's Date instead of a copy | `apps/api/src/shared-kernel/clock.ts:11`        | yes    |
| FakeClock.set stores the caller's Date instead of a copy         | `apps/api/src/shared-kernel/clock.ts:23`        | yes    |
| FakeClock.now returns the internal Date                          | `apps/api/src/shared-kernel/clock.ts:15`        | yes    |
| Stryker mutate list no longer excludes test files                | `apps/api/scripts/mutation-plan.ts:38`          | yes    |
| last Stryker exit code wins instead of first non-zero            | `apps/api/scripts/mutation.ts:39`               | yes    |
| default id prefix changed                                        | `apps/api/src/shared-kernel/id-generator.ts:11` | yes    |
| count reporter no longer fails on zero passed tests              | `scripts/lib/count-reporter.mjs:39`             | yes    |
| count reporter ignores failures                                  | `scripts/lib/count-reporter.mjs:39`             | yes    |
| stryker.config.mjs stops spreading the layer config              | `apps/api/stryker.config.mjs:20`                | yes    |
