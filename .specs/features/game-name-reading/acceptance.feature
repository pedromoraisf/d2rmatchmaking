# Acceptance scenarios for game-name-reading (ADR 023). English Gherkin. Executed as-is by tests/acceptance (playwright-bdd).
# The agent is the headless agent with drawn fixtures (xtask draws them; no capture is ever committed); its text reader
# returns each fixture's sidecar text, because Linux has no OCR. How well the real font is read is proved elsewhere:
# `ocr-real`, `ocr-variations` and unit tests, never Gherkin.
#
# not-scenario: GNR-01 — proved by `ocr-real` on the seven generated-name prints and the `ocr-variations` share correct (CI, Windows)
# not-scenario: GNR-03 — proved by Rust unit tests per glyph, each naming the real-print read that taught it
# not-scenario: GNR-04 — proved by Rust unit tests over the vocabulary and the `agent-game-name-drift` harness test
# not-scenario: GNR-05 — proved by the `ocr-variations` summary before and after, by reason class, in the pull request
# not-scenario: GNR-07 — proved by Rust unit tests on drawn chat fixtures and `ocr-real` on the English and Portuguese chat prints
# not-scenario: GNR-08 — moved to server-name-match (posting chat events with a player name); this feature posts none
# not-scenario: GNR-09 — proved by `ocr-real` on the `n` and `m` prints, unit tests per code, `@LBR-01` naming scenarios, and the maintainer's live rooms
# not-scenario: GNR-10 — proved by a source-rule test (no name in a span, log or label) and unit tests with the in-memory exporter
# not-scenario: GNR-11 — proved by `ocr-real` (every print of the zip) and the `ocr-variations` counts in the pull request (CI, Windows)

Feature: The agent reads the room's game name and the chat messages of its game
  The host and the members show their game; the agents read the name in the Party panel or on the automap and the
  joined and left messages in the chat, and the room learns who is in.

  Background:
    Given "Alice" has started a test match with a paired agent
    And Alice's agent has capture consent

  @GNR-02 @FR-16 @INV-06 @agent
  Scenario Outline: A name that differs from the room's only in its difficulty code is not reported
    When the game shows the Party panel with the room's game name but the difficulty code "<code>"
    Then the room is still Awaiting host

    Examples:
      | code |
      | n    |
      | m    |

  @GNR-06 @FR-27 @FR-16 @agent
  Scenario: The room's game name on the automap is reported
    When the game shows the automap with the room's game name
    Then the room becomes Created within 2 seconds

  @GNR-06 @FR-27 @FR-16 @agent
  Scenario: Another game's name on the automap is not reported
    When the game shows the automap with the game name "mmbaalh-999"
    Then the room is still Awaiting host

  @GNR-06 @FR-27 @agent
  Scenario: A name seen in the Party panel and on the automap is reported once
    When the game shows the Party panel with the room's game name revealed
    And the game shows the automap with the room's game name
    Then the agent has reported the room's game name once
