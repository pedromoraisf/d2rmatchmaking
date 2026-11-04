# load-baseline proofs

**HEAD**: 0b5c654
**Tree**: clean
**Result**: 64 pass, 0 fail; mutations 3 killed, 0 not

| Check | Proof                                                                                                            | Ran           | Passed | Result |
| ----- | ---------------------------------------------------------------------------------------------------------------- | ------------- | ------ | ------ |
| C1    | `node --test "--test-name-pattern=full profile steps" scripts/test/load/profile.test.mjs`                        | count unknown | -      | pass   |
| C2    | `node --test "--test-name-pattern=no next step after a failure or the last step" scripts/test/load/profile.test` | count unknown | -      | pass   |
| C3    | `node --test "--test-name-pattern=smoke profile" scripts/test/load/profile.test.mjs`                             | count unknown | -      | pass   |
| C4    | `node --test "--test-name-pattern=error ratio is errors over requests plus iterations" scripts/test/load/error-` | count unknown | -      | pass   |
| C5    | `node --test "--test-name-pattern=nearest-rank p95" scripts/test/load/percentile.test.mjs`                       | count unknown | -      | pass   |
| C6    | `node --test "--test-name-pattern=container is not ok after a restart, an OOM kill or a stop" scripts/test/load` | count unknown | -      | pass   |
| C7    | `node --test "--test-name-pattern=p95 boundary at 2000 ms" scripts/test/load/step-verdict.test.mjs`              | count unknown | -      | pass   |
| C8    | `node --test "--test-name-pattern=error ratio boundary at 1%" scripts/test/load/step-verdict.test.mjs`           | count unknown | -      | pass   |
| C9    | `node --test "--test-name-pattern=first failed rule order" scripts/test/load/step-verdict.test.mjs`              | count unknown | -      | pass   |
| C10   | `node --test "--test-name-pattern=bytes per player-hour" scripts/test/load/bytes.test.mjs`                       | count unknown | -      | pass   |
| C11   | `node --test "--test-name-pattern=bytes outside the window are ignored" scripts/test/load/window-counter.test.m` | count unknown | -      | pass   |
| C12   | `node --test "--test-name-pattern=telemetry numbers" scripts/test/load/telemetry-share.test.mjs`                 | count unknown | -      | pass   |
| C13   | `node --test "--test-name-pattern=share boundary at 0.10" scripts/test/load/telemetry-share.test.mjs`            | count unknown | -      | pass   |
| C14   | `node --test "--test-name-pattern=maxConcurrentPlayers" scripts/test/load/summary.test.mjs`                      | count unknown | -      | pass   |
| C15   | `node --test "--test-name-pattern=failure names the step and the rule" scripts/test/load/summary.test.mjs`       | count unknown | -      | pass   |
| C16   | `node --test "--test-name-pattern=top-level numbers" scripts/test/load/summary.test.mjs`                         | count unknown | -      | pass   |
| C17   | `node --test "--test-name-pattern=summary fields" scripts/test/load/summary.test.mjs`                            | count unknown | -      | pass   |
| C18   | `node --test "--test-name-pattern=unmeasured numbers, ceiling and a later failure" scripts/test/load/summary.te` | count unknown | -      | pass   |
| C19   | `node --test "--test-name-pattern=no secret text in the summary" scripts/test/load/summary.test.mjs`             | count unknown | -      | pass   |
| C20   | `node --test "--test-name-pattern=whole or absent" scripts/test/load/write-summary.test.mjs`                     | count unknown | -      | pass   |
| C21   | `node --test "--test-name-pattern=refuses a missing, smoke or failed summary" scripts/test/load/publish.test.mj` | count unknown | -      | pass   |
| C22   | `node --test "--test-name-pattern=publishes a passed full summary" scripts/test/load/publish.test.mjs`           | count unknown | -      | pass   |
| C23   | `node --test "--test-name-pattern=refuses a non-empty target" scripts/test/load/target-guard.test.mjs`           | count unknown | -      | pass   |
| C24   | `node --test "--test-name-pattern=ignores unset and empty" scripts/test/load/target-guard.test.mjs`              | count unknown | -      | pass   |
| C25   | `node --test "--test-name-pattern=refuses a remote Docker host" scripts/test/load/target-guard.test.mjs`         | count unknown | -      | pass   |
| C26   | `node --test "--test-name-pattern=classifies Docker failures" scripts/test/load/preflight.test.mjs`              | count unknown | -      | pass   |
| C27   | `node --test "--test-name-pattern=unique names and distinct addresses" scripts/test/load/players.test.mjs`       | count unknown | -      | pass   |
| C28   | `node --test "--test-name-pattern=a 429 is an error" scripts/test/load/journey-state.test.mjs`                   | count unknown | -      | pass   |
| C29   | `node --test "--test-name-pattern=provisioning requests" scripts/test/load/provision-requests.test.mjs`          | count unknown | -      | pass   |
| C30   | `node --test "--test-name-pattern=provisions players without logging secrets" scripts/test/load/provision.test.` | count unknown | -      | pass   |
| C31   | `node --test "--test-name-pattern=limits and strict values" scripts/test/load/container-spec.test.mjs`           | count unknown | -      | pass   |
| C32   | `node --test "--test-name-pattern=API environment allow-list" scripts/test/load/container-spec.test.mjs`         | count unknown | -      | pass   |
| C33   | `node --test "--test-name-pattern=Postgres with TLS" scripts/test/load/container-spec.test.mjs`                  | count unknown | -      | pass   |
| C34   | `node --test "--test-name-pattern=publish guard" scripts/test/load/container-spec.test.mjs`                      | count unknown | -      | pass   |
| C35   | `node --test "--test-name-pattern=cleanup and sweep plans" scripts/test/load/cleanup-plan.test.mjs`              | count unknown | -      | pass   |
| C36   | `node --test "--test-name-pattern=five second timeout" scripts/test/load/journey-state.test.mjs`                 | count unknown | -      | pass   |
| C37   | `node --test "--test-name-pattern=meter counts API bytes inside the window" scripts/test/load/meter.test.mjs`    | count unknown | -      | pass   |
| C38   | `node --test "--test-name-pattern=sink counts wire bytes inside the window" scripts/test/load/sink.test.mjs`     | count unknown | -      | pass   |
| C39   | `node --test "--test-name-pattern=sequence and cleanup on every exit path" scripts/test/load/orchestrate.test.m` | count unknown | -      | pass   |
| C40   | `node --test "--test-name-pattern=no secret in arguments or logs" scripts/test/load/orchestrate.test.mjs`        | count unknown | -      | pass   |
| C41   | `node --test "--test-name-pattern=pairing limiter constants" scripts/test/load-scripts.test.mjs`                 | count unknown | -      | pass   |
| C42   | `node --test "--test-name-pattern=load scripts are on demand only" scripts/test/load-scripts.test.mjs`           | count unknown | -      | pass   |
| C43   | `node --test "--test-name-pattern=images, shell and journey rules" scripts/test/load-scripts.test.mjs`           | count unknown | -      | pass   |
| C44   | `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptan` | 3             | -      | pass   |
| C45   | `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptan` | 3             | -      | pass   |
| C46   | `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptan` | 3             | -      | pass   |
| C47   | `pnpm test:load:smoke && node --test scripts/load/check/smoke-summary.check.mjs`                                 | count unknown | -      | pass   |
| C48   | `pnpm test:load && node --test scripts/load/check/full-summary.check.mjs`                                        | count unknown | -      | pass   |
| C49   | `node --test "--test-name-pattern=pending observation at the end of a stream" scripts/test/load/journey-state.t` | count unknown | -      | pass   |
| C60   | `pnpm --filter @d2rmm/api test:mutation`                                                                         | 272           | -      | pass   |
| C58   | `node --test "--test-name-pattern=a telemetry share over the limit is reported and does not fail the run" scrip` | count unknown | -      | pass   |
| C59   | `node --test "--test-name-pattern=the baseline shows the telemetry limit as report-only" scripts/test/load/publ` | count unknown | -      | pass   |
| C56   | `pnpm --filter @d2rmm/api exec vitest run src/modules/agents/application/pairing-use-cases.test.ts -t "pair rea` | 1             | -      | pass   |
| C57   | `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/modules/agents/adapters/postgres/` | 1             | -      | pass   |
| C54   | `node --test "--test-name-pattern=step rows carry the error breakdown" scripts/test/load/summary.test.mjs`       | count unknown | -      | pass   |
| C55   | `node --test "--test-name-pattern=provisioning failures name the route and the player" scripts/test/load/provis` | count unknown | -      | pass   |
| C53   | `node --test "--test-name-pattern=journey closes its tally at the stream error event" scripts/test/load-scripts` | count unknown | -      | pass   |
| C52   | `node --test "--test-name-pattern=lost assignments count as errors" scripts/test/load/error-ratio.test.mjs`      | count unknown | -      | pass   |
| C50   | `node --test "--test-name-pattern=certificate container and volume" scripts/test/load/container-spec.test.mjs`   | count unknown | -      | pass   |
| C51   | `node --test "--test-name-pattern=journey uses no timers while a stream is open" scripts/test/load-scripts.test` | count unknown | -      | pass   |
| Build | `pnpm build`                                                                                                     | -             | -      | pass   |
| Build | `pnpm typecheck`                                                                                                 | -             | -      | pass   |
| Build | `pnpm lint`                                                                                                      | -             | -      | pass   |
| Build | `pnpm arch`                                                                                                      | -             | -      | pass   |

## Mutations

| Mutation                                        | Location                                  | Killed |
| ----------------------------------------------- | ----------------------------------------- | ------ |
| error ratio of exactly 1% passes (>= -> >)      | `scripts/load/lib/step-verdict.mjs:25`    | yes    |
| p95 rank ceil -> floor                          | `scripts/load/lib/percentile.mjs:20`      | yes    |
| telemetry share of exactly 0.10 fails (> -> >=) | `scripts/load/lib/telemetry-share.mjs:46` | yes    |
