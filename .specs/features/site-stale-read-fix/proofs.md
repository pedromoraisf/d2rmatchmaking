# site-stale-read-fix proofs

**HEAD**: 098227b
**Tree**: clean
**Result**: 17 pass, 0 fail; mutations 3 killed, 0 not

| Check | Proof                                                                                                            | Ran | Passed | Result |
| ----- | ---------------------------------------------------------------------------------------------------------------- | --- | ------ | ------ |
| C1    | `pnpm --filter @d2rmm/web exec vitest run src/app/App.test.tsx -t "ignores a read that answers after a stream e` | 1   | -      | pass   |
| C2    | `pnpm --filter @d2rmm/web exec vitest run src/app/App.test.tsx -t "ignores a test match read that answers after` | 1   | -      | pass   |
| C3    | `pnpm --filter @d2rmm/web exec vitest run src/app/App.test.tsx -t "a presence event during a read also makes th` | 1   | -      | pass   |
| C4    | `pnpm exec turbo run test:acceptance -- --grep @SSR-04`                                                          | 1   | -      | pass   |
| C5    | `pnpm --filter @d2rmm/web exec vitest run src/app/App.test.tsx -t "reads again after ignoring a read"`           | 1   | -      | pass   |
| C6    | `pnpm --filter @d2rmm/web exec vitest run src/app/App.test.tsx -t "reads again when a read fails after a stream` | 1   | -      | pass   |
| C7    | `pnpm --filter @d2rmm/web exec vitest run src/app/App.test.tsx -t "a repeated event during a read costs one mor` | 1   | -      | pass   |
| C8    | `pnpm exec turbo run test:acceptance -- --grep @SSR-02`                                                          | 1   | -      | pass   |
| C9    | `pnpm --filter @d2rmm/web exec vitest run src/app/App.test.tsx -t "shows the answer of a read with no stream ev` | 1   | -      | pass   |
| C10   | `pnpm exec turbo run test:acceptance -- --grep @SSR-03`                                                          | 1   | -      | pass   |
| C11   | `pnpm --filter @d2rmm/web exec vitest run src/app/App.test.tsx -t "keeps the stage from the stream when the new` | 1   | -      | pass   |
| C12   | `pnpm --filter @d2rmm/web exec vitest run src/app/App.test.tsx -t "clears the room when a read answers no room ` | 1   | -      | pass   |
| C13   | `pnpm exec turbo run test:acceptance -- --grep @SSR-05`                                                          | 1   | -      | pass   |
| Build | `pnpm build`                                                                                                     | -   | -      | pass   |
| Build | `pnpm typecheck`                                                                                                 | -   | -      | pass   |
| Build | `pnpm lint`                                                                                                      | -   | -      | pass   |
| Build | `pnpm arch`                                                                                                      | -   | -      | pass   |

## Mutations

| Mutation                                                          | Location                       | Killed |
| ----------------------------------------------------------------- | ------------------------------ | ------ |
| stream events are no longer counted, so no read is ever overtaken | `apps/web/src/app/App.tsx:115` | yes    |
| an overtaken read's answer is applied anyway before the new read  | `apps/web/src/app/App.tsx:79`  | yes    |
| a 404 no longer clears the room                                   | `apps/web/src/app/App.tsx:85`  | yes    |
