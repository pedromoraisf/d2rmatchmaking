# Acceptance scenarios for observability-tiers (ADR 023). English Gherkin. Executed as-is by tests/acceptance (playwright-bdd).
# not-scenario: OBT-18 — proved by the API unit test on loadConfig (an unset or empty D2RMM_ENV is the production tier)
# not-scenario: OBT-02 — proved by unit tests on each app's resource builder
# not-scenario: OBT-05 — proved by Rust unit tests on the export config and the sanitizer (the Windows agent is not in the acceptance stack)
# not-scenario: OBT-06 — proved by Rust unit tests on the sanitizer in the full tier
# not-scenario: OBT-07 — proved by site unit tests on the telemetry start and the span attributes
# not-scenario: OBT-08 — proved by one pure redaction function per app with unit tests in both tiers
# not-scenario: OBT-09 — proved by the API name-leak integration tests run in both tiers
# not-scenario: OBT-10 — proved by a harness test with a fixture that sets a staging-only key outside the tier module
# not-scenario: OBT-11 — proved by the existing redaction tests, run in both tiers
# not-scenario: OBT-14 — proved by the agent window component test (en, pt-BR); the agent window is not in the acceptance stack
# not-scenario: OBT-15 — proved by Rust unit tests on the settings store
# not-scenario: OBT-16 — proved by Rust unit tests: switch off, the exporter and the relay client are never called
# not-scenario: OBT-17 — proved by the source rule `diagnosticsSwitchViolations` in scripts/test/agent-source-rules.test.mjs: the switch is read only by the span processor and the export loop
# not-scenario: OBT-13 — proved by telemetry.md in review and the TraceQL query run once on grafanacloud-traces

Feature: A field test can be followed in the traces, and production traces name nobody
  On staging every span says which account, room and read it is about, so a field test is debugged from the traces.
  In production the spans keep the ids and the game data, and never a person's name or text read from the screen.

  @OBT-01 @NFR-09 @api
  Scenario Outline: The API tells the site which telemetry tier it runs in
    Given the API runs as "<environment>"
    When the site loads its start configuration
    Then the site is told the telemetry tier "<tier>"

    Examples:
      | environment | tier       |
      | staging     | full       |
      | production  | production |

  @OBT-03 @NFR-09 @slow @web
  Scenario: A room's spans carry the ids of its journey in production
    Given the telemetry backend is running locally
    And the API runs as "production"
    When "PlayerOne" starts a test match on the site
    Then the API's spans of that journey carry the account, ticket and room ids
    And none of those spans carries a BattleTag or a character name

  @OBT-04 @NFR-09 @slow @web
  Scenario: On staging the same spans also carry the player's names
    Given the telemetry backend is running locally
    And the API runs as "staging"
    When "PlayerOne" starts a test match on the site
    Then the API's spans of that journey carry the account, ticket and room ids
    And the spans of that journey carry the player's BattleTag

  @OBT-12 @NFR-12 @web
  Scenario: A staging visitor is told that everything is recorded
    Given the API runs as "staging"
    When a visitor opens the site
    Then the site says that everything done here is recorded for debugging

  @OBT-12 @NFR-12 @web
  Scenario: A production visitor sees no recording notice
    Given the API runs as "production"
    When a visitor opens the site
    Then the site shows no recording notice
