# Acceptance scenarios for assisted-typing (ADR 023). English Gherkin. Executed as-is by tests/acceptance (playwright-bdd).
# The headless agent has no OS: its typing, focus, screen and key state are in-memory fakes the steps control, so the
# scenarios read what the agent would have sent. The Windows adapter is proved by unit tests, the source rules and the
# maintainer's check on a preview installer.
# The fill that stops in the middle when the room ends has no scenario: typing takes about 150 ms, so no step can end a room
# inside it. It is proved by a Rust unit test in core (fill_name, the fill stops when the room is dropped or changes).
# not-scenario: AST-01 — proved by Rust unit tests (combination rules, hotkey registered only while a room is held) and the window component test
# not-scenario: AST-09 — proved by `pnpm test:harness` (the source rules and the fixtures each one rejects), cargo deny and clippy
# not-scenario: AST-10 — proved by Rust unit tests with the in-memory span exporter, the locales tests and the web component test

Feature: The agent types the game name for the player and never confirms
  A host fills the Game Creator's name field with one hotkey and then presses Enter themselves. The agent types only the
  room's game name, only into the game, and never a key that confirms.

  @AST-02 @FR-28 @agent
  Scenario: The fill hotkey types the room's game name
    Given Alice's agent is the headless agent and holds her room "mmbaalh-12"
    And D2R has focus and the game shows the lobby
    When Alice presses the agent's fill hotkey
    Then the agent typed exactly "mmbaalh-12"
    And the agent typed nothing else

  @AST-02 @FR-28 @agent
  Scenario: A press with no held room types nothing
    Given Alice's agent is the headless agent and holds no room
    And D2R has focus and the game shows the lobby
    When Alice presses the agent's fill hotkey
    Then the agent typed nothing
    And the agent window says there is no room to fill

  @AST-02 @FR-28 @agent
  Scenario Outline: A name the agent does not recognise is never typed
    Given Alice's agent is the headless agent and holds a room named "<name>"
    And D2R has focus and the game shows the lobby
    When Alice presses the agent's fill hotkey
    Then the agent typed nothing

    Examples:
      | name                   |
      | /exit                  |
      | mmbaalh-12 http://x.io |
      | MMBAALH-12             |
      | mmbaalh-               |
      | mmbaalh-1234567        |

  @AST-03 @FR-28 @agent
  Scenario: The agent does not type while another window has focus
    Given Alice's agent is the headless agent and holds her room "mmbaalh-12"
    And another window has focus
    When Alice presses the agent's fill hotkey
    Then the agent typed nothing
    And the agent window says the game does not have focus

  @AST-03 @FR-28 @agent
  Scenario: The agent stops typing when focus leaves the game
    Given Alice's agent is the headless agent and holds her room "mmbaalh-12"
    And D2R has focus and the game shows the lobby
    When Alice presses the agent's fill hotkey and focus leaves the game after 3 characters
    Then the agent typed exactly "mmb"
    And the agent window says the fill stopped

  @AST-04 @FR-28 @agent
  Scenario Outline: The agent does not type while a game is running
    Given Alice's agent is the headless agent and holds her room "mmbaalh-12"
    And D2R has focus and the game shows <screen>
    When Alice presses the agent's fill hotkey
    Then the agent typed nothing
    And the agent window says a game is running

    Examples:
      | screen             |
      | the in-game screen |
      | the open automap   |

  @AST-04 @FR-28 @agent
  Scenario: The agent types when it does not recognise the screen
    Given Alice's agent is the headless agent and holds her room "mmbaalh-12"
    And D2R has focus and the agent does not recognise the screen
    When Alice presses the agent's fill hotkey
    Then the agent typed exactly "mmbaalh-12"

  @AST-05 @FR-28 @agent
  Scenario: The agent waits for the hotkey's modifier keys to be released
    Given Alice's agent is the headless agent and holds her room "mmbaalh-12"
    And D2R has focus and the game shows the lobby
    And Alice still holds the hotkey's modifier keys for 300 milliseconds
    When Alice presses the agent's fill hotkey
    Then the agent typed exactly "mmbaalh-12"
    And the agent typed nothing before the modifier keys were released

  @AST-05 @FR-28 @agent
  Scenario: The agent types nothing when the modifier keys stay held
    Given Alice's agent is the headless agent and holds her room "mmbaalh-12"
    And D2R has focus and the game shows the lobby
    And Alice holds the hotkey's modifier keys for 2 seconds
    When Alice presses the agent's fill hotkey
    Then the agent typed nothing
    And the agent window says the keys are still held

  @AST-06 @FR-28 @agent
  Scenario: The agent sends only character keystrokes and never a confirming key
    Given Alice's agent is the headless agent and holds her room "mmduel1v1h-3"
    And D2R has focus and the game shows the lobby
    When Alice presses the agent's fill hotkey
    Then every event the agent sent is a Unicode character keystroke
    And the agent sent no Enter, Tab, Space, Escape or Backspace
    And the agent sent no modifier, mouse or clipboard event

  @AST-07 @FR-28 @agent
  Scenario: A second press while the agent types stops the fill
    Given Alice's agent is the headless agent and holds her room "mmbaalh-12"
    And D2R has focus and the game shows the lobby
    When Alice presses the agent's fill hotkey and presses it again after 3 characters
    Then the agent typed exactly "mmb"

  @AST-07 @FR-28 @agent
  Scenario: A press right after a fill is ignored
    Given Alice's agent is the headless agent and holds her room "mmbaalh-12"
    And D2R has focus and the game shows the lobby
    And Alice's agent typed her room's name 1 second ago
    When Alice presses the agent's fill hotkey
    Then the agent typed nothing more

  @AST-07 @FR-17 @api
  Scenario: The agent types nothing once the room has ended
    Given Alice and Bob are in an active room, with their agents online
    When the host closes the room on the site
    Then Bob's agent no longer holds a room
    When Bob presses the agent's fill hotkey
    Then the agent typed nothing
    And the agent window says there is no room to fill

  @AST-08 @FR-28 @agent
  Scenario: The window tells the player to confirm
    Given Alice's agent is the headless agent and holds her room "mmbaalh-12"
    And D2R has focus and the game shows the lobby
    When Alice presses the agent's fill hotkey
    Then the agent window says the name was typed and that Alice must press Enter in the game
    And the agent sent no key after the last character
