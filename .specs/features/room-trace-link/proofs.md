# room-trace-link proofs

**HEAD**: 5149949
**Tree**: clean
**Result**: 17 pass, 0 fail; mutations 3 killed, 0 not

| Check | Proof                                                                                                            | Ran | Passed | Result |
| ----- | ---------------------------------------------------------------------------------------------------------------- | --- | ------ | ------ |
| C1    | `pnpm --filter @d2rmm/api exec vitest run src/shared-kernel/tracing.test.ts -t "returns the traceparent of the ` | 1   | -      | pass   |
| C2    | `pnpm --filter @d2rmm/api exec vitest run src/shared-kernel/tracing.test.ts -t "returns null when no span is ac` | 1   | -      | pass   |
| C3    | `pnpm --filter @d2rmm/api exec vitest run src/modules/lobby-room/application/lobby-room-use-cases.test.ts -t "s` | 1   | -      | pass   |
| C4    | `pnpm --filter @d2rmm/api exec vitest run src/modules/lobby-room/application/lobby-room-use-cases.test.ts -t "s` | 1   | -      | pass   |
| C5    | `pnpm --filter @d2rmm/api exec vitest run src/modules/lobby-room/application/lobby-room-use-cases.test.ts -t "l` | 1   | -      | pass   |
| C6    | `pnpm --filter @d2rmm/api exec vitest run src/modules/lobby-room/application/lobby-room-use-cases.test.ts -t "l` | 1   | -      | pass   |
| C7    | `pnpm --filter @d2rmm/api exec vitest run src/modules/lobby-room/application/lobby-room-use-cases.test.ts -t "a` | 1   | -      | pass   |
| C8    | `pnpm --filter @d2rmm/api exec vitest run src/modules/lobby-room/application/lobby-room-use-cases.test.ts -t "a` | 1   | -      | pass   |
| C9    | `pnpm --filter @d2rmm/api exec vitest run src/modules/lobby-room/application/lobby-room-use-cases.test.ts -t "a` | 1   | -      | pass   |
| C10   | `pnpm --filter @d2rmm/api exec vitest run src/modules/lobby-room/application/lobby-room-use-cases.test.ts -t "k` | 1   | -      | pass   |
| C11   | `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/modules/lobby-room/adapters/postg` | 1   | -      | pass   |
| C12   | `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/main/__tests__/migrate.int.test.t` | 1   | -      | pass   |
| C13   | `pnpm exec turbo run test:acceptance -- --grep @RTL-09`                                                          | 1   | -      | pass   |
| Build | `pnpm build`                                                                                                     | -   | -      | pass   |
| Build | `pnpm typecheck`                                                                                                 | -   | -      | pass   |
| Build | `pnpm lint`                                                                                                      | -   | -      | pass   |
| Build | `pnpm arch`                                                                                                      | -   | -      | pass   |

## Mutations

| Mutation                                          | Location                                                                  | Killed |
| ------------------------------------------------- | ------------------------------------------------------------------------- | ------ |
| link swaps trace id and span id                   | `apps/api/src/shared-kernel/tracing.ts:45`                                | yes    |
| UNKNOWN observation exits before the link         | `apps/api/src/modules/lobby-room/application/lobby-room-use-cases.ts:161` | yes    |
| unsampled context not stored (contradicts AD-135) | `apps/api/src/shared-kernel/tracing.ts:19`                                | yes    |
