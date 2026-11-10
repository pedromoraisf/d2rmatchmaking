# Acceptance scenarios for characters (ADR 023). English Gherkin. Executed as-is by tests/acceptance (playwright-bdd).
# The agent is the headless agent with a fixture screen; its text reader returns the fixture's sidecar text (Linux has
# no OCR). The real OCR on real screenshots is proved by Rust tests on Windows CI.
#
# not-scenario: CHR-03 — Rust unit tests on the window lookup and the crop, and a Windows CI test that captures a test window
# not-scenario: CHR-07 — Rust unit tests of the title table, every title of both genders, classic and expansion, SC and HC
# not-scenario: CHR-08 — Rust unit tests that read the English and Portuguese fixtures on Windows CI
# not-scenario: CHR-13 — unit tests with in-memory span exporters in the API and the agent
# not-scenario: CHR-14 — the i18n lint of the site and the agent window; keyboard use is exercised in @CHR-02 and @CHR-11

Feature: Characters read from the character selection screen
  A player opens the character selection screen with the agent running and the site learns their characters, so the
  queues know what each player brings without anyone typing it.

  Background:
    Given "Alice" is signed in and has a paired agent

  @CHR-01 @NFR-04 @agent
  Scenario: Without consent the agent reads nothing
    Given Alice's agent has no capture consent
    When the game shows the character selection screen with "Sorc" a level 85 softcore ladder expansion Sorceress titled "Slayer"
    Then the site shows the agent's screen as "Unknown"
    And the site shows no characters for Alice

  @CHR-02 @NFR-05 @agent
  Scenario: Consenting starts the reading, withdrawing stops it
    Given Alice's agent has no capture consent
    And the game shows the character selection screen with "Sorc" a level 85 softcore ladder expansion Sorceress titled "Slayer"
    When Alice gives capture consent in the agent's window using only the keyboard
    Then the site lists "Sorc" within 2 seconds
    When Alice withdraws capture consent in the agent's window
    And the game shows the character selection screen with "Pally" a level 90 softcore ladder expansion Paladin titled "Champion"
    Then the site does not list "Pally"

  @CHR-04 @FR-05 @agent
  Scenario Outline: The agent reports the screen it sees
    Given Alice's agent has capture consent
    When the game shows <screen>
    Then the site shows the agent's screen as "<label>"

    Examples:
      | screen                                                                                                 | label               |
      | the character selection screen with "Sorc" a level 85 softcore ladder expansion Sorceress titled "Slayer" | Character selection |
      | a game with the automap closed                                                                         | In game             |
      | a game with the automap open                                                                           | Automap open        |
      | the main menu                                                                                          | Unknown             |

  @CHR-05 @FR-05 @NFR-01 @web
  Scenario: The site follows the agent's presence
    Given Alice's agent has capture consent
    And the game shows a game with the automap closed
    When Alice opens the site
    Then the site shows the agent online, the game open and the screen "In game"
    When the agent stops sending heartbeats for 45 seconds
    Then the site shows the agent offline within 2 seconds

  @CHR-06 @FR-02 @agent
  Scenario: Every complete card on the screen is registered
    Given Alice's agent has capture consent
    When the game shows the character selection screen with these cards
      | name   | class       | level | mode     | ladder     | era       | title    |
      | Sorc   | Sorceress   | 85    | softcore | ladder     | expansion | Slayer   |
      | Hammer | Paladin     | 92    | hardcore | non-ladder | expansion | Guardian |
      | Zon    | Amazon      | 12    | softcore | ladder     | classic   | -        |
    Then the site lists "Sorc", "Hammer" and "Zon" with those fields

  @CHR-06 @FR-02 @agent
  Scenario: A card the agent could not read completely is not registered
    Given Alice's agent has capture consent
    When the game shows the character selection screen with "Sorc" fully readable and "Blurry" whose level cannot be read
    Then the site lists "Sorc"
    And the site does not list "Blurry"

  @CHR-09 @FR-02 @api
  Scenario: A newer reading replaces the character's fields
    Given Alice's agent has registered "Sorc" a level 85 softcore ladder expansion Sorceress titled "Slayer"
    When Alice's agent registers "Sorc" a level 88 softcore ladder expansion Sorceress titled "Champion"
    Then the API answers 204
    And Alice has one character named "Sorc", at level 88, with Normal, Nightmare and Hell unlocked

  @CHR-09 @FR-02 @api
  Scenario: Characters belong to the agent's account only
    Given "Bob" is signed in and has a paired agent
    When Alice's agent registers "Sorc" a level 85 softcore ladder expansion Sorceress titled "Slayer"
    Then Bob has no characters

  @CHR-10 @FR-02 @NFR-06 @api
  Scenario Outline: A request that breaks the contract stores nothing
    When Alice's agent registers "Sorc" a level 85 softcore ladder expansion Sorceress titled "Slayer" together with a character whose <field> is <value>
    Then the API answers 400
    And Alice has no characters

    Examples:
      | field | value                          |
      | class | "Necromancer2"                 |
      | level | 0                              |
      | level | 100                            |
      | era   | "diablo4"                      |
      | name  | "a name with spaces"           |
      | count | 25 characters in one request   |

  @CHR-11 @FR-02 @web
  Scenario: The site lists the player's characters
    Given Alice's agent has registered "Sorc" a level 85 softcore ladder expansion Sorceress titled "Slayer"
    When Alice opens the site and moves to the character list using only the keyboard
    Then she sees "Sorc", Sorceress, level 85, softcore, ladder, expansion, with Normal and Nightmare unlocked, and when it was read

  @CHR-11 @FR-02 @web
  Scenario: With no characters the site says how to add them
    When Alice opens the site
    Then she sees "Open the character selection screen in the game with the agent running to add your characters."

  @CHR-12 @FR-02 @NFR-01 @web
  Scenario: A new reading reaches the open site without a reload
    Given Alice has the site open
    When Alice's agent registers "Sorc" a level 85 softcore ladder expansion Sorceress titled "Slayer"
    Then the site lists "Sorc" within 2 seconds
