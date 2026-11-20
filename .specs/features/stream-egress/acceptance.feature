# Acceptance scenarios for stream-egress (ADR 023). English Gherkin. Executed as-is by tests/acceptance (playwright-bdd).
# not-scenario: SEG-02 — proved by unit tests on the load summary and the summary of a load run
# not-scenario: SEG-03 — proved by stream-events.md in review, the regenerated asyncapi.json and one unit test per trimmed event
# not-scenario: SEG-06 — proved by unit tests on the journey state and the load summary
# not-scenario: SEG-07 — proved by unit tests on the summary and full-summary.check.mjs on a full run
# not-scenario: SEG-08 — proved by unit tests in scripts/nightly on fixtures with and without a previous report
# not-scenario: SEG-09 — proved by the last PR description and decisions.md (two full load runs)

Feature: A player-hour costs few bytes, and the site still says when the agent goes away
  The free server has 5 GB of egress a month for 100 players at once. The streams carry what each side reads, and the
  site learns that an agent is gone from the server instead of asking every few seconds.

  @SEG-01 @NFR-14 @api
  Scenario: The agent hears that its room ended without the member list
    Given a room of two players whose host has an agent online
    When the room expires
    Then the host's agent is told the room and that it expired
    And that message carries no member list
    And the host's site still gets the room's new stage with its members

  @SEG-04 @NFR-14 @api
  Scenario: The site is told when an agent goes quiet
    Given a player whose agent is online and whose site is watching
    When the agent sends no heartbeat for 60 seconds
    Then the site is told once that the agent is offline
    And the agent is not told anything

  @SEG-05 @NFR-14 @web
  Scenario: The site stops asking about the agent every few seconds
    Given a signed-in player whose site shows the agent online
    When ten minutes pass with the page in view
    Then the site has asked about the agent at most two times

  @SEG-05 @NFR-14 @web
  Scenario: The site does not ask about the agent while the page is hidden
    Given a signed-in player whose site shows the agent online
    When ten minutes pass with the page hidden
    Then the site has not asked about the agent
