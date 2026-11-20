# Acceptance scenarios for remote-config (ADR 023). English Gherkin. Executed as-is by tests/acceptance (playwright-bdd).
# The agent is the headless agent (the real core, the real HTTP gateway) against the real API; the API serves the
# configuration a scenario names through a staging test control (never on the production composition root). The agent prints
# a `config` line with the version it runs and the effective value the scenario names.
# not-scenario: RCF-03 — proved by contract tests (each field's range) and Rust unit tests (each range, at, below and above)
# not-scenario: RCF-04 — proved by Rust unit tests (the loop, the conditional request, the backoff) and a source-rule test (one API base, no other host)
# not-scenario: RCF-07 — proved by the pinning tests that come first (each built-in default equals today's constant) and by `ocr-real` and `ocr-variations` in CI
# not-scenario: RCF-09 — proved by Rust unit tests that count captures and OCR reads over 600 looks at every extreme of every range
# not-scenario: RCF-10 — proved by a source-rule test (the field list; no command, path, URL or pattern field) and the AGT-04 test extended
# not-scenario: RCF-11 — proved by Rust unit tests with the in-memory exporter, the sanitiser tests and a source-rule test
# not-scenario: RCF-12 — proved by an API unit test on the committed file, a CI check on it and the documentation page

Feature: The agent is tuned by a bounded, versioned configuration the API serves
  A game patch or a field result changes how the agent reads, without a new agent version. The agent takes numbers and
  words only, inside limits of its own, and keeps its last good configuration when anything is wrong.

  Background:
    Given "Alice" is signed in and has a paired agent

  @RCF-01 @NFR-06 @api
  Scenario: The agent token reads the configuration
    When the agent asks for the remote configuration with its token
    Then the API answers "200"
    And the configuration has a version that is a whole number

  @RCF-01 @NFR-06 @api
  Scenario Outline: Nobody else reads the configuration
    When <caller> asks for the remote configuration
    Then the API answers "401"

    Examples:
      | caller                             |
      | a browser session without an agent |
      | a caller with no credential        |
      | a caller with an unknown token     |

  @RCF-01 @api
  Scenario: A configuration the agent already holds is not sent again
    When the agent asks for the remote configuration with its token
    And the agent asks again, naming the version it holds
    Then the API answers "304"

  @RCF-01 @api
  Scenario: Revoking the agent cuts off the configuration
    When Alice revokes the agent
    And the agent asks for the remote configuration with its token
    Then the API answers "401"

  @RCF-02 @api
  Scenario: The configuration holds only its four sections
    When the agent asks for the remote configuration with its token
    Then the configuration has the sections "cadence, thresholds, regions, phrases" and no other

  @RCF-05 @RCF-08 @agent
  Scenario: A newer configuration is applied without a restart
    Given the API serves the configuration version 2 with a probe cadence of 30
    When Alice's agent starts
    Then the agent runs the configuration version 2
    And the agent's probe cadence is 30
    When the API serves the configuration version 3 with a probe cadence of 90
    Then the agent runs the configuration version 3
    And the agent's probe cadence is 90

  @RCF-05 @agent
  Scenario Outline: A value outside its range is clamped, never obeyed
    Given the API serves the configuration version 2 with a probe cadence of <sent>
    When Alice's agent starts
    Then the agent runs the configuration version 2
    And the agent's probe cadence is <used>

    Examples:
      | sent    | used |
      | 1       | 10   |
      | 100000  | 600  |
      | -5      | 10   |

  @RCF-05 @agent
  Scenario: A field the agent does not know is ignored
    Given the API serves the configuration version 2 with an unknown field "runThis"
    When Alice's agent starts
    Then the agent runs the configuration version 2
    And the agent's probe cadence is the built-in one

  @RCF-05 @agent
  Scenario: A phrase that is not plain text is ignored
    Given the API serves the configuration version 2 with a chat phrase "(a+)+$" in English
    When Alice's agent starts
    Then the agent runs the configuration version 2
    And the agent keeps its built-in chat phrases

  @RCF-06 @agent
  Scenario: An older configuration does not replace the one the agent holds
    Given the API serves the configuration version 5 with a probe cadence of 30
    And Alice's agent has started
    When the API serves the configuration version 4 with a probe cadence of 90
    Then the agent runs the configuration version 5
    And the agent's probe cadence is 30

  @RCF-06 @agent
  Scenario: A broken configuration keeps the last good one
    Given the API serves the configuration version 5 with a probe cadence of 30
    And Alice's agent has started
    When the API serves a configuration that is not valid JSON
    Then the agent runs the configuration version 5
    And the agent's probe cadence is 30

  @RCF-06 @agent
  Scenario: With no configuration the agent runs on its built-in values
    Given the API serves no configuration
    When Alice's agent starts
    Then the agent runs the configuration version 0
    And the agent's probe cadence is the built-in one

  @RCF-06 @agent
  Scenario: The last good configuration survives a restart with the API gone
    Given the API serves the configuration version 5 with a probe cadence of 30
    And Alice's agent has started
    When the agent restarts while the API does not answer
    Then the agent runs the configuration version 5
