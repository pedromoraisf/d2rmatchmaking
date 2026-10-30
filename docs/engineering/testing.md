# Testing

| Level                | Tool                                                                            | Where                             | Runs                                        |
| -------------------- | ------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------- |
| Unit                 | Vitest; `cargo nextest` + `insta`                                               | next to code                      | on edit (related), pre-commit (related), CI |
| Integration          | Vitest + Testcontainers (Postgres)                                              | `apps/api/test/integration`       | CI                                          |
| Contract             | Zod → JSON Schema snapshot; OpenAPI/AsyncAPI drift                              | `packages/contracts`              | Stop hook, CI                               |
| Acceptance (BDD)     | playwright-bdd running `.specs/features/*/acceptance.feature` (English Gherkin) | steps in `tests/acceptance/steps` | proofs, CI integration job (ADR 023)        |
| End to end (non-BDD) | Playwright                                                                      | `apps/web/e2e`                    | CI                                          |
| Load                 | k6 (+ SSE extension)                                                            | `tests/load`                      | phase review, on demand (NFR-14)            |
| Mutation             | StrykerJS (domain ≥ 80%, application ≥ 70%); cargo-mutants (agent core ≥ 70%)   | per workspace                     | incremental on PR, full nightly             |

Rules:

0. The highest level is BDD: every requirement ID of a feature has a Gherkin scenario in its `acceptance.feature`,
   approved with the spec and executed as-is. `pnpm acceptance:check` enforces coverage and hygiene.
1. Tests come from acceptance criteria (TLC); name them after the behaviour (`expires the room when the host does not create the game in 3 minutes`).
2. Fakes over mocks for ports we own (`FakeClock`, `InMemoryQueueStore`). Mock only third-party edges.
3. Never delete, skip or loosen a test to pass a gate — the gate hook escalates it.
4. Every domain invariant (`docs/domain/invariants.md`) has a test that names its ID.
5. OCR and capture use recorded fixtures (`apps/agent/fixtures/`), never live game screens in CI.
6. Floors live in `.quality-baseline.json` and only tighten.
