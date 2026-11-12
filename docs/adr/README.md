# Architecture Decision Records

Format: Context · Decision · Alternatives · Consequences. Only the maintainer accepts or changes an ADR; agents write new ones as **Proposed** (`/adr`). Source: Design Doc, "Insumos para os ADRs".

| ADR                                        | Title                                                                      | Status                                   |
| ------------------------------------------ | -------------------------------------------------------------------------- | ---------------------------------------- |
| [001](001-public-monorepo.md)              | Public monorepo                                                            | Accepted                                 |
| [002](002-modular-monolith.md)             | Modular monolith                                                           | Accepted                                 |
| [003](003-layers.md)                       | Layers: domain, application, adapters, main                                | Accepted                                 |
| [004](004-dependency-rules.md)             | Dependency rules as a sensor                                               | Accepted                                 |
| [005](005-hosting.md)                      | Hosting: Cloudflare Pages, Render free, Neon free                          | Accepted                                 |
| [006](006-no-redis.md)                     | No Redis in the MVP                                                        | Accepted                                 |
| [007](007-sse.md)                          | Server-Sent Events for push                                                | Accepted                                 |
| [008](008-outbox.md)                       | Transactional outbox                                                       | Accepted                                 |
| [009](009-shared-contracts.md)             | Shared contracts from Zod                                                  | Accepted                                 |
| [010](010-read-only-agent.md)              | The desktop agent only reads pixels and OS signals                         | Accepted                                 |
| [011](011-agent-auth.md)                   | Agent authentication by pairing code                                       | Accepted                                 |
| [012](012-session-cookie.md)               | Same-site session through the Pages proxy                                  | Accepted                                 |
| [013](013-observability.md)                | OpenTelemetry to a swappable backend                                       | Accepted                                 |
| [014](014-testing-and-mutation.md)         | Test pyramid with mutation testing                                         | Accepted                                 |
| [015](015-agent-release.md)                | Agent release pipeline                                                     | Accepted                                 |
| [016](016-windows-signing.md)              | Windows code signing via SignPath Foundation                               | Accepted                                 |
| [017](017-game-name.md)                    | Game name pattern                                                          | Accepted                                 |
| [018](018-elo-per-difficulty.md)           | ELO per character and difficulty                                           | Accepted                                 |
| [019](019-harness-l4.md)                   | Agentic harness at L4                                                      | Superseded by 029                        |
| [020](020-openapi-generated.md)            | OpenAPI generated from contracts                                           | Accepted                                 |
| [021](021-automated-phase-delivery.md)     | Automated per-phase delivery                                               | Superseded by 029                        |
| [022](022-retry-budget.md)                 | Retry budget: one attempt plus two retries, enforced by code               | Superseded by 029                        |
| [023](023-bdd-acceptance.md)               | BDD acceptance tests: Gherkin in the spec, executed by playwright-bdd      | Accepted                                 |
| [024](024-deterministic-phase-state.md)    | Deterministic phase state and idempotent resume                            | Superseded by 029                        |
| [025](025-agent-roles-and-models.md)       | Agent roles and models: Opus orchestrates, Haiku implements, Sonnet judges | Accepted; worker model superseded by 031 |
| [026](026-mutation-unit-tests-only.md)     | Mutation testing runs against unit tests only                              | Accepted                                 |
| [027](027-agent-hexagonal-architecture.md) | The desktop agent is hexagonal, like the Agents context of the backend     | Accepted                                 |
| [028](028-autonomous-delivery.md)          | Autonomous delivery and a self-maintained harness                          | Accepted; § 3–4 superseded by 029        |
| [029](029-lean-harness.md)                 | Lean harness: CI is the gate, the hooks only guard what cannot be undone   | Accepted                                 |
| [030](030-api-pull-request-previews.md)    | API pull request previews on Render, each with its own Neon branch         | Accepted                                 |
| [031](031-worker-model-switchable.md)      | Workers on Sonnet by default; the maintainer switches the model in chat    | Accepted                                 |
