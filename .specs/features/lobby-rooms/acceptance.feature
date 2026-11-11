# Acceptance scenarios for lobby-rooms (ADR 023). Players come from a duel or a leveling group formed by queues and the
# ready check, each with an online headless agent reading drawn Party fixtures; the stack's clock moves the time.
#
# not-scenario: LBR-11 — the 2-second limits asserted in @LBR-03 and @LBR-04
# not-scenario: LBR-13 — unit tests with in-memory exporters

Feature: Rooms from formed group to finished runs
  The group gets a room with a host and a public game name; agents confirm who is in; runs follow one another.

  Background:
    Given Alice and Bob accepted a ready check for a GM duel on Hell in the Americas, Alice first
    And each has a headless agent with capture consent

  @LBR-01 @FR-14 @INV-08 @api
  Scenario: The room opens with a host, a game name and no password
    When Alice and Bob read their room
    Then Alice and Bob are in a room with Alice as host
    And the room's game name matches "mmpvph-<n>" and it has no password

  @LBR-02 @FR-15 @agent
  Scenario: The room waits for the host once the host's agent has the assignment
    When Alice's agent has fetched the room assignment
    Then the room is Awaiting host

  @LBR-03 @FR-16 @INV-06 @agent
  Scenario: The host's agent confirms the game was created
    Given the room is Awaiting host
    When Alice's game shows the Party panel with the room's game name revealed
    Then within 2 seconds both sites show the room Created and Alice confirmed

  @LBR-04 @FR-16 @INV-06 @agent
  Scenario: The room becomes Active when every member is confirmed
    Given the room is Created
    When Bob's game shows the Party panel with the room's game name revealed
    Then within 2 seconds both sites show the room Active and both members confirmed

  @LBR-05 @FR-17 @INV-07 @api
  Scenario: The room expires when the host does not create the game in 3 minutes
    Given the room is Awaiting host
    When 3 minutes pass
    Then the room is Expired
    And Alice and Bob can join a queue again

  @LBR-06 @FR-18 @agent
  Scenario: The next run opens with a new name and the agents read it
    Given the room is Active on run 1
    When Alice opens the next run on the site
    Then both sites show run 2 with a new game name and the room Awaiting host
    When Alice's game shows the Party panel with the new run's game name revealed
    Then the room is Created on run 2

  @LBR-07 @FR-32 @INV-12 @web
  Scenario: The host leaves and the role passes on
    Given Cara joined the room third
    When Alice leaves the room on the site
    Then Bob is the host
    And Cara's site shows Bob as host

  @LBR-08 @FR-32 @INV-12 @api
  Scenario: A member whose agent stays offline leaves the room
    Given the room is Active
    When Bob's agent stops sending heartbeats for 105 seconds
    Then Bob is no longer in the room
    And Alice's site shows that Bob left

  @LBR-09 @FR-15 @web
  Scenario: The host closes the room
    When Alice closes the room on the site
    Then the room is Closed
    And Bob can join a queue again

  @LBR-10 @INV-04 @api
  Scenario: A member of an open room cannot queue
    When Bob joins the PvP queue with his character on Hell in the Americas for a GM duel
    Then the API refuses with "in-room"

  @LBR-12 @NFR-13 @web
  Scenario: The room panel shows what to do, by keyboard
    When Bob opens the site
    Then he sees the stages Formed, Awaiting host, Created and Active, the game name with a copy button and "No password"
    And he sees that Alice creates a public game and that he opens the Party panel and clicks the eye after joining
    And using only the keyboard he can copy the game name and reach "Leave room"
