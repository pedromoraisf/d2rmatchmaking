# Acceptance scenarios for identity-bnet (ADR 023). English Gherkin. Executed as-is by tests/acceptance (playwright-bdd).
# Battle.net is a fake OAuth provider started by the acceptance stack; it signs in whoever the scenario names.
#
# not-scenario: IDB-11 — unit tests on the OAuth adapter, the routes and the span attributes (no secret or BattleTag)
# not-scenario: IDB-12 — unit tests with an in-memory span exporter
# not-scenario: IDB-13 — the i18n lint; keyboard use is exercised in the @IDB-02 and @IDB-08 scenarios

Feature: Sign in with Battle.net and manage the paired agent
  Players sign in with the Battle.net account they play with, stay signed in, sign out, and can cut off a desktop
  agent they no longer trust.

  Background:
    Given Battle.net sign-in is configured

  @IDB-01 @FR-01 @web
  Scenario: Choosing Battle.net sends the visitor to Battle.net with a protected request
    When a visitor opens the site
    And the visitor chooses "Sign in with Battle.net"
    Then Battle.net receives an authorize request for the site's callback with a state and an S256 code challenge

  @IDB-02 @FR-01 @web
  Scenario: A first sign-in creates the account and opens a session
    Given Battle.net will sign in "Alice#1234"
    When a visitor opens the site
    And the visitor signs in with Battle.net using only the keyboard
    Then the site shows "Signed in as Alice"
    And the visitor holds an HttpOnly, Secure session cookie
    When the visitor reloads the site
    Then the site shows "Signed in as Alice"

  @IDB-03 @FR-01 @web
  Scenario: A changed BattleTag keeps the same account
    Given "Alice#1234" has signed in with Battle.net before
    And Battle.net will sign in the same Battle.net account as "Alicia#5678"
    When a visitor opens the site
    And the visitor signs in with Battle.net
    Then the site shows "Signed in as Alicia"
    And the visitor is signed in to the same account as before

  @IDB-04 @FR-01 @web
  Scenario Outline: A failed Battle.net sign-in opens no session
    Given Battle.net will answer the sign-in with "<failure>"
    When a visitor opens the site
    And the visitor signs in with Battle.net
    Then the site shows "Sign-in with Battle.net failed. Please try again."
    And the visitor is still signed out

    Examples:
      | failure                    |
      | the visitor refused access |
      | a state that does not match |
      | a code it does not accept  |
      | a userinfo error           |

  @IDB-04 @FR-01 @api
  Scenario: A callback opened twice opens no second session
    Given Battle.net will sign in "Alice#1234"
    And a visitor has signed in with Battle.net
    When the visitor opens the same Battle.net callback again
    Then the site shows "Sign-in with Battle.net failed. Please try again."

  @IDB-05 @FR-01 @web
  Scenario: Signing out ends the session
    Given "Alice#1234" is signed in with Battle.net
    When the player signs out
    Then the visitor is still signed out
    And a request with the old session cookie is answered as unauthenticated

  @IDB-06 @FR-01 @web
  Scenario: Without Battle.net credentials the site offers no Battle.net sign-in
    Given Battle.net sign-in is not configured
    When a visitor opens the site
    Then the site does not offer "Sign in with Battle.net"
    And a direct Battle.net login request is answered as not found

  @IDB-07 @web
  Scenario: Test sign-in still works next to Battle.net on staging
    Given test sign-in is enabled
    And Battle.net will sign in "Alice#1234"
    And "Alice" is signed in on the site
    When another visitor signs in with Battle.net
    Then the two visitors are signed in to different accounts

  @IDB-08 @FR-04 @NFR-06 @web
  Scenario: Revoking the agent cuts its token at once
    Given "Alice#1234" is signed in with Battle.net and has a paired agent that is online
    When the player revokes the agent on the site using only the keyboard
    Then the agent's next heartbeat is answered as unauthenticated
    And the agent's stream is closed
    And the site shows that no agent is paired and offers the pairing form

  @IDB-09 @FR-04 @api
  Scenario: A player cannot revoke another player's agent
    Given "Alice#1234" is signed in with Battle.net
    And "Bob#4321" has a paired agent that is online
    When Alice asks to revoke Bob's agent
    Then the answer is not found
    And Bob's agent still sends heartbeats that are accepted

  @IDB-10 @FR-04 @api
  Scenario Outline: Sign-out and revoke refuse a request without a session or from another origin
    Given "Alice#1234" is signed in with Battle.net and has a paired agent that is online
    When a client asks to <action> <how>
    Then the answer is "<status>"

    Examples:
      | action             | how                         | status |
      | sign out           | without a session           | 401    |
      | sign out           | from another origin         | 403    |
      | revoke Alice's agent | without a session         | 401    |
      | revoke Alice's agent | from another origin       | 403    |
