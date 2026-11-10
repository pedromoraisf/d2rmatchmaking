# Acceptance scenarios for characters (ADR 023). English Gherkin. Executed as-is by tests/acceptance (playwright-bdd).
# The agent here is the acceptance suite's agent client: it sends heartbeats and character readings over HTTP with its
# token, as the real agent does. Reading the character selection screen end to end is `characters-reading` (split).
#
# not-scenario: CHR-01 — Rust unit tests in the agent core: no frame is captured or read without consent
# not-scenario: CHR-02 — Rust unit tests in the agent core and component tests of the agent window's consent view
# not-scenario: CHR-03 — Rust unit tests on the window lookup and the crop
# not-scenario: CHR-07 — Rust unit tests of the title table, every title of both genders, classic and expansion, SC and HC
# not-scenario: CHR-13 — unit tests with in-memory span exporters in the API and the agent
# not-scenario: CHR-14 — the i18n lint of the site and the agent window; keyboard use is exercised in @CHR-11

Feature: Characters registered by the agent and the agent's screen on the site
  The agent tells the platform which screen the game is on and which characters the player has, so the queues know
  what each player brings without anyone typing it.

  Background:
    Given "Alice" is signed in and has a paired agent

  @CHR-05 @FR-05 @NFR-01 @web
  Scenario Outline: The site shows the screen the agent reports
    Given Alice has the site open
    When Alice's agent reports that the game is running on the <screen> screen
    Then the site shows the agent online, the game open and the screen "<label>" within 2 seconds

    Examples:
      | screen              | label               |
      | character selection | Character selection |
      | in game             | In game             |
      | automap             | Automap open        |
      | unknown             | Unknown             |

  @CHR-05 @FR-05 @web
  Scenario: The site shows the agent offline when its heartbeats stop
    Given Alice has the site open
    And Alice's agent reports that the game is running on the in game screen
    When the agent stops sending heartbeats for 45 seconds
    Then the site shows the agent offline

  @CHR-09 @FR-02 @api
  Scenario: A newer reading replaces the character's fields
    Given Alice's agent has registered "Sorc" a level 85 softcore ladder expansion Sorceress with Normal and Nightmare unlocked
    When Alice's agent registers "Sorc" a level 88 softcore ladder expansion Sorceress with Normal, Nightmare and Hell unlocked
    Then the API answers 204
    And Alice has one character named "Sorc", at level 88, with Normal, Nightmare and Hell unlocked

  @CHR-09 @FR-02 @api
  Scenario: Characters belong to the agent's account only
    Given "Bob" is signed in and has a paired agent
    When Alice's agent registers "Sorc" a level 85 softcore ladder expansion Sorceress with Normal and Nightmare unlocked
    Then Bob has no characters

  @CHR-10 @FR-02 @NFR-06 @api
  Scenario Outline: A request that breaks the contract stores nothing
    When Alice's agent registers "Sorc" together with a character whose <field> is <value>
    Then the API answers 400
    And Alice has no characters

    Examples:
      | field        | value                        |
      | class        | "Necromancer2"               |
      | level        | 0                            |
      | level        | 100                          |
      | era          | "diablo4"                    |
      | name         | "a name with spaces"         |
      | difficulties | Normal and Hell only         |
      | count        | 25 characters in one request |

  @CHR-11 @FR-02 @web
  Scenario: The site lists the player's characters
    Given Alice's agent has registered "Sorc" a level 85 softcore ladder expansion Sorceress with Normal and Nightmare unlocked
    When Alice opens the site and moves to the character list using only the keyboard
    Then she sees "Sorc", Sorceress, level 85, softcore, ladder, expansion, with Normal and Nightmare unlocked, and when it was read

  @CHR-11 @FR-02 @web
  Scenario: With no characters the site says how to add them
    When Alice opens the site
    Then she sees "Open the character selection screen in the game with the agent running to add your characters."

  @CHR-12 @FR-02 @NFR-01 @web
  Scenario: A new reading reaches the open site without a reload
    Given Alice has the site open
    When Alice's agent registers "Sorc" a level 85 softcore ladder expansion Sorceress with Normal and Nightmare unlocked
    Then the site lists "Sorc" within 2 seconds
