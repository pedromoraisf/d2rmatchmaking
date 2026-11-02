Feature: Traces follow a test room from the click to the stream event
  The maintainer can open one trace that follows a test player's action through the site, the API, Postgres, the outbox
  and the stream, and a second trace that follows the agent's observation, and the site and the agent can send their
  spans through the API without any secret of their own.

  # not-scenario: OBS-02 — the unset branch has nothing to observe; proved by an API integration test that starts both composition roots with no OTLP endpoint and answers a health check
  # not-scenario: OBS-01 (metrics export only) — the trace scenario reads traces; proved by an API integration test that starts the API against a fake OTLP backend and asserts it receives a metrics export
  # not-scenario: OBS-03 (statement without parameter values only) — proved by an API integration test with an in-memory span exporter that runs a query with a bound value and asserts the `pg` span's statement text has no value
  # not-scenario: OBS-04 (navigation span and query-string removal only) — proved by a web unit test that navigates to a path with a query string and asserts the navigation span holds the path alone
  # not-scenario: OBS-07 — a missing outbox trace context is internal; proved by a Testcontainers integration test that inserts an outbox row with no trace context, runs the relay and receives the event
  # not-scenario: OBS-09 — the proxy header list is internal; proved by a Pages Function test that forwards `traceparent` and `tracestate` to a fake API and by the trace scenario below
  # not-scenario: OBS-16 — the relay never forwarding backend headers is invisible to a player; proved by an API integration test against a fake backend that answers with headers and a body, asserting the relay's response has neither and that no log or span holds the credentials
  # not-scenario: OBS-18 — the agent's bounded queue is internal; proved by Rust unit tests in the adapters crate (a full queue of 2048 drops the oldest span)
  # not-scenario: OBS-19 — the exporter never blocking and its reaction to 4xx answers are internal; proved by Rust unit tests with a fake relay (a slow relay never delays a caller; 401, 403, 413 and 415 drop the batch; 429 waits for Retry-After)
  # not-scenario: OBS-21 — the site exporting through the relay is covered by the trace scenario; a web unit test proves the exporter targets the relay path and sends nothing when `VITE_TELEMETRY` is not `on`
  # not-scenario: OBS-22 — a dependency rule; proved by the agent architecture test (the domain manifest has no tracing or OpenTelemetry crate) and by a Rust test that the exporter lives in the adapters crate
  # not-scenario: OBS-23 — a file and two scripts; proved by a harness test that `compose.yaml` pins the image tag and that `package.json` defines `obs:up` and `obs:down`
  # not-scenario: OBS-25 — a missing prerequisite is not a player behaviour; proved by a unit test of the backend step that, with the Docker socket absent, fails with a message naming Docker
  # not-scenario: OBS-26 — log format is internal; proved by an API test that captures a log line inside a span and asserts `trace_id` and `span_id` are present, and absent outside one
  # not-scenario: OBS-27 — log export is internal; proved by an API test with an in-memory log exporter that asserts a request log record carries the trace id
  # not-scenario: OBS-28 — redaction is internal; proved by unit tests of the telemetry package with one fixture span, metric and log record per forbidden key, and the keep and strip examples of the spec
  # not-scenario: OBS-29 — URL scrubbing is internal; proved by unit tests of the telemetry package with `url.full`, `http.url`, `http.target` and `url.query` fixtures carrying `code` and `state`, and by a scan of every span exported during the trace scenario
  # not-scenario: OBS-30 — attribute names are internal; proved by a unit test of the constants and by a scan of every span exported during the trace scenario for a BattleTag, a character name or an account id
  # not-scenario: OBS-31 — metric attributes are internal; proved by the metrics test below that every recorded attribute set is in the bounded sets
  # not-scenario: OBS-32 — resource attributes are internal; proved by unit tests of each bootstrap and a Rust test of the agent resource
  # not-scenario: OBS-33 — instruments are internal; proved by an API test with an in-memory metric reader that drives a request, a stream connection and an outbox row
  # not-scenario: OBS-34 — a stage duration needs the room to age; proved by an application test with FakeClock that moves a room to created and reads the histogram
  # not-scenario: OBS-35 — the dashboard is a file; proved by a unit test that the dashboard holds the listed panels and by a harness test that the compose file provisions it
  # not-scenario: OBS-36 — a consistency rule between two files; proved by a unit test that compares every metric a panel queries with the instruments the code defines
  # not-scenario: OBS-37 — robustness under a dead backend is proved by an API integration suite run with the endpoint pointing at a closed port, asserting identical answers and at most one export error log per minute
  # not-scenario: OBS-38 — robustness under a dead relay is proved by a Rust test in which the exporter cannot reach the relay while the loops keep running and at most one export error is logged per minute
  # not-scenario: OBS-39 — a code rule; proved by `pnpm lint` failing on a `process.env` fixture in the telemetry package and by the existing rule for `main/`
  # not-scenario: OBS-40 — a file; proved by a test that `.env.example` lists every `OTEL_*` variable `main/config.ts` reads and by `pnpm secrets:scan`
  # not-scenario: OBS-41 — a layering rule; proved by the existing architecture tests keeping spans out of the domain
  # not-scenario: OBS-42 — contract drift is a build rule; proved by `pnpm contracts:openapi` leaving no diff and a test that `/v1/telemetry/traces` is in `openapi.json`
  # not-scenario: OBS-43 — sampling is internal; proved by unit tests of the sampler (ratio from the variable, 0.1 when unset, a child follows its parent)
  # not-scenario: OBS-44 — a build switch; proved by a web unit test that no exporter is created unless `VITE_TELEMETRY` is `on`

  @OBS-01 @OBS-03 @OBS-04 @OBS-05 @OBS-06 @OBS-08 @OBS-24 @NFR-09 @slow @web
  Scenario: A test match leaves one trace through the site, the API, the database, the outbox and the stream
    Given the telemetry backend is running locally
    And "PlayerOne" is signed in on the site
    And "PlayerOne" has a paired agent that is online
    When "PlayerOne" starts a test match on the site
    Then the site shows the room as "Awaiting host"
    And the API request carried a traceparent sent by the site
    And the telemetry backend holds, within 30 seconds, one trace that contains the site action as the root, the API request as its child, a database query as a child of the request, the outbox relay as a child of the stored context, and the stream delivery as a child of the outbox relay
    And no span of that trace carries a query string, a cookie, a token or a player name

  @OBS-12 @OBS-24 @NFR-09 @slow @web
  Scenario: The agent's observation leaves its own trace and the room becomes Created
    Given the telemetry backend is running locally
    And "PlayerOne" is signed in on the site
    And "PlayerOne" has a paired agent that is online
    And a test match is formed with "PlayerOne" as host
    And the site shows the room as "Awaiting host"
    And the headless agent core is running with a fixture screen
    When the agent reports the game name of the room
    Then the site shows the room as "Created" within 2 seconds
    And the telemetry backend holds, within 30 seconds, one trace whose root is the agent's observation span, with the API span of that request as its child, the outbox relay and the stream delivery of the "Created" event below it
    And the API span of the agent's heartbeat and the API span of the agent's stream request are each a child of the agent's own span for that request, with the same trace id

  @OBS-10 @OBS-11 @OBS-13 @OBS-17 @OBS-20 @NFR-09 @api
  Scenario Outline: The relay accepts only what it should
    Given a fake telemetry backend is listening
    And "PlayerOne" is signed in on the site
    And "PlayerOne" has a paired agent that is online
    When a client sends spans to the relay <how>
    Then the API answers <status>
    And the fake telemetry backend received <forwarded>

    Examples:
      | how                                                                  | status | forwarded                                                  |
      | as a paired agent with a JSON body                                   | 202    | that exact body once, with the backend credentials added   |
      | as a signed-in player from the site with a protobuf body             | 202    | that exact body once, with the backend credentials added   |
      | as a paired agent with a body of exactly 1 MiB                       | 202    | that exact body once, with the backend credentials added   |
      | with no credentials                                                  | 401    | nothing                                                    |
      | as a signed-in player from another origin                            | 403    | nothing                                                    |
      | as a paired agent with a text body                                   | 415    | nothing                                                    |
      | as a paired agent with a gzip-encoded JSON body                      | 415    | nothing                                                    |
      | as a paired agent with a body of 1 MiB plus one byte                 | 413    | nothing                                                    |
      | with no credentials and a text body                                  | 401    | nothing                                                    |

  @OBS-10 @NFR-09 @api
  Scenario: A valid batch is accepted at once with no content
    Given a fake telemetry backend is listening
    And "PlayerOne" has a paired agent that is online
    When a paired agent sends a small span batch to the relay
    Then the API answers 202 with no content

  @OBS-14 @NFR-09 @api
  Scenario: The sixtieth batch in a minute is still accepted
    Given a fake telemetry backend is listening
    And "PlayerOne" has a paired agent that is online
    And the agent has sent 59 span batches to the relay in the last minute
    When the agent sends one more batch
    Then the API answers 202 with no content

  @OBS-20 @NFR-09 @api
  Scenario Outline: The relay checks the rate before the content type, and the content type before the size
    Given a fake telemetry backend is listening
    And "PlayerOne" has a paired agent that is online
    And the agent has sent <before> span batches to the relay in the last minute
    When the agent sends a text body of <size>
    Then the API answers <status>
    And the fake telemetry backend received nothing

    Examples:
      | before | size                 | status |
      | 60     | 1 KiB                | 429    |
      | 0      | 2 MiB                | 415    |

  @OBS-14 @NFR-09 @api
  Scenario Outline: The relay slows down a flood
    Given a fake telemetry backend is listening
    And <who> has sent 60 span batches to the relay in the last minute
    When <who> sends one more batch
    Then the API answers 429 and says when to try again
    And the fake telemetry backend does not receive that batch

    Examples:
      | who                    |
      | a paired agent         |
      | a signed-in player     |

  @OBS-14 @NFR-09 @api
  Scenario: The relay slows down unauthenticated callers by address
    Given a fake telemetry backend is listening
    And a client with no credentials has sent 120 span batches to the relay in the last minute
    When that client sends one more batch
    Then the API answers 429 and says when to try again
    And the fake telemetry backend does not receive that batch

  @OBS-15 @NFR-09 @api
  Scenario Outline: The relay does not break the sender when the backend fails
    Given "PlayerOne" has a paired agent that is online
    And the telemetry backend <failure>
    When a paired agent sends a small span batch to the relay
    Then the API answers 202 with no content

    Examples:
      | failure                    |
      | refuses connections        |
      | accepts and never answers  |
      | answers with a server error |
