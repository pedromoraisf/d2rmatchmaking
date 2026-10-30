# Acceptance scenarios for <feature> (ADR 023). English Gherkin. Executed as-is by tests/acceptance (playwright-bdd).
# Rules: every requirement ID in spec.md "## Requirement Traceability" is tagged on at least one scenario, or has a
#   "# not-scenario: <ID> — <how it is proved instead>" line (e.g. a load test). No @skip/@only/@fixme/@wip.
# Write what a player or the agent does and observes — no selectors, URLs or internal ids.

Feature: <capability in the player's words>
  <one or two lines of context: who benefits and why>

  # not-scenario: <ID> — <proved by …>

  Background:
    Given <shared starting state>

  @<REQ-ID> @FR-<nn> @INV-<nn> @web
  Scenario: <observable behaviour in one sentence>
    Given <state>
    When <single action under test>
    Then <observable outcome, with a limit when the spec states one>

  @<REQ-ID> @api
  Scenario Outline: <rule with several examples>
    Given <state with "<param>">
    When <action>
    Then <outcome "<expected>">

    Examples:
      | param | expected |
      | …     | …        |
