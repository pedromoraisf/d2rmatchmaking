# Acceptance scenarios for screen-recognition (ADR 023). English Gherkin. Executed as-is by tests/acceptance (playwright-bdd).
# The agent is the headless agent with a drawn fixture screen (xtask draws it; no capture is ever committed); its text reader
# returns the fixture's sidecar text, because Linux has no OCR. How well the real font is read is proved elsewhere.
# not-scenario: SCR-02 — proved by Rust unit tests on the tracker and the core reader (which areas are read after a find and after a miss)
# not-scenario: SCR-04 — proved by Rust unit tests at three client heights and by `ocr-real` on the twelve real prints (CI, Windows)
# not-scenario: SCR-05 — proved by the `ocr-variations` ratchet on the real prints (correct floor, wrong ceiling) and by unit tests
# not-scenario: SCR-06 — proved by `ocr-real` (twelve prints) and the `ocr-variations` counts in the pull request (CI, Windows)
# not-scenario: SCR-09 — proved by a source-rule test (no frame or text in a span) and unit tests with the in-memory exporter

Feature: The agent recognises the screen the player is on
  A player plays in a window, borderless or full screen, and the site shows the screen the agent sees, with no game
  configuration.

  Background:
    Given "Alice" is signed in and has a paired agent

  @SCR-01 @SCR-07 @FR-05 @NFR-03 @agent
  Scenario Outline: The in-game screen is recognised in every window mode
    Given Alice's agent has capture consent and no room
    When the game shows the fixture "<shot>"
    Then the site shows the agent's screen as "In game"

    Examples:
      | shot                  |
      | in-game-window        |
      | in-game-fullscreen    |
      | in-game-mana-only     |
      | in-game-low-brightness |

  @SCR-03 @SCR-07 @FR-05 @NFR-03 @agent
  Scenario Outline: The open automap is recognised in every window mode
    Given Alice's agent has capture consent and no room
    When the game shows the fixture "<shot>"
    Then the site shows the agent's screen as "Automap open"

    Examples:
      | shot                |
      | automap-window      |
      | automap-fullscreen  |

  @SCR-01 @FR-05 @agent
  Scenario: Other text at the bottom of the screen is not the game
    Given Alice's agent has capture consent and no room
    When the game shows the fixture "bottom-text-only"
    Then the site shows the agent's screen as "Unknown"

  @SCR-08 @FR-05 @NFR-03 @agent
  Scenario: A client size the agent does not support shows an unknown screen
    Given Alice's agent has capture consent and no room
    When the game shows the fixture "in-game-unsupported-size"
    Then the site shows the agent's screen as "Unknown"

  @SCR-08 @FR-05 @NFR-04 @agent
  Scenario: Without consent the agent reads no screen, with consent it does
    Given Alice's agent has no capture consent
    When the game shows the fixture "in-game-window"
    Then the site shows the agent's screen as "Unknown"
    When Alice gives capture consent in the agent's window
    Then the site shows the agent's screen as "In game"

  @SCR-08 @FR-05 @agent
  Scenario: The selection screen is never read as the game
    Given Alice's agent has capture consent and no room
    When the game shows the fixture "select-with-hud-text"
    Then the site shows the agent's screen as "Character selection"
