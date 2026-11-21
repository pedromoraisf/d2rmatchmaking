# Acceptance scenarios for staging-bots (ADR 023). The bots are an admin task that runs against a real API, so the proof of
# each requirement is the one that fits it; the only scenario is the one a browser-level suite can show, with steps that
# already exist (api-web-skeleton AWS-03). Decision recorded in the feature's notes.md: the bot round (queue, ready check,
# room, leave) is proved against the real app by `apps/api/src/main/__tests__/staging-bots.int.test.ts`, which runs the same
# script on a real clock, because the acceptance stack drives the matcher with a controlled clock and a browser, which the
# bots do not use.
#
# not-scenario: SBT-01 — unit tests on the input plan and a harness test on the workflow's inputs
# not-scenario: SBT-02 — unit tests with production-shaped fake APIs and the CLI test (no write before the checks)
# not-scenario: SBT-04 — unit tests on the name builder; the security reviewer reads the threat model
# not-scenario: SBT-05 — integration test of the script against the real app (staging-bots.int.test.ts)
# not-scenario: SBT-06 — integration tests of a duel and a Leveling group against the real app, and unit tests on the bounds
# not-scenario: SBT-07 — integration test: accept and observation reach `active`; the contract schemas validate every body
# not-scenario: SBT-08 — unit tests (bounds, back-off) and a harness test (timeout, concurrency)
# not-scenario: SBT-09 — no site change (T8 dropped): the job summary and the logs name the bots, tested with SBT-11
# not-scenario: SBT-10 — integration test: after the room closes the bot's agent is revoked and its streams are closed
# not-scenario: SBT-11 — unit test: the log and the summary of a full run hold no token or cookie value
# not-scenario: SBT-12 — harness test on the workflow file
# not-scenario: SBT-13 — the runbook exists (`pnpm specs:check`)

Feature: The bots' sign-in exists only on staging
  Bots use the staging-only test sign-in. An API with the staging endpoints off does not have it.

  @SBT-03 @web
  Scenario: A production-like API has no test sign-in for a bot to use
    Given test sign-in is disabled
    When a visitor opens the site
    Then a direct test sign-in request is answered as not found
    And a direct test match request is answered as not found
