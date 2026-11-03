# Acceptance scenarios for load-baseline (ADR 023). English Gherkin. Executed as-is by tests/acceptance (playwright-bdd).
# The load run is a command the maintainer starts on demand; it takes about 17 minutes, needs Docker and is never part of
# the pull-request workflow (LB-20). So only the refusals that happen before anything starts (LB-17, LB-18) and the
# publish guard (LB-16) can run as scenarios.
# Every other requirement is proved by pure-function unit tests (ADR 026), by static tests of the package scripts and the
# CI workflows, or by the full run itself (`pnpm test:load` and the smoke profile), as each line below says.

Feature: The load run measures the main journey and refuses to touch anything it did not start
  The maintainer runs one command that ramps virtual players against a limited API in containers, and learns how many
  players it holds inside 2 seconds. The command can never load production or a deployed service.

  # not-scenario: LB-01 — proved by the smoke run (`pnpm test:load:smoke`): the summary names the Postgres 17 container, the API container limits and the k6 image, and the API connects over verified TLS; a unit test pins the default limits (0.5 CPU, 512m) and the database's TLS settings
  # not-scenario: LB-02 — proved by a unit test of the API container's environment (real clock, staging endpoints on, test controls off, `SITE_ORIGIN`, `PORT`, the CA path, exporter pointed at the sink) and by the smoke run reading bytes at the sink
  # not-scenario: LB-03 — proved by the smoke run: every virtual player signs in, pairs, opens both streams and beats; the run's checks fail on any missing step
  # not-scenario: LB-04 — proved by a unit test that every virtual player gets a distinct address, a static test that no rate-limit constant changed, and a unit test that a 429 counts as an error
  # not-scenario: LB-05 — proved by the smoke run (a match per player, `room.assigned`, the observation, the `created` frame) and a unit test of the iteration's state machine
  # not-scenario: LB-06 — proved by a unit test of the p95 over fixed latencies and by the smoke summary's p95
  # not-scenario: LB-07 — proved by a unit test of the full profile's step table (25, 50, 100, 150, 200, 300, 400; 20 s ramp, 120 s hold, 90 s window) and of the stop rule
  # not-scenario: LB-08 — proved by unit tests of the step verdict at 2000 ms and 2001 ms, at 1% and just below, and with a restarted container
  # not-scenario: LB-09 — proved by a unit test of the smoke profile table and by the smoke run's `profile: "smoke"`
  # not-scenario: LB-10 — proved by unit tests of `maxConcurrentPlayers` over fixed step results, including the first step failing and a later step failing
  # not-scenario: LB-11 — proved by unit tests of the run verdict and its exit code when the 100-player step fails, with the failure naming the step and the rule
  # not-scenario: LB-12 — proved by a unit test of the summary writer (whole file or none, on failure too) and by the smoke run's file
  # not-scenario: LB-13 — proved by unit tests that `p95StateLatencyMs` and `maxConcurrentRooms` are read from the 100-player step and the highest passing step
  # not-scenario: LB-14 — proved by unit tests of the bytes arithmetic with fixed byte counts and a ramp-up window that is excluded
  # not-scenario: LB-15 — proved by a unit test that the summary holds every field the criterion lists and that `withinEgressBudget` flips at 70 000
  # not-scenario: LB-19 — proved by a unit test of the cleanup plan (containers and network removed after a pass, a failed step and an interrupt) and by the smoke run leaving no container behind
  # not-scenario: LB-20 — proved by a static test that no workflow and neither `pnpm check` nor `pnpm test` names the load scripts
  # not-scenario: LB-21 — proved by unit tests of the telemetry arithmetic and by the four fields in the full run's summary
  # not-scenario: LB-22 — proved by unit tests of the share at 0.10 and just above it, with `failure` naming `telemetry`

  Background:
    Given a maintainer's machine with the repository checked out

  @LB-17 @api
  Scenario Outline: A target that is not the run's own container is refused
    Given the environment variable "<variable>" is set to "<value>"
    When the maintainer starts the load run
    Then the run is refused before any request is sent
    And the refusal names "<variable>"
    And no container was started

    Examples:
      | variable     | value                                      |
      | LOAD_TARGET  | https://api.example.com                    |
      | LOAD_TARGET  | http://localhost:3000                      |
      | DATABASE_URL | postgres://user:secret@db.example.com/prod |

  @LB-18 @api
  Scenario Outline: The run fails before starting anything when Docker or the k6 image is not usable
    Given Docker is in this state: "<state>"
    When the maintainer starts the load run
    Then the run fails before it starts any container
    And the failure names "<name>"

    Examples:
      | state                       | name   |
      | not installed               | Docker |
      | installed but not running   | Docker |
      | running but cannot pull k6  | image  |

  @LB-16 @api
  Scenario Outline: A summary that is missing, smoke or not passed is not published
    Given the load summary is "<summary>"
    When the maintainer publishes the load baseline
    Then the publish is refused
    And the load baseline document is not written

    Examples:
      | summary                  |
      | missing                  |
      | from the smoke profile   |
      | from a run that failed   |
