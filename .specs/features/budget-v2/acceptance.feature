# Acceptance scenarios for budget-v2 (ADR 023). English Gherkin. Executed as-is by tests/acceptance (playwright-bdd).
# The actor is an agent running gates through scripts/attempt.mjs in a temporary git repository with an approved
# phase brief and a feature; the gate hook and the Stop hook run as child processes with that repository as the
# project directory.

Feature: The retry budget counts what the agent controls
  A failure caused by the machine and a rerun with nothing changed do not spend the budget, the orchestrator resets a
  unit once with a reason, and the wrapper is easy to call and to read.

  # not-scenario: BUD-01 — the signature list is one module; proved by its unit test, one case per signature
  # not-scenario: BUD-21 — a constant; proved by a unit test that reads `MAX_RETRIES`
  # not-scenario: BUD-24 — proved by the gate `pnpm test:harness` on the feature's head
  # not-scenario: BUD-25 — proved by the gate `pnpm contracts:check` on the feature's head
  # not-scenario: BUD-31 — a count over a session's red stops; proved by the unit test of the Stop hook's budget rule

  Background:
    Given a temporary repository with an approved phase brief and the feature "demo"

  @BUD-02 @BUD-03 @NFR-11
  Scenario Outline: A failure caused by the machine is recorded and not counted
    When the agent runs a gate for "demo" step "T1" that prints "<output>" and exits <code>
    Then the gate's failure count stays 0
    And the wrapper says the failure was not counted and names "<signature>"

    Examples:
      | output                                                    | code | signature  |
      | Cannot connect to the Docker daemon at unix:///var/run/docker.sock | 1 | docker     |
      | Error: ENOSPC: no space left on device                    | 1    | disk       |
      | Killed                                                    | 137  | killed     |
      | Error: listen EADDRINUSE: address already in use :::3000  | 1    | port       |
      | sh: cargo: command not found                              | 127  | not-found  |

  @BUD-02 @NFR-11
  Scenario: A command killed by SIGKILL is a machine failure
    When the agent runs a gate for "demo" step "T1" that kills itself with SIGKILL
    Then the gate's failure count stays 0
    And the wrapper says the failure was not counted and names "killed"

  @BUD-02 @BUD-26 @NFR-11
  Scenario Outline: An ordinary failure still counts
    When the agent runs a gate for "demo" step "T1" that prints "<output>" and exits 1
    Then the gate's failure count is 1

    Examples:
      | output                                                    |
      | expected 2, received 3                                    |
      | Error: Module not found: ./missing.js                     |
      | GET /healthz 404 not found                                |
      | Cannot connect to the Docker daemon\nnot ok 3 - stores the room |

  @BUD-04 @BUD-05 @NFR-11
  Scenario: Three machine failures in a row block the unit as an environment problem
    When the agent runs a gate for "demo" step "T1" that fails with "Cannot connect to the Docker daemon" three times
    Then the unit is "env-blocked"
    And the third run printed the free memory, the swap used, the load average, the running containers and the leftover acceptance processes
    And a fourth run exits 3 without running the command and prints the same diagnosis
    And the feature "demo" is blocked

  @BUD-04 @NFR-11
  Scenario: A counted failure between machine failures starts the count again
    When the agent runs a gate for "demo" step "T1" that fails with "Cannot connect to the Docker daemon" twice
    And the agent changes a file and runs a gate for "demo" step "T1" that prints "expected 2, received 3" and exits 1
    And the agent runs a gate for "demo" step "T1" that fails with "Cannot connect to the Docker daemon" once
    Then the unit is "open"

  @BUD-30 @NFR-11
  Scenario: Four machine failures in all block the unit, even with a counted failure between them
    When the agent runs a gate for "demo" step "T1" that fails with "Cannot connect to the Docker daemon" twice
    And the agent changes a file and runs a gate for "demo" step "T1" that prints "expected 2, received 3" and exits 1
    And the agent runs a gate for "demo" step "T1" that fails with "Cannot connect to the Docker daemon" twice
    Then the unit is "env-blocked"

  @BUD-06 @NFR-11
  Scenario: A gate that runs past its timeout is stopped and not counted
    When the agent runs a gate for "demo" step "T1" with "--timeout 1" that never ends
    Then the command is stopped after one minute
    And the wrapper exits 124
    And the gate's failure count stays 0
    And the wrapper names the "timeout" signature

  @BUD-27 @NFR-11
  Scenario Outline: A timeout that is not a whole number of minutes is refused
    When the agent runs a gate for "demo" step "T1" with "--timeout <value>"
    Then the wrapper exits 2 without running the command

    Examples:
      | value |
      | 0     |
      | 0.5   |
      | soon  |

  @BUD-07 @NFR-11
  Scenario: A red stop caused by the machine lets the agent stop and is not counted
    Given the Stop hook's checks fail with "Cannot connect to the Docker daemon"
    When the agent ends its turn
    Then the Stop hook lets it stop
    And the stop is not counted
    And the hook says the machine needs attention

  @BUD-07 @NFR-11
  Scenario: A red stop with one real failure still counts
    Given the Stop hook's checks fail, one with "Cannot connect to the Docker daemon" and one with "expected 2, received 3"
    When the agent ends its turn
    Then the Stop hook blocks the stop
    And the stop is counted

  @BUD-08 @BUD-09 @BUD-11 @NFR-11
  Scenario: A rerun with nothing changed is refused before it runs
    Given the agent ran a gate for "demo" step "T1" that failed with "expected 2, received 3"
    When the agent runs the same gate again without changing any file
    Then the wrapper exits 4 without running the command
    And it says nothing changed since the last failure
    And the gate's failure count is 1
    And the ledger keeps the refused rerun apart from the attempts

  @BUD-09 @NFR-11
  Scenario Outline: A rerun after a change runs
    Given the agent ran a gate for "demo" step "T1" that failed with "expected 2, received 3"
    When the agent <changes> and runs the same gate again
    Then the command runs

    Examples:
      | changes                      |
      | edits a tracked file         |
      | adds an untracked file       |

  @BUD-09 @NFR-11
  Scenario Outline: Reruns of a state already proven failing are refused
    Given the agent ran a gate for "demo" step "T1" that failed with "expected 2, received 3"
    And <between>
    When the agent runs the same gate again
    Then the wrapper exits 4 without running the command

    Examples:
      | between                                                                     |
      | another command of the same unit then failed with "Cannot connect to the Docker daemon" |
      | the agent made an empty commit                                              |

  @BUD-10 @NFR-11
  Scenario: The same tree with another gate command runs
    Given the agent ran a gate for "demo" step "T1" that failed with "expected 2, received 3"
    When the agent runs a gate for "demo" step "T1" with another command and no file changed
    Then the command runs

  @BUD-28 @NFR-11
  Scenario: Outside a git repository nothing is refused
    Given a directory that is not a git repository with the feature "demo"
    And the agent ran a gate there for "demo" step "T1" that failed with "expected 2, received 3"
    When the agent runs the same gate again
    Then the command runs

  @BUD-10 @NFR-11
  Scenario: A rerun after a machine failure runs with nothing changed
    Given the agent ran a gate for "demo" step "T1" that failed with "Cannot connect to the Docker daemon"
    When the agent runs the same gate again without changing any file
    Then the command runs

  @BUD-12 @BUD-14 @NFR-11
  Scenario: The orchestrator resets a unit once
    Given the unit "gate:demo/T1" is blocked
    When the orchestrator resets "gate:demo/T1" with the reason "Docker was stopped; started again"
    Then the unit "gate:demo/T1" has no attempts
    And the ledger keeps the reset with "orchestrator" and its reason
    When the unit "gate:demo/T1" is blocked again
    And the orchestrator resets "gate:demo/T1" with the reason "again"
    Then the reset is refused with exit 2
    And the refusal says the next reset is the maintainer's

  @BUD-13 @NFR-11
  Scenario: An orchestrator reset needs a reason
    Given the unit "gate:demo/T1" is blocked
    When the orchestrator resets "gate:demo/T1" with no reason
    Then the reset is refused with exit 2

  @BUD-15 @NFR-11
  Scenario Outline: The gate asks only for a reset that is the maintainer's
    Given the unit "gate:demo/T1" <history>
    When the agent asks the gate to run "node scripts/attempt.mjs reset --unit gate:demo/T1 --by <by> --reason 'fixed'"
    Then the gate <decision>

    Examples:
      | history                                                     | by           | decision      |
      | is blocked                                                  | orchestrator | does not ask  |
      | is env-blocked                                              | orchestrator | does not ask  |
      | is blocked after an orchestrator reset                      | orchestrator | answers "ask" |
      | is blocked after an orchestrator reset and a maintainer one | orchestrator | answers "ask" |
      | is blocked                                                  | pedromoraisf | answers "ask" |

  @BUD-15 @BUD-29 @NFR-11
  Scenario Outline: A reset the gate cannot read asks
    Given the unit "gate:demo/T1" is blocked
    When the agent asks the gate to run "<command>"
    Then the gate answers "ask"

    Examples:
      | command                                                                       |
      | node scripts/attempt.mjs reset --unit gate:demo/T1 --reason 'fixed'           |
      | node scripts/attempt.mjs reset --unit gate:demo/T1 --by orchestrator          |
      | node scripts/attempt.mjs reset --by orchestrator --reason 'fixed'             |

  @BUD-29 @NFR-11
  Scenario: Both forms of the unit option name the same unit
    Given the unit "gate:demo/T1" is blocked after an orchestrator reset
    When the agent asks the gate to run "node scripts/attempt.mjs reset --unit=gate:demo/T1 --by orchestrator --reason 'again'"
    Then the gate answers "ask"

  @BUD-16 @NFR-11
  Scenario: The report shows resets, machine failures and refused reruns apart
    Given the unit "gate:demo/T1" had a machine failure, a refused rerun and an orchestrator reset
    When the agent runs "node scripts/attempt.mjs report"
    Then the report lists the reset with its unit, "orchestrator", its reason and its time
    And the report shows the machine failures and the refused reruns of each unit in columns of their own

  @BUD-17 @NFR-11
  Scenario Outline: The full output is on disk and the end on the terminal
    When the agent runs a gate for "demo" step "T1" that prints <lines> numbered lines and exits 0
    Then "reports/attempts/gate-demo-T1/1.log" holds all <lines> lines
    And the terminal shows the result, the duration and lines <first> to <lines>

    Examples:
      | lines | first |
      | 60    | 1     |
      | 61    | 2     |
      | 200   | 141   |

  @BUD-18 @NFR-11
  Scenario Outline: A read-only filter after the wrapper is allowed
    When the agent asks the gate to run the wrapper for "demo" step "T1" followed by "<filter>"
    Then the gate does not deny it

    Examples:
      | filter                |
      | 2>&1 \| tail -n 40    |
      | \| head -n 20         |
      | 2>&1 \| grep FAIL     |

  @BUD-19 @NFR-11
  Scenario Outline: Any other command after the wrapper is denied
    When the agent asks the gate to run the wrapper for "demo" step "T1" followed by "<tail>"
    Then the gate answers "deny"

    Examples:
      | tail                        |
      | \| tee out.txt              |
      | && git commit -m x          |
      | ; rm -rf apps               |
      | \| grep $(rm -rf apps)      |
      | \| grep `rm -rf apps`       |
      | \| tail -n 5 > out.txt      |
      | \| tail -n 5 \| sh          |

  @BUD-20 @NFR-11
  Scenario Outline: A wrapper denial hands over the command to run
    When the agent, working in the worktree of "demo", asks the gate to run "<command>"
    Then the gate answers "deny"
    And the reason holds "<corrected>"

    Examples:
      | command                                                                    | corrected                                                                     |
      | pnpm test                                                                  | node scripts/attempt.mjs run --feature demo --step <step> -- "pnpm test"      |
      | node scripts/attempt.mjs run --feature demo --step T1 -- pnpm test && ls   | node scripts/attempt.mjs run --feature demo --step T1 -- "pnpm test && ls"     |
      | node scripts/attempt.mjs run --feature demo --step proofs -- pnpm test; ls | node scripts/attempt.mjs run --feature demo --step proofs -- "pnpm test; ls"  |

  @BUD-22 @BUD-23 @NFR-11
  Scenario: The guides describe the new counting
    When the agent reads the agent guide and the retry-budget reference
    Then rule 11 says environment failures and unchanged reruns do not count
    And rule 11 says the orchestrator resets a unit once with a reason and a second reset is the maintainer's
    And the reference describes the signatures, "env-blocked", exit 4 for an unchanged rerun, the orchestrator reset, the log files and the allowed filters
