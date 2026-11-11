# Acceptance scenarios for agent-game-name (ADR 023). The agent is the headless agent with drawn Party panel fixtures;
# its text reader returns each fixture's sidecar text (Linux has no OCR). Windows OCR on the maintainer's screenshots
# is proved by Rust tests in the Windows CI job.
#
# not-scenario: AGN-01 — Rust unit tests of the core loop with fakes (consent, game running, assignment, one frame a second)
# not-scenario: AGN-02 — Rust unit tests of the relative regions; the Windows OCR test on the maintainer's screenshots
# not-scenario: AGN-06 — Rust unit test of the release wiring; release builds never enable fixture-read
# not-scenario: AGN-07 — Rust unit tests on the observation payload and the span attributes
# not-scenario: AGN-08 — the agent window's i18n lint

Feature: The agent confirms presence by reading the game name in the Party panel
  The host creates the game and every member opens the Party panel and shows the game name; their agents read it and
  the room learns who is in.

  Background:
    Given "Alice" has started a test match with a paired agent
    And Alice's agent has capture consent

  @AGN-03 @FR-16 @agent
  Scenario: The revealed game name of the room is reported
    When the game shows the Party panel with the room's game name revealed
    Then the room becomes Created within 2 seconds

  @AGN-03 @FR-16 @agent
  Scenario: Another game's name is not reported
    When the game shows the Party panel with the game name "mmbaalh-999" revealed
    Then the room is still Awaiting host

  @AGN-04 @FR-16 @agent
  Scenario: A masked game name is not reported and the agent tells the player what to do
    When the game shows the Party panel with the game name masked
    Then the room is still Awaiting host
    And the agent tells the player "Open the Party panel (P) and click the eye to show the game name."

  @AGN-05 @FR-18 @agent
  Scenario: The next run is read with its new name
    Given the room is Active on run 1
    When the host opens the next run
    And the game shows the Party panel with the new run's game name revealed
    Then the agent reports the new run's game name once
