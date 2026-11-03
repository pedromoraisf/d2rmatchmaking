# observability-e2e proofs

**HEAD**: ee4feef
**Tree**: clean
**Result**: 68 pass, 0 fail; mutations 0 killed, 0 not

| Check | Proof                                                                                                            | Ran | Passed | Result |
| ----- | ---------------------------------------------------------------------------------------------------------------- | --- | ------ | ------ |
| C1    | `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/main/__tests__/instrument.int.tes` | 1   | -      | pass   |
| C2    | `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/main/__tests__/roots.int.test.ts ` | 1   | -      | pass   |
| C3    | `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/main/__tests__/instrument.int.tes` | 1   | -      | pass   |
| C4    | `pnpm --filter @d2rmm/telemetry exec vitest run src/web-sdk.test.ts -t "tracing fetcher sends traceparent and r` | 1   | -      | pass   |
| C5    | `pnpm --filter @d2rmm/web exec vitest run src -t "the navigation span holds the path alone"`                     | 1   | -      | pass   |
| C6    | `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/platform/postgres/outbox.int.test` | 1   | -      | pass   |
| C7    | `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/platform/outbox-relay.int.test.ts` | 1   | -      | pass   |
| C8    | `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/platform/stream-hub.int.test.ts -` | 1   | -      | pass   |
| C9    | `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/platform/outbox-relay.int.test.ts` | 1   | -      | pass   |
| C10   | `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptan` | 1   | -      | pass   |
| C11   | `pnpm --filter @d2rmm/web exec vitest run functions -t "forwards traceparent and tracestate to the API"`         | 1   | -      | pass   |
| C12   | `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/platform/http/telemetry-relay.int` | 1   | -      | pass   |
| C13   | `pnpm --filter @d2rmm/api exec vitest run src/platform/http/guards.test.ts -t "no credential gets 401"`          | 1   | -      | pass   |
| C14   | `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptan` | 1   | -      | pass   |
| C15   | `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/platform/http/telemetry-relay.int` | 1   | -      | pass   |
| C16   | `pnpm --filter @d2rmm/api exec vitest run src/platform/http/relay-budget.test.ts -t "refuses the sixty-first re` | 1   | -      | pass   |
| C17   | `pnpm --filter @d2rmm/api exec vitest run src/platform/http/relay-limiter.test.ts -t "counts credential-less re` | 1   | -      | pass   |
| C18   | `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/platform/http/telemetry-relay-ord` | 1   | -      | pass   |
| C19   | `pnpm --filter @d2rmm/api exec vitest run src/platform/http/relay-forwarder.test.ts -t "a redirect is refused a` | 1   | -      | pass   |
| C20   | `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/platform/http/telemetry-relay-ord` | 1   | -      | pass   |
| C21   | `pnpm --filter @d2rmm/api exec vitest run src/platform/http/guards.test.ts -t "a missing, wrong, slash-suffixed` | 1   | -      | pass   |
| C22   | `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml --workspace -E 'test(a_full_queue_o` | 1   | -      | pass   |
| C23   | `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml --workspace -E 'test(status_401_403` | 1   | -      | pass   |
| C24   | `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml --workspace -E 'test(status_429_wai` | 1   | -      | pass   |
| C25   | `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml --workspace -E 'test(a_slow_relay_n` | 1   | -      | pass   |
| C26   | `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/platform/http/telemetry-relay-ord` | 1   | -      | pass   |
| C27   | `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/platform/http/telemetry-relay.int` | 1   | -      | pass   |
| C28   | `pnpm --filter @d2rmm/telemetry exec vitest run src/web-sdk.test.ts -t "exporter targets the relay path"`        | 1   | -      | pass   |
| C29   | `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="domain and core manifests ho` | 1   | -      | pass   |
| C30   | `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="compose pins the image tag a` | 1   | -      | pass   |
| C31   | `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="package.json defines obs:up ` | 1   | -      | pass   |
| C32   | `pnpm --filter @d2rmm/acceptance exec vitest run support/trace-reader.test.ts -t "prints both trace ids"`        | 1   | -      | pass   |
| C33   | `pnpm --filter @d2rmm/acceptance exec vitest run support/telemetry-backend.test.ts -t "fails naming Docker when` | 1   | -      | pass   |
| C34   | `pnpm --filter @d2rmm/api exec vitest run src/main/app.test.ts -t "log line inside a span carries trace_id and ` | 1   | -      | pass   |
| C35   | `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/main/__tests__/instrument.int.tes` | 1   | -      | pass   |
| C36   | `pnpm --filter @d2rmm/telemetry exec vitest run src/redact-attributes.test.ts -t "strips every forbidden key an` | 1   | -      | pass   |
| C37   | `pnpm --filter @d2rmm/telemetry exec vitest run src/sdk/redacting-exporters.test.ts -t "removes exception messa` | 1   | -      | pass   |
| C38   | `pnpm --filter @d2rmm/telemetry exec vitest run src/redact-attributes.test.ts -t "removes the query string and ` | 1   | -      | pass   |
| C39   | `pnpm --filter @d2rmm/telemetry exec vitest run src/attributes.test.ts -t "exports the standardized d2r attribu` | 1   | -      | pass   |
| C40   | `pnpm --filter @d2rmm/api exec vitest run src/modules/lobby-room/application/lobby-room-use-cases.test.ts -t "n` | 1   | -      | pass   |
| C41   | `pnpm --filter @d2rmm/telemetry exec vitest run src/sdk/views.test.ts -t "metric attributes are limited to the ` | 1   | -      | pass   |
| C42   | `pnpm --filter @d2rmm/telemetry exec vitest run src/sdk/resource.test.ts -t "carries service name, version and ` | 1   | -      | pass   |
| C43   | `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml --workspace -E 'test(agent_resource` | 1   | -      | pass   |
| C44   | `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/platform/http/request-metrics.int` | 1   | -      | pass   |
| C45   | `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/platform/stream-hub.int.test.ts -` | 1   | -      | pass   |
| C46   | `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/platform/outbox-lag.int.test.ts -` | 1   | -      | pass   |
| C47   | `pnpm --filter @d2rmm/api exec vitest run src/modules/lobby-room/application/lobby-room-use-cases.test.ts -t "r` | 1   | -      | pass   |
| C48   | `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="the dashboard holds the list` | 1   | -      | pass   |
| C49   | `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="compose provisions the dashb` | 1   | -      | pass   |
| C50   | `pnpm --filter @d2rmm/telemetry exec vitest run src/dashboard-metrics.test.ts -t "every dashboard metric is def` | 1   | -      | pass   |
| C51   | `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/platform/http/telemetry-relay-ord` | 1   | -      | pass   |
| C52   | `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml --workspace -E 'test(the_loops_keep` | 1   | -      | pass   |
| C53   | `pnpm --filter @d2rmm/config exec vitest run test/rules.test.ts -t "reports process.env in the telemetry packag` | 1   | -      | pass   |
| C54   | `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern=".env.example lists every OTE` | 1   | -      | pass   |
| C55   | `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="an application file importin` | 1   | -      | pass   |
| C56   | `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/main/__tests__/openapi.int.test.t` | 1   | -      | pass   |
| C57   | `pnpm --filter @d2rmm/telemetry exec vitest run src/sdk/sampler.test.ts -t "ratio from the variable and 0.1 whe` | 1   | -      | pass   |
| C58   | `pnpm --filter @d2rmm/telemetry exec vitest run src/sdk/sampler.test.ts -t "a forced sampled flag cannot exceed` | 1   | -      | pass   |
| C59   | `pnpm --filter @d2rmm/telemetry exec vitest run src/web-sdk.test.ts -t "no exporter is created unless enabled"`  | 1   | -      | pass   |
| C60   | `pnpm --filter @d2rmm/api exec vitest run src/modules/agents/application/authenticate-agent.test.ts -t "a miss ` | 1   | -      | pass   |
| C61   | `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="release and deploy workflows` | 1   | -      | pass   |
| C62   | `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml --workspace -E 'test(sampler_decisi` | 1   | -      | pass   |
| C63   | `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml --workspace -E 'test(drops_window_t` | 1   | -      | pass   |
| C64   | `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="fixture-read is never a defa` | 1   | -      | pass   |
| Build | `pnpm build`                                                                                                     | -   | -      | pass   |
| Build | `pnpm typecheck`                                                                                                 | -   | -      | pass   |
| Build | `pnpm lint`                                                                                                      | -   | -      | pass   |
| Build | `pnpm arch`                                                                                                      | -   | -      | pass   |
