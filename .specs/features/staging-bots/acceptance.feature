# Acceptance scenarios for staging-bots (ADR 023), DRAFT (batch 0). The bots run on the acceptance stack, which has the
# staging endpoints on; production is proven by integration tests, not by Gherkin.
#
# not-scenario: SBT-01 — unit tests on the input plan and a harness test on the workflow's inputs
# not-scenario: SBT-02 — unit tests with production-shaped fake APIs
# not-scenario: SBT-03 — API integration test on the production settings, the route-table test and the `refusalOf` test
# not-scenario: SBT-04 — unit tests on the name builder; the security reviewer reads the threat model
# not-scenario: SBT-08 — unit tests (bounds, back-off) and a harness test (timeout, concurrency)
# not-scenario: SBT-11 — unit test: the log and the summary of a full run hold no token or cookie value
# not-scenario: SBT-12 — harness test on the workflow file
# not-scenario: SBT-13 — the runbook exists (`pnpm specs:check`)

Feature: Bots that fill a staging group
  One player alone on staging reaches a ready check and a room, because synthetic players queue with them.

  Background:
    Given Alice is ready to queue for a GM duel on Hell in the Americas
    And a bot is ready to queue for the same duel

  @SBT-05 @SBT-06 @FR-12 @web
  Scenario: A bot is a paired, online player in the same bucket
    When the bot has joined that queue
    Then the bot has a paired agent that is online
    And the bot's character is declared with the ladder and era of Alice's character

  @SBT-06 @SBT-07 @FR-12 @web
  Scenario: Alice joins and the bot accepts the ready check
    Given the bot has joined that queue
    When Alice joins that queue
    And the matcher runs
    Then Alice's site shows a ready check with the bot among its members
    And within 10 seconds the bot has accepted

  @SBT-07 @FR-16 @web
  Scenario: The bot's agent confirms presence in the room
    Given Alice and the bot have formed a match
    When Alice accepts on the site
    Then a room opens for Alice and the bot
    And the bot's agent posts the room's game name and the bot is confirmed

  @SBT-09 @FR-16 @web
  Scenario: The site shows the bot as a bot
    Given Alice and the bot have formed a match
    When Alice accepts on the site
    Then Alice's site shows the bot's name with a "Bot" badge
    And Alice's own name has no badge

  @SBT-10 @web
  Scenario: The bot leaves when the room ends
    Given Alice and the bot are in a room
    When Alice closes the room
    Then the bot has left and its agent token no longer works
