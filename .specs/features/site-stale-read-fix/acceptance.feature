# Acceptance scenarios for site-stale-read-fix (ADR 023). English Gherkin. Executed as-is by tests/acceptance
# (playwright-bdd). The browser's answer about the room is held, so the order of the race is fixed, not left to timing.
# A slow answer is the server's real answer, taken before the agent reports, so it says the room is awaiting the host.

Feature: A late answer does not undo what the stream delivered
  The site reads the room when its stream opens. If the room changes while that read is on its way, the older answer
  must not put the room back on its old stage.

  Background:
    Given "PlayerOne" is signed in on the site
    And "PlayerOne" has started a test match with a paired agent

  @SSR-01 @SSR-02 @NFR-01 @web
  Scenario: A late answer does not put the room back on its old stage
    Given the site is waiting for a slow answer that says the room is awaiting the host
    When the agent reports seeing the game name of the room
    Then within 2 seconds the site shows the room as "Created"
    When the slow answer about the room arrives
    Then the site reads the room again
    And the site shows the room as "Created"

  # The slow answer here is the read the site makes before it opens its stream. The room changes before the stream
  # opens, so no event reaches the site: only the read on stream open can show it, and a site that ignored that answer
  # would read a second time.
  @SSR-03 @web
  Scenario: A read with no event during it shows its answer
    Given the site's read before its stream opens has a slow answer that says the room is awaiting the host
    And the agent has reported seeing the game name of the room
    When the slow answer about the room arrives
    Then the site shows the room as "Created"
    And the site read the room exactly once after its stream opened

  @SSR-05 @web
  Scenario: A read that answers no room clears the room
    Given the site shows the room as "Awaiting host"
    And the read on the next stream open will answer that there is no room
    When "PlayerOne" reloads the site
    Then the site shows no room

  # The new read fails here, so only ignoring the late answer leaves "Created" on screen.
  @SSR-01 @SSR-04 @NFR-01 @web
  Scenario: A failed read keeps the stage the stream delivered
    Given the site is waiting for a slow answer that says the room is awaiting the host
    And the read after the slow answer will fail with a server error
    When the agent reports seeing the game name of the room
    Then within 2 seconds the site shows the room as "Created"
    When the slow answer about the room arrives
    Then the site reads the room again
    And the site shows the room as "Created"
