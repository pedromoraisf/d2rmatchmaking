# api-web-skeleton proofs

**HEAD**: 47f73e6
**Tree**: clean
**Result**: 78 pass, 0 fail; mutations 3 killed, 0 not

| Check | Proof                                                                                                            | Ran           | Passed | Result        |
| ----- | ---------------------------------------------------------------------------------------------------------------- | ------------- | ------ | ------------- |
| C1    | `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptan` | 1             | -      | pass          |
| C2    | `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/main/__tests__/identity-routes.in` | 1             | -      | pass          |
| C3    | `pnpm --filter @d2rmm/api exec vitest run src/modules/identity/application -t "reuses the account ignoring case` | 1             | -      | pass          |
| C4    | `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptan` | 5             | -      | pass          |
| C5    | `pnpm --filter @d2rmm/api exec vitest run src/modules/identity/domain -t "rejects names outside the rules"`      | 1             | -      | pass          |
| C6    | `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptan` | 1             | -      | pass          |
| C7    | `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptan` | 1             | -      | pass          |
| C8    | `pnpm --filter @d2rmm/api exec vitest run src/modules/identity/domain -t "expires at exactly 7 days"`            | 1             | -      | pass          |
| C9    | `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptan` | 1             | -      | pass          |
| C10   | `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptan` | 1             | -      | pass          |
| C11   | `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptan` | 1             | -      | pass          |
| C12   | `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptan` | 1             | -      | pass          |
| C13   | `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptan` | 1             | -      | pass          |
| C14   | `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/modules/agents/adapters/postgres ` | 1             | -      | pass          |
| C15   | `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptan` | 3             | -      | pass          |
| C16   | `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptan` | 1             | -      | pass          |
| C17   | `pnpm --filter @d2rmm/api exec vitest run src/modules/agents/domain -t "limits the 11th submission until the ol` | 1             | -      | pass          |
| C18   | `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptan` | 1             | -      | pass          |
| C19   | `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/main/__tests__/agents-routes.int.` | 1             | -      | pass          |
| C20   | `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptan` | 1             | -      | pass          |
| C21   | `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptan` | 1             | -      | pass          |
| C22   | `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptan` | 6             | -      | pass          |
| C23   | `pnpm --filter @d2rmm/api exec vitest run src/platform/http -t "answers 426 before authentication"`              | 1             | -      | pass          |
| C24   | `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/main/__tests__/agents-routes.int.` | 1             | -      | pass          |
| C25   | `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptan` | 1             | -      | pass          |
| C26   | `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptan` | 1             | -      | pass          |
| C27   | `pnpm --filter @d2rmm/api exec vitest run src/modules/agents/domain -t "marks the agent offline after 45 s"`     | 1             | -      | pass          |
| C28   | `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptan` | 1             | -      | pass          |
| C29   | `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptan` | 1             | -      | pass          |
| C30   | `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptan` | 1             | -      | pass          |
| C31   | `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptan` | 1             | -      | pass          |
| C32   | `pnpm --filter @d2rmm/api exec vitest run src/modules/lobby-room/domain -t "fromMatch creates awaiting_host wit` | 1             | -      | pass          |
| C33   | `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptan` | 1             | -      | pass          |
| C34   | `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptan` | 1             | -      | pass          |
| C35   | `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptan` | 1             | -      | pass          |
| C36   | `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/main/__tests__/lobby-routes.int.t` | 1             | -      | pass          |
| C37   | `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptan` | 1             | -      | pass          |
| C38   | `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptan` | 2             | -      | pass          |
| C39   | `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptan` | 1             | -      | pass          |
| C40   | `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptan` | 1             | -      | pass          |
| C41   | `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptan` | 1             | -      | pass          |
| C42   | `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptan` | 1             | -      | pass          |
| C43   | `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/platform/postgres -t "rolls back ` | 1             | -      | pass          |
| C44   | `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/platform -t "publishes rows left ` | 1             | -      | pass          |
| C45   | `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/platform -t "dead-letters after 5` | 1             | -      | pass          |
| C46   | `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptan` | 1             | -      | pass          |
| C47   | `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptan` | 1             | -      | pass          |
| C48   | `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptan` | 1             | -      | pass          |
| C49   | `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptan` | 1             | -      | pass          |
| C50   | `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptan` | 1             | -      | pass          |
| C51   | `pnpm --filter @d2rmm/web exec vitest run functions -t "rejects hostile paths"`                                  | 1             | -      | pass          |
| C52   | `pnpm --filter @d2rmm/web exec vitest run functions -t "drops Authorization and X-Agent-Version"`                | 1             | -      | pass          |
| C53   | `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptan` | 1             | -      | pass          |
| C54   | `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/main/__tests__/app.int.test.ts -t` | 1             | -      | pass          |
| C55   | `pnpm --filter @d2rmm/config exec vitest run test/rules.test.ts -t "n/no-process-env reports a process.env read` | 1             | -      | pass          |
| C56   | `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/main/__tests__/roots.int.test.ts ` | 1             | -      | pass          |
| C57   | `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/main/__tests__/migrate.int.test.t` | 1             | -      | pass          |
| C58   | `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/main/__tests__/app.int.test.ts -t` | 1             | -      | pass          |
| C59   | `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="deploy-api runs migrations b` | 1             | -      | pass          |
| C60   | `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="deploy-web publishes preview` | 1             | -      | pass          |
| C61   | `walk - the maintainer merges phase/F0 after the phase review; the Actions page shows deploy-api and deploy-web` | -             | -      | pass (Walked) |
| C62   | `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/main/__tests__/lobby-routes.int.t` | 1             | -      | pass          |
| C63   | `pnpm --filter @d2rmm/api exec vitest run src/shared-kernel -t "opens a span with the use-case name"`            | 1             | -      | pass          |
| C64   | `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/main/__tests__/openapi.int.test.t` | 1             | -      | pass          |
| C65   | `pnpm --filter @d2rmm/contracts exec vitest run src -t "writes one JSON Schema per agent message"`               | 1             | -      | pass          |
| C66   | `pnpm contracts:check`                                                                                           | count unknown | -      | pass          |
| C67   | `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptan` | 4             | -      | pass          |
| C68   | `pnpm --filter @d2rmm/web exec vitest run src -t "en and pt-BR hold the same keys"`                              | 1             | -      | pass          |
| C69   | `pnpm --filter @d2rmm/config exec vitest run test/rules.test.ts -t "reports a literal string in a component"`    | 1             | -      | pass          |
| C70   | `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptan` | 1             | -      | pass          |
| C71   | `pnpm --filter @d2rmm/api exec vitest run src/platform -t "ids increase with outbox order"`                      | 1             | -      | pass          |
| C72   | `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/platform -t "event ids increase"`  | 1             | -      | pass          |
| C73   | `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/platform -t "sends a keep-alive c` | 1             | -      | pass          |
| C74   | `pnpm --filter @d2rmm/api exec vitest run src/modules/lobby-room/domain -t "ignores a GAME_NAME_SEEN from a mem` | 1             | -      | pass          |
| Build | `pnpm build`                                                                                                     | -             | -      | pass          |
| Build | `pnpm typecheck`                                                                                                 | -             | -      | pass          |
| Build | `pnpm lint`                                                                                                      | -             | -      | pass          |
| Build | `pnpm arch`                                                                                                      | -             | -      | pass          |

## Mutations

| Mutation                                        | Location                                                   | Killed |
| ----------------------------------------------- | ---------------------------------------------------------- | ------ |
| drop host-only check on GAME_NAME_SEEN (INV-06) | `apps/api/src/modules/lobby-room/domain/lobby-room.ts:174` | yes    |
| offline boundary 45 s shifted by one            | `apps/api/src/modules/agents/domain/presence.ts:31`        | yes    |
| rate window boundary inclusive                  | `apps/api/src/modules/agents/domain/sliding-window.ts:25`  | yes    |
