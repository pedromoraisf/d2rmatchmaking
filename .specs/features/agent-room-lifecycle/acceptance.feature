# Acceptance scenarios for agent-room-lifecycle (ADR 023). English Gherkin. Executed as-is by tests/acceptance (playwright-bdd).
# not-scenario: ARL-02 — proved by Rust unit tests in core (a reconnect re-reads the assignment and drops an ended room)
# not-scenario: ARL-04 — proved by Rust unit tests on the window view (a new run returns to waiting with the new name)
# not-scenario: ARL-07 — proved by Rust unit tests with the in-memory span exporter and the locales tests

Feature: The agent and the site follow the room's life
  A player trusts what the agent window and the site say: a room that ended disappears, and a confirmed presence is
  shown as confirmed.

  @ARL-01 @FR-17 @api
  Scenario: The agent drops a room that expired
    Given Alice and Bob are in a room awaiting the host, with their agents online
    When the host does not create the game in time and the room expires
    Then Bob's agent no longer holds a room

  @ARL-01 @FR-17 @api
  Scenario: The agent drops a room the host closed
    Given Alice and Bob are in an active room, with their agents online
    When the host closes the room on the site
    Then Bob's agent no longer holds a room

  @ARL-03 @FR-16 @api
  Scenario: The agent shows presence confirmed once its observation is accepted
    Given Alice is the host of a room awaiting the host, with her agent online
    When Alice's agent sees the game name of the current run
    Then Alice's agent shows the room as presence confirmed

  @ARL-05 @FR-17 @web
  Scenario: A dismissed ended room stays dismissed after a reload
    Given Alice's room expired and the site shows it as ended
    When Alice dismisses the room and reloads the site
    Then the site does not show the ended room

  @ARL-06 @FR-05 @web
  Scenario: The site does not keep an agent online after its stream reconnects
    Given Alice has the site open and her agent online
    When the site's stream reconnects and the agent stops sending heartbeats
    Then the site shows the agent offline within 60 seconds

  @ARL-08 @ARL-09 @ARL-10 @ARL-11 @FR-17 @agent
  Scenario: The host who moves to another game is shown in another game
    Given Alice hosts a room "mmbaalh-28" with Bob, and her headless agent confirmed her presence
    When Alice's agent reads the game name "duels" in the Party panel on two looks in a row
    Then Alice's agent window says she is in another game
    And Bob's site shows Alice "In another game"
    And the room is still "Created"
    And no observation carried the name "duels"

  @ARL-08 @FR-17 @agent
  Scenario: A misread of the room's own name is not another game
    Given Alice hosts a room "mmbaalh-28" with Bob, and her headless agent confirmed her presence
    When Alice's agent reads the game name "mmbaa1h-28" in the Party panel on two looks in a row
    Then Alice's agent window still says presence confirmed

  @ARL-08 @ARL-10 @ARL-11 @FR-17 @agent
  Scenario: Coming back to the room's game confirms again
    Given Alice's headless agent shows her in another game for her room "mmbaalh-28"
    When Alice's agent reads the game name "mmbaalh-28" in the Party panel
    Then Bob's site shows Alice "Confirmed by the agent"
