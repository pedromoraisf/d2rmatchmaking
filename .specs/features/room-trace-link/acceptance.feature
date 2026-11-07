# Acceptance scenarios for room-trace-link (ADR 023). English Gherkin. Executed as-is by tests/acceptance
# (playwright-bdd) against the local telemetry backend (AD-088).

Feature: The agent's trace of a room leads to the match that opened it
  A room leaves one trace for the match that opened it and one for the agent's observation. The maintainer can follow
  a link from the agent's trace to the match's trace.

  # not-scenario: RTL-01 — the stored context is internal; proved by an application test with an in-memory span exporter that opens a room inside a span and reads the room's stored traceparent, equal to that span's
  # not-scenario: RTL-02 — the branch with no active span has nothing to observe; proved by an application test that opens a room with no span active and reads no stored traceparent
  # not-scenario: RTL-03 — the link's ids are checked end to end by the scenario below; an application test with an in-memory span exporter proves exactly one link and its trace id and span id
  # not-scenario: RTL-04 — a room with no stored context is production today and changes nothing a player sees; proved by an application test that records an observation for such a room and asserts no link and the same answer
  # not-scenario: RTL-05 — a broken stored value is internal; proved by an application test with a malformed traceparent that asserts no link and the same answer
  # not-scenario: RTL-06 — the 403 is unchanged; proved by an application test with a stranger's agent that asserts 403 and no link
  # not-scenario: RTL-07 — contract drift is a build rule; proved by `pnpm contracts:openapi` leaving no diff and by a test that the room's stream and HTTP views carry no traceparent field
  # not-scenario: RTL-08 — a migration is internal; proved by a Testcontainers integration test that applies the migrations, reads a room written without a traceparent as having none, and stores and reads one

  @RTL-09 @NFR-09 @slow @web
  Scenario: The agent's observation links to the trace of the test match
    Given the telemetry backend is running locally
    And "PlayerOne" is signed in on the site
    And "PlayerOne" has a paired agent that is online
    When "PlayerOne" starts a test match on the site
    Then the site shows the room as "Awaiting host"
    Given the headless agent core is running with a fixture screen
    When the agent reports the game name of the room
    Then the site shows the room as "Created" within 2 seconds
    And the telemetry backend holds, within 30 seconds, the trace whose root is the agent's observation span
    And its "lobby.record-observation" span links to the trace whose root is the site's test match action
