Feature: One trace follows a test room from the click to the stream event
  The maintainer can open one trace that follows a test player's action through the site, the API, Postgres, the outbox
  and the stream, with the agent's own spans linked to it, and the site and the agent can send their spans through the
  API without any secret of their own.

  # not-scenario: OBS-07 — a missing outbox trace context is internal; proved by a Testcontainers integration test that inserts an outbox row with no trace context, runs the relay and receives the event
  # not-scenario: OBS-14 — the relay never forwarding backend headers is invisible to a player; proved by an API integration test against a fake backend that answers with headers and a body, asserting the relay's response has neither
  # not-scenario: OBS-15 — the agent's bounded queue and non-blocking export are internal; proved by Rust unit tests in the adapters crate (a full queue drops the oldest span, a slow relay never delays a caller)
  # not-scenario: OBS-16 — the site exporting through the relay is covered by the trace scenario; the shared limits are proved by the relay scenarios below; a web unit test proves the exporter targets the relay path
  # not-scenario: OBS-17 — a dependency rule; proved by the agent architecture test (the domain manifest has no tracing or OpenTelemetry crate) and by a Rust test that the exporter lives in the adapters crate
  # not-scenario: OBS-18 — a file and two scripts; proved by a harness test that `compose.yaml` pins the image tag and that `package.json` defines `obs:up` and `obs:down`
  # not-scenario: OBS-20 — a missing prerequisite is not a player behaviour; proved by a unit test of the backend step that, with the Docker socket absent, fails with a message naming Docker
  # not-scenario: OBS-21 — log format is internal; proved by an API test that captures a log line inside a span and asserts `trace_id` and `span_id` are present, and absent outside one
  # not-scenario: OBS-22 — redaction is internal; proved by unit tests of the telemetry package with one fixture span, metric and log record per forbidden key
  # not-scenario: OBS-23 — attribute names are internal; proved by a unit test of the constants and by a scan of every span exported during the trace scenario for a name outside the allowed set
  # not-scenario: OBS-24 — resource attributes are internal; proved by unit tests of each bootstrap and a Rust test of the agent resource
  # not-scenario: OBS-25 — instruments are internal; proved by an API test with an in-memory metric reader that drives a request, a stream connection, an outbox row and a room reaching created
  # not-scenario: OBS-26 — the dashboard is a file; proved by a unit test that compares every metric a panel queries with the instruments the code defines, and by the compose file provisioning it
  # not-scenario: OBS-27 — contract drift is a build rule; proved by `pnpm contracts:openapi` leaving no diff and a test that `/v1/telemetry/traces` is in `openapi.json`
  # not-scenario: OBS-28 — robustness under a dead backend is proved by an API integration suite run with the endpoint pointing at a closed port, and by a Rust test in which the exporter cannot reach the relay while the loops keep running
  # not-scenario: OBS-29 — a code rule; proved by `pnpm lint` failing on a `process.env` fixture in the telemetry package, by `.env.example` passing `pnpm secrets:scan`, and by the existing architecture tests keeping spans out of the domain

  @OBS-01 @OBS-02 @OBS-03 @OBS-04 @OBS-05 @OBS-06 @OBS-11 @OBS-19 @NFR-09 @slow @web
  Scenario: A test room becomes Created and one trace holds every hop
    Given the telemetry backend is running locally
    And "Player One" is signed in on the site
    And "Player One" has a paired agent that is online
    And a test match is formed with "Player One" as host
    And the site shows the room as "Awaiting host"
    When the agent reports the game name of the room
    Then the site shows the room as "Created" within 2 seconds
    And the telemetry backend holds one trace, found within 30 seconds, that contains the site action, the API request, a database query, the outbox relay and the stream delivery
    And the heartbeat and the observation of the agent each have an API span in the trace of the agent's own span

  @OBS-08 @OBS-09 @OBS-10 @OBS-12 @NFR-09 @api
  Scenario Outline: The relay accepts only what it should
    Given a fake telemetry backend is listening
    And "Player One" is signed in on the site
    And "Player One" has a paired agent that is online
    When a client sends spans to the relay <how>
    Then the API answers <status>
    And the telemetry backend receives <forwarded> of them

    Examples:
      | how                                        | status | forwarded |
      | as a paired agent with a small JSON body   | 202    | all       |
      | as a signed-in player with a protobuf body | 202    | all       |
      | with no credentials                        | 401    | none      |
      | as a paired agent with a text body         | 415    | none      |
      | as a paired agent with a 2 MiB body        | 413    | none      |

  @OBS-12 @NFR-09 @api
  Scenario: The relay slows down a flood
    Given a fake telemetry backend is listening
    And "Player One" has a paired agent that is online
    And the agent has sent 60 span batches to the relay in the last minute
    When the agent sends one more batch
    Then the API answers 429 and says when to try again
    And the telemetry backend does not receive that batch

  @OBS-13 @NFR-09 @api
  Scenario: The relay does not break the sender when the backend is down
    Given "Player One" has a paired agent that is online
    And the telemetry backend does not answer
    When a paired agent sends a small span batch to the relay
    Then the API answers 202 with no content
