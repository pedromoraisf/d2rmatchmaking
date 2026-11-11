# Acceptance scenarios for ready-check (ADR 023). Players are signed in with the site open, an online agent (the suite's
# agent client, or the headless agent for the hotkey) and declared characters; the stack's clock moves the time.
#
# not-scenario: RDY-09 — integration test: a penalty survives an API restart
# not-scenario: RDY-10 — unit tests with in-memory exporters and the i18n lint

Feature: Ready check before a room opens
  Every member confirms within a minute, on the site or with the agent's hotkey, before the room is created.

  Background:
    Given Alice and Bob are ready to queue for a GM duel on Hell in the Americas
    And Alice and Bob have joined that queue

  @RDY-01 @FR-12 @web
  Scenario: A formed group gets a one-minute ready check
    Then within 2 seconds both sites show a ready check that ends 60 seconds after it opened
    And no room exists for Alice or Bob yet

  @RDY-02 @RDY-03 @FR-12 @web
  Scenario: When everyone accepts the room opens
    When Alice accepts on the site
    Then Bob's site shows that one member accepted
    When Bob accepts on the site
    Then Alice and Bob are members of the same room within 2 seconds

  @RDY-04 @FR-13 @INV-05 @api
  Scenario: Declining ends the check without a penalty and puts the others back first
    Given Cara has joined the same queue after Alice and Bob
    When Alice accepts on the site
    And Bob declines
    Then the ready check ends as failed
    And Bob holds no ticket and can join the queue again at once
    And Alice is waiting in the queue ahead of Cara

  @RDY-05 @FR-13 @INV-05 @api
  Scenario: Not answering gives a five-minute wait
    When Alice accepts on the site
    And 60 seconds pass
    Then the ready check ends as failed
    And Bob cannot join the queue, refused with "ready-check-penalty"
    And after 5 more minutes Bob can join the queue again
    And Alice is waiting in the queue

  @RDY-06 @api
  Scenario Outline: A late, repeated or foreign answer changes nothing
    Given <situation>
    When <who> answers that ready check
    Then the answer is "<status>"

    Examples:
      | situation                               | who   | status |
      | the ready check has ended               | Alice | 409    |
      | Alice has already accepted              | Alice | 409    |
      | Cara is not a member of the ready check | Cara  | 404    |

  @RDY-07 @FR-12 @agent
  Scenario: The agent's hotkey accepts
    Given Alice's agent is the headless agent
    When Alice presses the agent's accept hotkey
    Then Alice's acceptance is recorded within 2 seconds
    And the agent sent nothing to the game

  @RDY-08 @FR-12 @NFR-13 @web
  Scenario: The site's ready check works by keyboard
    Then Alice's site shows the ready check with the focus on "Accept"
    And it says that declining has no penalty and that not answering gives a 5-minute wait
    When Alice presses Enter
    Then Alice's acceptance is recorded within 2 seconds
