# Acceptance scenarios for queues (ADR 023). English Gherkin. Executed as-is by tests/acceptance (playwright-bdd).
# Players sign in, pair an agent client that sends heartbeats, register characters through it, and open the site.
#
# not-scenario: QUE-09 — domain unit tests of the matcher (every member's level ≥ every member's minimum)
# not-scenario: QUE-16 — unit tests with in-memory span and metric exporters
# not-scenario: QUE-17 — the i18n lint; keyboard use is exercised in @QUE-15
# not-scenario: QUE-18 — application unit tests and a route integration test
# not-scenario: QUE-19 — application unit tests

Feature: Queues for PvP and leveling
  Players queue with a character and are grouped only with players they can actually play with.

  Background:
    Given these players are ready to queue, each signed in with the site open and an online agent
      | player | character | class     | level | mode     | ladder | era  | unlocked                |
      | Alice  | Sorc      | sorceress | 90    | softcore | ladder | rotw | normal, nightmare, hell |
      | Bob    | Hammer    | paladin   | 88    | softcore | ladder | rotw | normal, nightmare, hell |
      | Cara   | Zon       | amazon    | 45    | softcore | ladder | rotw | normal, nightmare       |

  @QUE-01 @FR-06 @api
  Scenario: A player joins the PvP queue
    When Alice joins the PvP queue with "Sorc" on Hell in the Americas for a GM duel
    Then the API answers 201 with a waiting ticket

  @QUE-02 @FR-07 @api
  Scenario: A player joins the leveling queue
    When Cara joins the leveling queue with "Zon" on Nightmare in the Americas for Chaos as a killer with minimum level 40
    Then the API answers 201 with a waiting ticket

  @QUE-03 @FR-09 @INV-02 @api
  Scenario Outline: A character that cannot play that difficulty is refused
    When Cara joins the <mode> queue with "Zon" on <difficulty> in the Americas <options>
    Then the API refuses with "<reason>"
    And Cara holds no ticket

    Examples:
      | mode     | difficulty | options                                          | reason              |
      | PvP      | Hell       | for a GM duel                                    | difficulty-locked   |
      | leveling | Nightmare  | for Chaos as a killer with minimum level 50      | below-minimum-level |
      | leveling | Nightmare  | for Chaos as a killer with minimum level 39      | minimum-below-floor |

  @QUE-03 @api
  Scenario: A character without declared ladder and era cannot queue
    Given Alice's agent has registered "Fresh" a level 30 softcore Sorceress with Normal unlocked
    When Alice joins the PvP queue with "Fresh" on Normal in the Americas for a GM duel
    Then the API refuses with "undeclared-character"

  @QUE-04 @api
  Scenario: Heralds outside Hell is refused
    When Alice joins the leveling queue with "Sorc" on Nightmare in the Americas for Heralds as a killer with minimum level 40
    Then the API refuses with "activity-not-available"

  @QUE-05 @FR-31 @INV-03 @api
  Scenario Outline: A player who is not fully connected cannot queue
    Given Alice <state>
    When Alice joins the PvP queue with "Sorc" on Hell in the Americas for a GM duel
    Then the API refuses with "<reason>"

    Examples:
      | state                        | reason          |
      | has her agent offline        | agent-offline   |
      | has closed the site          | site-not-open   |

  @QUE-06 @INV-04 @api
  Scenario: A player holds one ticket at a time
    Given Alice has joined the PvP queue with "Sorc" on Hell in the Americas for a GM duel
    When Alice joins the PvP queue with "Sorc" on Hell in the Americas for a BM duel
    Then the API refuses with "already-queued"

  @QUE-07 @FR-08 @INV-01 @api
  Scenario: Players in different regions are never grouped
    Given Alice has joined the PvP queue with "Sorc" on Hell in the Americas for a GM duel
    When Bob joins the PvP queue with "Hammer" on Hell in Europe for a GM duel
    And 10 minutes pass
    Then Alice and Bob are still waiting

  @QUE-08 @FR-10 @api
  Scenario: The PvP band widens with waiting time
    Given Alice has joined the PvP queue with "Sorc" on Hell in the Americas for a GM duel
    When 65 seconds pass
    Then Alice's ticket shows a band of 1400 to 1600

  @QUE-11 @QUE-12 @FR-06 @api
  Scenario: Two compatible duelists form a match and get a room
    Given Alice has joined the PvP queue with "Sorc" on Hell in the Americas for a GM duel
    When Bob joins the PvP queue with "Hammer" on Hell in the Americas for a GM duel
    Then within 2 seconds Alice and Bob are no longer queued
    And a ready check opens for Alice and Bob
    When Alice and Bob accept the ready check
    Then Alice and Bob are members of the same room, with Alice as host

  @QUE-10 @FR-11 @api
  Scenario: A leveling group takes the teleporter and the BO when the pool has them
    Given 9 players with Hell characters at level 80 have joined the leveling queue for Baal in the Americas, one as teleporter, one as BO and the rest as killers
    When the matcher runs
    Then a ready check opens for a group of 8 with the teleporter and the BO in it
    When the eight members accept the ready check
    Then their room has the teleporter as host and the BO in it

  @QUE-13 @api
  Scenario: A player leaves the queue
    Given Alice has joined the PvP queue with "Sorc" on Hell in the Americas for a GM duel
    When Alice leaves the queue
    Then the API answers 204
    And Alice holds no ticket

  @QUE-14 @FR-31 @web
  Scenario: A queued player whose agent goes offline leaves the queue
    Given Alice has joined the PvP queue with "Sorc" on Hell in the Americas for a GM duel
    When Alice's agent stops sending heartbeats for 45 seconds
    Then Alice holds no ticket
    And Alice's site shows "You left the queue: your agent went offline."

  @QUE-15 @FR-06 @FR-09 @NFR-13 @web
  Scenario: The site queues a player and shows the wait, by keyboard only
    When Cara opens the site and, using only the keyboard, chooses PvP, "Zon" and the Americas
    Then Hell is disabled with "Locked on this character"
    When Cara chooses Nightmare, a GM duel and "Find match"
    Then within 2 seconds the site shows the time waited, the band and "Leave queue"
