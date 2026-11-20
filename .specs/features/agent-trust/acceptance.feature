# Acceptance scenarios for agent-trust (ADR 023). English Gherkin. Executed as-is by tests/acceptance (playwright-bdd).
# not-scenario: AGT-03 — proved by Rust unit tests (a failing request, a Debug print and every span never hold the token) and a source-rule test
# not-scenario: AGT-07 — proved by Rust unit tests with the in-memory span subscriber (the four fields, the closed value set)

Feature: The agent can be trusted with little
  A player can lose or revoke the agent without risk to their account. The agent token opens only the agent's own routes,
  the agent takes only data from the server, and nothing but structured observations leaves the PC.

  @AGT-01 @NFR-06 @api
  Scenario Outline: The agent token is refused outside the agent's routes
    Given "PlayerOne" is signed in and has a paired agent
    When the agent asks to <action> with its token
    Then the API answers "401"

    Examples:
      | action                       |
      | read the account             |
      | sign out                     |
      | revoke the agent             |
      | close a room                 |
      | queue for a match            |
      | set the account's characters |

  @AGT-01 @NFR-06 @api
  Scenario: The session cookie alone is refused on every agent route
    Given "PlayerOne" is signed in and has a paired agent
    When the site calls each agent route with the session cookie
    Then the API answers "401" on every one

  @AGT-02 @NFR-06 @api
  Scenario: A revoked agent is refused on every agent route
    Given "PlayerOne" is signed in and has a paired agent that is online
    When "PlayerOne" revokes the agent
    Then the revoked agent is answered "401" on every agent route
    And the agent's stream is closed

  @AGT-02 @NFR-06 @api
  Scenario: Pairing a new agent cuts the old one on every agent route
    Given "PlayerOne" has a paired agent
    When "PlayerOne" pairs a second agent
    Then the first agent is answered "401" on every agent route

  @AGT-04 @NFR-06 @api
  Scenario: The agent ignores a stream event that is not data it knows
    Given Alice and Bob are in a room awaiting the host, with their agents online
    When the API sends Bob's agent an event of an unknown type and a known event with an extra field
    Then Bob's agent holds the same room as before
    And Bob's agent performed no action

  @AGT-05 @NFR-04 @api
  Scenario: The agent sends only structured data to the API
    Given Alice is the host of a room awaiting the host, with her agent online
    When Alice's agent sees the game name of the current run
    Then every request Alice's agent sent holds only the keys of its contract
    And none of them holds image data

  @AGT-06 @NFR-04 @api
  Scenario: The agent does not look at the game without consent
    Given Alice's agent is online with the game running and no consent given
    When a second passes
    Then Alice's agent has not captured a frame

  @AGT-06 @NFR-04 @api
  Scenario: The agent stops looking when the player withdraws consent
    Given Alice's agent is online with the game running and consent given
    When Alice withdraws consent
    Then Alice's agent captures no frame after the next second
