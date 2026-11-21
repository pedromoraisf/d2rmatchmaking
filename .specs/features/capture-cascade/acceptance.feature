# Acceptance scenarios for capture-cascade (ADR 023). English Gherkin. Executed as-is by tests/acceptance (playwright-bdd).
# The agent is the headless agent with a drawn fixture screen (xtask draws it; no capture is ever committed). Its capture
# port offers scripted methods: each method returns the shown fixture, a black frame or no frame, as the step says, and the
# text reader returns the fixture's sidecar text, because Linux has no OCR and no Win32 capture. How each real Windows
# method behaves is proved by the Windows CI check and the maintainer's field matrix.
# not-scenario: CAP-03 — proved by Rust unit tests that count captures and OCR calls over 600 looks (one per look in steady state, one probe per sixty)
# not-scenario: CAP-08 — proved by Rust unit tests with the in-memory exporter, the sanitiser tests and a source-rule test (no size, text or title in a span)
# not-scenario: CAP-09 — proved by Rust unit tests with a fake method (release counts, a panic) and the Windows CI check
# not-scenario: CAP-10 — proved by the maintainer's field matrix and CPU log on a real PC (windowed, borderless, full screen; legacy graphics; brightness)

Feature: The agent sees the game whichever way the PC can capture it
  A player plays in a window, borderless or full screen. When one way of capturing the game window returns black, the
  agent tries the next, reads only the game window, and says honestly what it sees.

  Background:
    Given "Alice" is signed in and has a paired agent

  @CAP-01 @NFR-03 @agent
  Scenario: The first capture method works and is the one used
    Given Alice's agent has capture consent and no room
    When the game shows the fixture "in-game-window"
    Then the site shows the agent's screen as "In game"
    And the agent window shows the capture method "Window print"

  @CAP-01 @CAP-02 @CAP-07 @NFR-03 @agent
  Scenario: A black first method falls back to the next one
    Given Alice's agent has capture consent and no room
    And the first capture method returns black frames
    When the game shows the fixture "in-game-fullscreen"
    Then the site shows the agent's screen as "In game"
    And the agent window shows the capture method "Graphics capture"

  @CAP-01 @agent
  Scenario: A method the PC cannot offer is skipped without an error
    Given Alice's agent has capture consent and no room
    And the first capture method is not available on this PC
    When the game shows the fixture "in-game-window"
    Then the site shows the agent's screen as "In game"
    And the agent window shows no capture error

  @CAP-02 @NFR-03 @agent
  Scenario: When every method is black the screen is unknown and the window says why
    Given Alice's agent has capture consent and no room
    And every capture method returns black frames
    When the game shows the fixture "in-game-fullscreen"
    Then the site shows the agent's screen as "Unknown"
    And the agent window says that the capture shows nothing

  @CAP-02 @agent
  Scenario: A black frame after a good one does not leave the old screen on the site
    Given Alice's agent has capture consent and no room
    When the game shows the fixture "in-game-window"
    Then the site shows the agent's screen as "In game"
    When every capture method returns black frames
    Then the site shows the agent's screen as "Unknown"

  @CAP-04 @NFR-04 @agent
  Scenario: The title bar and borders of a windowed game are not part of what is read
    Given Alice's agent has capture consent and no room
    When the game shows the fixture "in-game-window-with-title-bar"
    Then the site shows the agent's screen as "In game"

  @CAP-04 @NFR-04 @agent
  Scenario: A frame that is not the size of the game's client area is refused
    Given Alice's agent has capture consent and no room
    When the game shows the fixture "in-game-wrong-size-frame"
    Then the site shows the agent's screen as "Unknown"

  @CAP-05 @NFR-04 @agent
  Scenario: Without consent no capture method is used
    Given Alice's agent has no capture consent
    When the game shows the fixture "in-game-window"
    Then the site shows the agent's screen as "Unknown"
    And the agent window shows the capture method "None"

  @CAP-05 @NFR-04 @agent
  Scenario: Withdrawing consent stops the capture at once
    Given Alice's agent has capture consent and no room
    When the game shows the fixture "in-game-window"
    Then the site shows the agent's screen as "In game"
    When Alice withdraws capture consent in the agent's window
    Then the site shows the agent's screen as "Unknown"
    And the agent window shows the capture method "None"

  @CAP-05 @NFR-03 @agent
  Scenario: A minimized game is not captured
    Given Alice's agent has capture consent and no room
    When the game window is minimized
    Then the site shows the agent's screen as "Unknown"
    And the agent window shows the capture method "None"

  @CAP-06 @NFR-03 @agent
  Scenario: A dark but drawn frame is not mistaken for a blank one
    Given Alice's agent has capture consent and no room
    When the game shows the fixture "in-game-low-brightness"
    Then the site shows the agent's screen as "In game"
    And the agent window shows the capture method "Window print"

  @CAP-06 @NFR-03 @agent
  Scenario: Going from a window to full screen is followed without a restart
    Given Alice's agent has capture consent and no room
    When the game shows the fixture "in-game-window"
    Then the site shows the agent's screen as "In game"
    When the game shows the fixture "in-game-fullscreen"
    Then the site shows the agent's screen as "In game"

  @CAP-07 @NFR-03 @agent
  Scenario: The agent window shows which method sees the game
    Given Alice's agent has capture consent and no room
    And the first capture method returns black frames
    When the game shows the fixture "in-game-window"
    Then the agent window shows the capture method "Graphics capture"
