# harness-foundation proofs

**HEAD**: da28473
**Tree**: clean
**Result**: 23 pass, 0 fail; mutations 0 killed, 0 not

| Check | Proof                                                                                                            | Ran           | Passed | Result        |
| ----- | ---------------------------------------------------------------------------------------------------------------- | ------------- | ------ | ------------- |
| C1    | `pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep "@H` | 1             | -      | pass          |
| C2    | `pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep "@H` | 1             | -      | pass          |
| C3    | `pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep "@H` | 1             | -      | pass          |
| C4    | `pnpm --filter @d2rmm/config exec vitest run test/presets.test.ts`                                               | 1             | -      | pass          |
| C5    | `node --test --test-name-pattern="domain-is-pure" scripts/test/arch-fixtures.test.mjs`                           | count unknown | -      | pass          |
| C6    | `node --test --test-name-pattern="application-no-adapters" scripts/test/arch-fixtures.test.mjs`                  | count unknown | -      | pass          |
| C7    | `node --test --test-name-pattern="no-cross-module-internals" scripts/test/arch-fixtures.test.mjs`                | count unknown | -      | pass          |
| C8    | `node --test --test-name-pattern="nobody-imports-main" scripts/test/arch-fixtures.test.mjs`                      | count unknown | -      | pass          |
| C9    | `pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep "@H` | 1             | -      | pass          |
| C10   | `pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep "@H` | 1             | -      | pass          |
| C11   | `pnpm --filter @d2rmm/api exec vitest run src/shared-kernel`                                                     | 3             | -      | pass          |
| C12   | `pnpm --filter @d2rmm/api test:mutation && node -e "for (const l of ['domain','application']) require('node:fs'` | 13            | -      | pass          |
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
