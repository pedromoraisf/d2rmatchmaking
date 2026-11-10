# Acceptance scenarios for characters-reading (ADR 023). The agent is the headless agent with a fixture screen; its text
# reader returns the fixture's sidecar text (Linux has no OCR). Windows OCR on the real screenshots is proved by Rust
# tests in the Windows CI job.
#
# not-scenario: CHR-08 — Rust tests that read the English and Portuguese fixtures with Windows OCR in the Windows CI job

Feature: The agent reads the character selection screen
  A player opens the character selection screen with the agent running and the site learns their characters.

  Background:
    Given "Alice" is signed in and has a paired agent

  @CHR-15 @NFR-04 @NFR-05 @agent
  Scenario: Without consent the agent reads nothing; with consent it does
    Given Alice's agent has no capture consent
    When the game shows the character selection screen fixture "select-titles"
    Then the site shows the agent's screen as "Unknown"
    And the site shows no characters for Alice
    When Alice gives capture consent in the agent's window
    Then the site lists the characters of the fixture "select-titles" within 2 seconds

  @CHR-04 @FR-05 @agent
  Scenario Outline: The agent reports the screen it sees
    Given Alice's agent has capture consent
    When the game shows the fixture "<shot>"
    Then the site shows the agent's screen as "<label>"

    Examples:
      | shot          | label               |
      | select-normal | Character selection |
      | in-game       | In game             |
      | automap       | Automap open        |
      | menu          | Unknown             |

  @CHR-06 @FR-02 @agent
  Scenario: Every complete card on the screen is registered
    Given Alice's agent has capture consent
    When the game shows the character selection screen fixture "select-full"
    Then the site lists every character of that fixture with its fields

  @CHR-06 @FR-02 @agent
  Scenario: A card the agent could not read completely is not registered
    Given Alice's agent has capture consent
    When the game shows the character selection screen fixture "select-full" with one card's level unreadable
    Then the site lists every other character of that fixture
    And the site does not list the character whose level was unreadable
