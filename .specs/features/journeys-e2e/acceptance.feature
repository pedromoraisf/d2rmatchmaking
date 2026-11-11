# Acceptance scenarios for journeys-e2e (ADR 023). English Gherkin. Executed as-is by tests/acceptance (playwright-bdd).
# The journeys run the whole F1 stack: fake Battle.net OAuth, the API, the site behind the Pages proxy and headless agents
# that read drawn Party-panel fixtures. Players sign in through the site; their agents pair and register their characters.
#
# not-scenario: JRN-03 — timing assertions inside @JRN-01 and @JRN-02 (each stage on the page ≤ 2 s after the observation)
# not-scenario: JRN-04 — `pnpm test:load` summary (≥ 100 players on the real journey, NFR-01 percentile)
# not-scenario: JRN-08 — `theme.test.ts` (button borders and hover states) and the `.sr-only` rule

Feature: The F1 journeys from sign-in to a confirmed room
  A player gets from signing in to a room every agent has confirmed in one flow, by mouse or keyboard, in English or
  Portuguese.

  @JRN-01 @J1 @FR-01 @FR-06 @FR-12 @FR-14 @FR-15 @FR-16 @NFR-01 @web @agent
  Scenario: J1 — a ranked duel from sign-in to an active room
    Given Alice and Bob sign in with Battle.net on the site
    And each pairs a headless agent that registers a level 90 sorceress on ladder softcore Reign of the Warlock
    When Alice and Bob join the PvP queue for a GM duel on Hell in the Americas
    And the ready check opens for both
    And Alice accepts on the site
    And Bob accepts with the agent's hotkey
    Then both sites show a room with a host, a game name starting with "mmpvphell-" and "No password"
    When the host's agent reads the game name in the Party panel
    Then both sites show the room as Created within 2 seconds
    When the other member's agent reads the game name in the Party panel
    Then both sites show the room as Active within 2 seconds, with both members confirmed by their agents

  @JRN-02 @J2 @FR-06 @FR-07 @FR-11 @FR-12 @FR-14 @FR-15 @FR-16 @FR-18 @NFR-01 @web @agent
  Scenario: J2 — a leveling group of eight runs twice
    Given eight players are signed in with paired headless agents, one a teleporter and one a BO, all level 80 or more
    When all eight join the leveling queue for Baal on Hell in Europe
    Then one group of eight forms with the teleporter and the BO
    When every member accepts the ready check
    Then the teleporter is the room's host
    When the host's agent and then every member's agent read the game name in the Party panel
    Then the host's and a member's sites show the room as Active within 2 seconds of the last reading
    When the host opens the next run on the site
    Then every member's site and agent get a new game name ending in "-2" within 2 seconds
    When every agent reads the new game name in the Party panel
    Then the room is Active again for run 2

  @JRN-05 @NFR-13 @web
  Scenario Outline: Every F1 screen passes the accessibility scan
    Given a player who can reach the "<screen>" screen
    When the player opens the "<screen>" screen
    Then the accessibility scan finds no WCAG 2.1 A or AA violation

    Examples:
      | screen               |
      | signed out           |
      | signed in home       |
      | pairing              |
      | characters           |
      | queue panel          |
      | searching            |
      | ready-check overlay  |
      | room panel           |
      | revoke agent         |

  @JRN-06 @NFR-13 @web
  Scenario: J1's site steps by keyboard alone
    Given Alice and Bob have paired agents with registered characters
    When Alice signs in, joins the PvP queue, accepts the ready check and copies the game name using only the keyboard
    Then every control she reached showed a visible focus
    And the copied game name is the room's name

  @JRN-07 @NFR-12 @web
  Scenario Outline: Every F1 screen is complete in Portuguese
    Given a player whose site language is Portuguese and who can reach the "<screen>" screen
    When the player opens the "<screen>" screen
    Then the screen shows no untranslated key and no English source string

    Examples:
      | screen               |
      | signed out           |
      | signed in home       |
      | pairing              |
      | characters           |
      | queue panel          |
      | searching            |
      | ready-check overlay  |
      | room panel           |
      | revoke agent         |
