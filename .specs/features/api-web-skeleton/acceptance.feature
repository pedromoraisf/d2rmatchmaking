# Acceptance scenarios for api-web-skeleton (ADR 023). English Gherkin. Executed as-is by tests/acceptance
# (playwright-bdd) against the local stack: the API composed by main/local.ts on a Postgres container, the site served
# with /api/* handled by the same Pages Function code that runs on Cloudflare, and a simulated agent that calls the
# agent endpoints over HTTP with the contract's payloads.

Feature: A test room becomes Created
  The walking skeleton proves the site, the API, the outbox and the stream end to end: a test player pairs an agent,
  sees it online, and watches a test room become Created when the host's agent reports the game name.

  # not-scenario: AWS-15 — waiting 45 s of real time per run is wasted CI time; proved by an application unit test with FakeClock (offline exactly after 45 s, still online at 44.999 s)
  # not-scenario: AWS-26 — killing the API between commit and relay needs process control; proved by a Testcontainers integration test that commits, stops the relay, restarts it and receives the event
  # not-scenario: AWS-31 — a code rule; proved by `pnpm lint` failing on a `process.env` fixture outside `main/` and by both composition roots starting in an integration test
  # not-scenario: AWS-32 — no player observes migrations; proved by an integration test that migrates a Testcontainers Postgres twice
  # not-scenario: AWS-33 — an architecture rule; proved by a test that the API's dependency tree has no Redis or broker client and that heartbeats issue no SQL (query counter in an integration test)
  # not-scenario: AWS-34 — the deploy workflows run only after the maintainer's push with secrets (AGENTS.md rules 6-7); proved by a static test of `deploy-api.yml` and `deploy-web.yml` and by their first runs, listed in the phase review
  # not-scenario: AWS-35 — spans are internal; proved by an application test with an in-memory span exporter
  # not-scenario: AWS-39 — event ordering is internal to the stream; proved by a Testcontainers integration test that commits events in several transactions and asserts the stream ids strictly increase in outbox order, on a site stream and on an agent stream
  # not-scenario: AWS-40 — waiting 25 s of real time per run is wasted CI time; proved by a stream integration test with FakeClock (a keep-alive comment at 25 s, none at 24.999 s)
  # not-scenario: AWS-04 (expired session only) — needs time travel; proved by an application unit test with FakeClock (session valid at 7 days minus 1 ms, 401 at 7 days); the unknown and missing cases are the scenarios below
  # not-scenario: AWS-14 ("Agent offline" label only) — reaching offline takes 45 s (AWS-15); proved by a web component test that renders the presence panel from an offline presence event
  # not-scenario: AWS-20 (host is the lowest join order only) — the test match has one member (AD-033); proved by a domain unit test of room creation from a three-member `MatchFormed`
  # not-scenario: AWS-24 (non-host member only) — the test match has one member (AD-033); proved by a domain unit test where a non-host member's matching observation leaves the room `awaiting_host`
  # not-scenario: AWS-37 (key parity and literal-string lint only) — build rules; proved by a web unit test that the `en` and `pt-BR` files hold the same keys and by an ESLint fixture test where a literal JSX string fails `pnpm lint`; the language choice is the scenario below
  # not-scenario: AWS-29 (unbuffered streaming only) — proved by a test of the Pages Function against a streaming upstream that asserts the first event reaches the client before the upstream sends the second; the same-origin and cookie parts are the scenario below
  # not-scenario: AWS-24 and AWS-25 (what is stored only) — storage is not observable by a player; proved by Testcontainers integration tests that read `lobby.observations` after a non-matching observation (one row) and after an unknown-type or non-member observation (no row)
  # not-scenario: AWS-36 — a build rule; proved by `pnpm contracts:check` and a test that every route is in `openapi.json` and every agent message has a JSON Schema file

  @AWS-30 @api
  Scenario: The API answers its health check
    When a client asks the API for its health
    Then the API answers that it is ok

  @AWS-01 @FR-01 @web
  Scenario: A test player signs in and stays signed in
    Given test sign-in is enabled
    When a visitor signs in on the site as "PlayerOne"
    Then the site shows "Signed in as PlayerOne"
    And the session cookie is HttpOnly, Secure, SameSite Lax, for path "/" and lasts 7 days
    When the visitor reloads the site
    Then the site shows "Signed in as PlayerOne"
    When another visitor signs in on the site as "playerone"
    Then both visitors are signed in to the same account
    And the other visitor's site shows "Signed in as PlayerOne"

  @AWS-02 @FR-01 @web
  Scenario Outline: A player name outside the rules is refused
    Given test sign-in is enabled
    When a visitor signs in on the site as "<name>"
    Then the site shows "Use 2 to 16 letters, digits or hyphens."
    And the visitor is still signed out

    Examples:
      | name              |
      |                   |
      | P                 |
      | PlayerNameIs17chr |
      | Player One        |
      | Player_One        |

  @AWS-02 @FR-01 @web
  Scenario: A player name with a leading space is refused, not trimmed
    Given test sign-in is enabled
    When a visitor signs in on the site as " PlayerOne"
    Then the site shows "Use 2 to 16 letters, digits or hyphens."
    And the visitor is still signed out

  @AWS-01 @FR-01 @web
  Scenario Outline: A player name at the limits is accepted
    Given test sign-in is enabled
    When a visitor signs in on the site as "<name>"
    Then the site shows "Signed in as <name>"

    Examples:
      | name             |
      | Pl               |
      | Player-Name-16ch |

  @AWS-03 @web
  Scenario: Test sign-in and test matches do not exist when staging endpoints are off
    Given test sign-in is disabled
    When a visitor opens the site
    Then the site offers neither "Sign in with a test account" nor "Start test match"
    And a direct test sign-in request is answered as not found
    And a direct test match request is answered as not found

  @AWS-04 @api
  Scenario: A site request without a valid session is refused
    When a client calls a site endpoint without a session
    Then the API answers "401"
    When a client calls a site endpoint with an unknown session
    Then the API answers "401"

  @AWS-04 @web
  Scenario: A visitor with an unknown session sees the site signed out
    Given test sign-in is enabled
    And the browser holds a session cookie the API does not know
    When a visitor opens the site
    Then the site shows "Sign in with a test account"
    And the site shows no "Signed in as" text

  @AWS-05 @FR-03 @api
  Scenario: An agent receives a pairing code
    When an agent asks for a pairing code
    Then the agent receives a 6-digit code that expires 5 minutes later and a claim secret

  @AWS-06 @AWS-07 @FR-03 @web
  Scenario: A player pairs an agent with the code it shows
    Given "PlayerOne" is signed in on the site
    And an agent shows a pairing code
    When "PlayerOne" types that code on the site
    Then the site shows "Agent paired"
    And the agent receives its token when it claims
    And a second claim with the same secret is answered "410"

  @AWS-07 @FR-03 @api
  Scenario: An agent waits until its code is typed
    Given an agent shows a pairing code
    When the agent claims before anyone typed the code
    Then the API answers "202" with no token

  @AWS-07 @FR-03 @api
  Scenario: A claim for a code that expired unused is refused
    Given an agent showed a pairing code that expired unused
    When the agent claims with its claim secret
    Then the API answers "410" with no token

  @AWS-08 @FR-03 @web
  Scenario Outline: A pairing code that cannot be used is refused
    Given "PlayerOne" is signed in on the site
    And there is <code kind>
    When "PlayerOne" types that code on the site
    Then the site shows "This code is invalid or has expired."

    Examples:
      | code kind         |
      | an unknown code   |
      | an expired code   |
      | a used code       |

  @AWS-09 @FR-03 @web
  Scenario: Too many pairing attempts are refused for a while
    Given "PlayerOne" is signed in on the site
    And "PlayerOne" has typed 9 wrong codes in the last 5 minutes
    When "PlayerOne" types the code "000000" on the site
    Then the site shows "This code is invalid or has expired."
    When "PlayerOne" types the code "000000" on the site
    Then the site shows "Too many attempts. Try again in a few minutes."

  @AWS-09 @FR-03 @api
  Scenario: Too many pairing codes from one address are refused
    Given 10 pairing codes were requested from one address in the last hour
    When an agent at that address asks for a pairing code
    Then the API answers "429"

  @AWS-10 @NFR-06 @api
  Scenario: Pairing a new agent revokes the previous one
    Given "PlayerOne" has a paired agent
    When "PlayerOne" pairs a second agent
    Then a heartbeat from the first agent is answered "401"
    And a heartbeat from the second agent is answered "204"

  @AWS-11 @NFR-06 @api
  Scenario: The agent token and the session cookie each open only their own endpoints
    Given "PlayerOne" is signed in and has a paired agent
    When the agent calls a site endpoint with its token
    Then the API answers "401"
    When the site calls the heartbeat endpoint with the session cookie
    Then the API answers "401"

  @AWS-12 @api
  Scenario Outline: An outdated agent is told to upgrade
    Given the minimum agent version is "0.0.1"
    And "PlayerOne" has a paired agent
    When the agent sends a <request> with <version>
    Then the API answers "<status>"

    Examples:
      | request              | version                | status |
      | heartbeat            | version "0.0.0"        | 426    |
      | heartbeat            | no version             | 426    |
      | heartbeat            | version "banana"       | 426    |
      | heartbeat            | version "0.0.1"        | 204    |
      | pairing code request | version "0.0.0"        | 426    |
      | pairing code request | version "0.0.2"        | 201    |

  @AWS-13 @AWS-14 @FR-05 @NFR-01 @web
  Scenario: A paired agent shows as online with the game open
    Given "PlayerOne" is signed in on the site
    And "PlayerOne" has a paired agent
    When the agent reports that the game is running on the automap
    Then the API answers "204"
    And within 2 seconds the site shows "Agent online", "Game open" and "Screen: Automap open"

  @AWS-14 @FR-05 @NFR-01 @web
  Scenario: The site follows a presence change
    Given "PlayerOne" is signed in on the site
    And "PlayerOne" has a paired agent that reports the game running on the automap
    When the agent reports that the game is closed on an unknown screen
    Then within 2 seconds the site shows "Agent online", "Game closed" and "Screen: Unknown"

  @AWS-16 @FR-03 @web
  Scenario: A player without an agent is offered pairing
    Given "PlayerOne" is signed in on the site
    And "PlayerOne" has no paired agent
    When "PlayerOne" opens the site
    Then the site shows the field "Pairing code" and the action "Pair agent"

  @AWS-17 @web
  Scenario: The download button points to the latest agent release
    When a visitor opens the site
    Then "Download the agent" links to "https://github.com/pedromoraisf/d2rmatchmaking/releases/latest/download/D2RMatchMaking-setup.exe"

  @AWS-18 @api
  Scenario: A heartbeat that breaks the contract is refused
    Given "PlayerOne" has a paired agent that is online
    When the agent sends a heartbeat whose body breaks the contract
    Then the API answers "400"
    And the agent's presence does not change

  @AWS-19 @AWS-20 @AWS-21 @AWS-22 @AWS-23 @NFR-01 @INV-06 @INV-08 @web
  Scenario: The host's agent sees the expected game name
    Given "PlayerOne" is signed in on the site
    And "PlayerOne" has a paired agent that is online
    When "PlayerOne" uses "Start test match"
    Then the API answered "202" to the test match request
    And within 2 seconds the site shows a room named like "mmbaalh-", "No password" and the stage "Awaiting host"
    And the agent's stream and assignment name that room, run 1, its game name and "PlayerOne" as host and only member
    When the agent reports seeing the game name of the room
    Then within 2 seconds the site shows the room as "Created"

  @AWS-23 @INV-06 @web
  Scenario: The game name matches whatever its letter case
    Given "PlayerOne" is signed in on the site
    And "PlayerOne" has started a test match with a paired agent
    When the agent reports seeing the game name of the room in upper case
    Then within 2 seconds the site shows the room as "Created"

  @AWS-20 @api
  Scenario: The same match never makes two rooms
    Given a test match was formed for "PlayerOne"
    When the same match is delivered to the Lobby Room again
    Then "PlayerOne" has exactly one room for that match

  @AWS-21 @web
  Scenario: The room survives a page reload
    Given "PlayerOne" is signed in on the site
    And "PlayerOne" has started a test match
    When "PlayerOne" reloads the site
    Then the site shows the room's game name and the stage "Formed"

  @AWS-21 @web
  Scenario: A newer test match replaces the room on the site
    Given "PlayerOne" is signed in on the site
    And "PlayerOne" has started a test match
    When "PlayerOne" uses "Start test match" again
    Then within 2 seconds the site shows a game name different from the first room's

  @AWS-24 @INV-06 @web
  Scenario Outline: An observation that does not prove the game leaves the room waiting
    Given "PlayerOne" is signed in on the site
    And "PlayerOne" has started a test match with a paired agent
    When <reporter> reports seeing <name>
    Then the API answers "202"
    And the site shows the room as "Awaiting host"

    Examples:
      | reporter         | name                           |
      | the host's agent | the game name "mmbaalh-999999" |
      | the host's agent | the game name of run 2         |

  @AWS-24 @INV-06 @api
  Scenario: A second sighting after Created changes nothing
    Given "PlayerOne" has started a test match with a paired agent
    And the agent has reported seeing the game name of the room
    When the agent reports seeing the game name of the room again with a new observation
    Then the API answers "202"
    And the room changed stage only once

  @AWS-24 @INV-09 @api
  Scenario: A repeated observation changes nothing
    Given "PlayerOne" has started a test match with a paired agent
    And the agent has reported seeing the game name of the room
    When the agent sends the same observation again
    Then the API answers "202"
    And the room changed stage only once

  @AWS-25 @api
  Scenario: An agent outside the room cannot report on it
    Given "PlayerOne" has started a test match with a paired agent
    And "PlayerTwo" has a paired agent that is online
    When the agent of "PlayerTwo" reports seeing the game name of the room of "PlayerOne"
    Then the API answers "403"
    And the room of "PlayerOne" is still "Awaiting host"

  @AWS-25 @api
  Scenario: An observation of an unknown type is discarded
    Given "PlayerOne" has started a test match with a paired agent
    When the agent sends an observation of an unknown type
    Then the API answers "202"
    And the room of "PlayerOne" is still "Awaiting host"

  @AWS-27 @api
  Scenario: Each player's stream carries only that player's events
    Given "PlayerOne" and "PlayerTwo" each have an open stream
    And "PlayerOne" has started a test match with a paired agent
    When the agent of "PlayerOne" reports seeing the game name of the room
    Then the stream of "PlayerOne" receives the room's stage change
    And the stream of "PlayerTwo" receives no room event

  @AWS-27 @api
  Scenario: Each agent's stream carries only that agent's events
    Given "PlayerOne" and "PlayerTwo" each have a paired agent with an open stream
    When "PlayerOne" starts a test match
    Then the stream of the agent of "PlayerOne" receives the room assignment
    And the stream of the agent of "PlayerTwo" receives no room event

  @AWS-27 @api
  Scenario: A stream without a session is refused
    When a client opens the stream without signing in
    Then the API answers "401"

  @AWS-28 @api
  Scenario: A reconnecting stream receives the events it missed
    Given "PlayerOne" has started a test match with a paired agent
    And "PlayerOne" has an open stream that received the room assignment
    And the stream of "PlayerOne" is closed
    When the agent reports seeing the game name of the room
    And "PlayerOne" reopens the stream from the last event received
    Then the stream of "PlayerOne" first receives the room's stage change to "created"

  @AWS-29 @web
  Scenario: The site talks to the API only through its own origin
    Given "PlayerOne" is signed in on the site
    When "PlayerOne" uses "Start test match"
    Then every request the site made to the API went to the site's own origin under "/api/"
    And the session cookie was set by the site's own origin

  @AWS-37 @NFR-12 @web
  Scenario Outline: The site follows the browser's language
    Given the browser prefers "<language>"
    When a visitor opens the site
    Then the site shows the action "<action>"

    Examples:
      | language | action                    |
      | en-US    | Download the agent        |
      | pt-BR    | Baixar o agente           |
      | pt-PT    | Baixar o agente           |
      | fr-FR    | Download the agent        |

  @AWS-38 @web
  Scenario: The site says it is not affiliated with Blizzard
    When a visitor opens the site
    Then the site shows "D2R Match Making is a community project and is not affiliated with Blizzard Entertainment."
