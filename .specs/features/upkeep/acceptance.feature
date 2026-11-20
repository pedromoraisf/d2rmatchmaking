# Acceptance scenarios for upkeep (ADR 023). English Gherkin. Executed as-is by tests/acceptance (playwright-bdd).
# not-scenario: UPK-01 — proved by Rust unit tests in the adapters (the generated type parses the event) and the xtask contracts_are_current test
# not-scenario: UPK-04 — proved by unit tests of projectStreamEvent (delivery order, and the lookups run together)
# not-scenario: UPK-05 — proved by unit tests of the nightly report scripts
# not-scenario: UPK-06 — proved by unit tests of the load script and the nightly workflow
# not-scenario: UPK-08 — proved by a unit test that reads the committed reading-modules.json
# not-scenario: UPK-09 — proved by an API unit test of the match-refused branch and the ADR text
# not-scenario: UPK-10 — proved by the acceptance support unit tests (ports, stack, drift)
# not-scenario: UPK-11 — proved by the gates of each dependency group and the closed pull requests

Feature: Upkeep hardening a player can observe
  A runaway client cannot hammer the agent-status and ready-check routes, normal use never meets the limit, and the
  queue panel draws a locked difficulty cleanly.

  @UPK-02 @FR-05 @api
  Scenario: A client that reads the agent status in a loop is limited
    Given Alice has a paired agent
    When Alice's client reads her agent status 61 times within a minute
    Then the 61st read is refused as rate-limited with the seconds to wait
    And Bob's read of his own agent status is still answered

  @UPK-02 @FR-05 @api
  Scenario: The agent status is answered again once the minute has passed
    Given Alice has a paired agent
    And Alice's client was refused as rate-limited reading her agent status
    When a minute passes
    Then Alice's client reads her agent status again

  @UPK-03 @FR-12 @api
  Scenario: A client that reads the ready check in a loop is limited
    Given Alice and Bob have an open ready check
    When Alice's client asks for her open ready check 61 times within a minute
    Then the 61st request is refused as rate-limited with the seconds to wait
    And Bob can still accept the ready check

  @UPK-03 @FR-12 @api
  Scenario: Alice's agent and her site share the ready-check window
    Given Alice and Bob have an open ready check
    And Alice's agent has asked for the open ready check 60 times within a minute
    When Alice's site asks for her open ready check
    Then the request is refused as rate-limited with the seconds to wait

  @UPK-07 @FR-09 @NFR-13 @web
  Scenario: The queue panel draws "Locked on this character" below the difficulty name
    Given Cara has a Zon character that has not unlocked Hell
    When Cara opens the queue panel and chooses PvP and "Zon"
    Then "Locked on this character" is drawn below the name "Hell" and does not overlap it
