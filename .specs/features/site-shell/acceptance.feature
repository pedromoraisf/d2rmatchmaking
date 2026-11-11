# Acceptance scenarios for site-shell (ADR 023). English Gherkin. Executed as-is by tests/acceptance (playwright-bdd).
#
# not-scenario: SHL-01 — a unit test computes the WCAG contrast of every text token on its surface
# not-scenario: SHL-06 — the i18n lint and the locale completeness test

Feature: The site's frame and look
  Players see who they are signed in as, whether their agent and game are ready, and their characters, in the look of
  the maintainer's prototype, by mouse or keyboard.

  @SHL-02 @FR-01 @FR-05 @web
  Scenario Outline: The header shows the account and the agent's state
    Given "Alice" is signed in <agent state>
    When Alice opens the site
    Then the header shows "Alice", a sign-out control and the agent state "<label>"

    Examples:
      | agent state                                         | label                 |
      | and has no paired agent                             | No agent paired       |
      | and has a paired agent that is online               | Agent online · game closed |

  @SHL-02 @web
  Scenario: A signed-out visitor sees the sign-in controls in the header
    When a visitor opens the site
    Then the header shows the sign-in controls and no account

  @SHL-03 @web
  Scenario Outline: The page fits the screen without sideways scrolling
    Given "Alice" is signed in and has a paired agent that is online
    When Alice opens the site on a screen <width> pixels wide
    Then the page does not scroll sideways
    And the agent panel shows the agent online, the game state and the current screen

    Examples:
      | width |
      | 1280  |
      | 360   |

  @SHL-04 @FR-02 @web
  Scenario: Characters appear as cards with their difficulties
    Given "Alice" is signed in and has a paired agent
    And Alice's agent has registered "Sorc" a level 85 softcore Sorceress with Normal and Nightmare unlocked
    And Alice has declared "Sorc" as ladder, Expansion
    When Alice opens the site
    Then the card of "Sorc" shows Sorceress, level 85, softcore, ladder, Expansion and the tags Normal and Nightmare

  @SHL-05 @NFR-13 @web
  Scenario: Every control is reachable by keyboard with a visible focus
    Given "Alice" is signed in and has a paired agent that is online
    When Alice opens the site and presses Tab through the whole page
    Then every link and button receives focus in reading order with a visible outline
