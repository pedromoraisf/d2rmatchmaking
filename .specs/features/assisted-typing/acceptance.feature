# Acceptance scenarios for assisted-typing (ADR 023). English Gherkin. Executed as-is by tests/acceptance (playwright-bdd).
# Brief revision 1 (approved 2026-11-21): the agent copies the room's game name to the clipboard and never types. The
# headless agent has no OS: its clipboard is an in-memory fake the steps read. The Windows adapter is proved by unit
# tests, the source rules and the maintainer's check (Ctrl+V in the Game Creator) on a preview installer.
# not-scenario: AST-13 — proved by `pnpm test:harness` (the source rules and the fixtures each one rejects), cargo deny and clippy
# not-scenario: AST-14 — proved by `pnpm test:harness` (the clipboard source rule and its fixtures) and Rust unit tests of the port
# not-scenario: AST-10 — proved by Rust unit tests with the in-memory span exporter, the locales tests and the web component test

Feature: The agent copies the game name for the player and never types into the game
  As soon as a room opens, the host's agent puts the room's game name on the clipboard, so the host pastes it with Ctrl+V into
  the Game Creator and creates the game themselves. The agent never sends a key to the game.

  @AST-11 @FR-28 @agent
  Scenario: The agent copies the room's game name when the room opens
    Given Alice's agent is the headless agent
    When Alice's room "mmbaalh-12" opens
    Then the agent's clipboard holds "mmbaalh-12"
    And the agent sent no key to any window

  @AST-11 @FR-28 @agent
  Scenario: A new run copies the new game name once
    Given Alice's agent is the headless agent and holds her room "mmbaalh-12"
    When the room's next run "mmbaalh-13" starts
    Then the agent's clipboard holds "mmbaalh-13"
    And the agent copied 2 times in all

  @AST-11 @FR-28 @agent
  Scenario Outline: A name the agent does not recognise is never copied
    Given Alice's agent is the headless agent
    When the API assigns Alice a room whose game name is "<name>"
    Then the agent's clipboard is untouched
    And the agent window says the game name could not be copied

    Examples:
      | name          |
      | mmbaalh-12\n  |
      | MMBAALH-12    |
      | mmbaalh-12 ok |

  @AST-12 @FR-28 @agent
  Scenario: The window tells the player to paste and confirm
    Given Alice's agent is the headless agent
    When Alice's room "mmbaalh-12" opens
    Then the agent window says the game name was copied and that Alice pastes it with Ctrl+V and creates the game herself

  @AST-12 @FR-28 @agent
  Scenario: The player copies again from the window
    Given Alice's agent is the headless agent and holds her room "mmbaalh-12"
    And something else replaced the clipboard
    When Alice clicks "copy again" in the agent window
    Then the agent's clipboard holds "mmbaalh-12"

  @AST-12 @FR-28 @agent
  Scenario: With no held room there is nothing to copy
    Given Alice's agent is the headless agent and holds her room "mmbaalh-12"
    When the room closes
    Then the agent window offers no "copy again"
    And the agent's clipboard is untouched

  @AST-08 @FR-28 @agent
  Scenario: The window says when the accept hotkey cannot be registered
    Given Alice's agent is the headless agent
    And another program holds the accept hotkey's combination
    When the agent starts
    Then the agent window says the accept hotkey is unavailable and asks Alice to choose another combination
