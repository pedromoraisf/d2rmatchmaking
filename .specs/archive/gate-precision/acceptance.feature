# Acceptance scenarios for gate-precision (ADR 023). English Gherkin. Executed as-is by tests/acceptance
# (playwright-bdd). The actor is the agent asking the gate hook for a decision, in a temporary repository with an
# approved phase brief, on a feature branch; steps run the gate as a child process with that repository as the project
# directory.

Feature: The gate is exact about reads, writes and polling
  Read-only commands inside the checkout pass without a prompt, a read is never taken for a write, scripts the gate can
  read are judged by what they hold, polling is refused with what to do instead, and the gate never fails on its input.

  # not-scenario: GPR-02 — the closed table is proved command by command by the unit tests of the read-only rule, one case per command and per refused option
  # not-scenario: GPR-19 — two guides; proved by `scripts/test/phase-runner-skill.test.mjs` and a test that reads `.claude/agents/feature-worker.md`
  # not-scenario: GPR-21 — which modules load is an internal property; proved by a unit test that spawns the gate on a read-only call and lists the loaded modules
  # not-scenario: GPR-22 — machine-dependent timing; proved by `node scripts/gate-bench.mjs` on the phase machine (AD-160)
  # not-scenario: GPR-23 — the corpus's content; proved by the coverage assertions of `scripts/test/gate-replay.test.mjs`
  # not-scenario: GPR-24 — proved by `pnpm secrets:scan` and the assertions of `scripts/test/gate-replay.test.mjs` on paths, e-mail addresses and hosts
  # not-scenario: GPR-25 — proved by `scripts/test/gate-replay.test.mjs`
  # not-scenario: GPR-26 — proved by the category table of `scripts/test/gate-replay.test.mjs`
  # not-scenario: GPR-27 — proved by the gate `pnpm test:harness` on the feature's head
  # not-scenario: GPR-28 — proved by the gate `pnpm contracts:check` on the feature's head
  # not-scenario: GPR-29 — proved by running the `@HBS-` scenarios on the feature's head

  Background:
    Given a temporary repository with an approved phase brief for "F0" on the branch "feat/F0-demo"

  @GPR-01 @NFR-11
  Scenario Outline: Read-only command lines inside the checkout pass without a prompt
    When the agent asks the gate to run "<command>"
    Then the gate answers "allow"

    Examples:
      | command                                                 |
      | cat AGENTS.md                                           |
      | sed -n 1,40p .claude/hooks/gate.mjs                     |
      | cd apps && rg -n foo api/package.json 2>/dev/null \| head -n 20 |
      | git log --oneline -5 && git status --short              |
      | find apps -name '*.test.mjs' -not -path './node_modules/*' |
      | jq '.metrics' .quality-baseline.json                    |
      | gh api repos/pedromoraisf/d2rmatchmaking/actions/runs   |
      | node scripts/phase-status.mjs F0 --json                 |
      | node scripts/attempt.mjs status --feature demo          |
      | echo --- && wc -l scripts/lib/budget.mjs                |
      | ls -la .claude && head -20 AGENTS.md                    |
      | git diff main...HEAD --stat                             |
      | git show HEAD:AGENTS.md                                 |
      | git log --oneline -5 \| grep -i fix                     |
      | gh api -H 'Accept: application/vnd.github+json' repos/o/r/actions/runs |
      | jq '.a \| .b' .quality-baseline.json                    |
      | grep -n 'deny$' .claude/hooks/lib/gate-rules.mjs        |
      | sed -n '$p' AGENTS.md                                   |

  @GPR-03 @NFR-11
  Scenario Outline: A line that is not provably read-only is not allowed on that ground
    When the agent asks the gate to run "<command>"
    Then the gate does not answer "allow"

    Examples:
      | command                                     |
      | cat a.txt; rm -rf apps                      |
      | cat $(ls)                                   |
      | ls > out.txt                                |
      | grep x <(cat y)                             |
      | cat .e*                                     |
      | find . -name x -delete                      |
      | find . -fls out.txt                         |
      | sed -i s/a/b/ AGENTS.md                     |
      | sed -n 1w out.txt AGENTS.md                 |
      | awk '{ system("rm x") }' a.txt              |
      | rg --pre ./run.sh foo                       |
      | git log --output=out.txt                    |
      | git -c core.pager=sh branch                 |
      | git branch -D feat/F0-x                     |
      | grep -rn KEY apps                           |
      | gh api -XPOST repos/o/r/issues              |
      | gh api --method=DELETE repos/o/r/git/refs/x |
      | node scripts/phase-status.mjs --write       |
      | tail -F reports/x.log                       |
      | cd /tmp && cat x                            |
      | cat a.txt \|\| rm -rf apps                  |
      | cat a.txt & rm -rf apps                     |
      | cat a.txt \|& tee out.txt                   |
      | cat <<< "$HOME"                             |
      | cat a.txt >&out.txt                         |
      | cat `ls`                                    |
      | cat "$HOME/a.txt"                           |
      | cat [ab].txt                                |
      | cat .e""nv                                  |
      | cat .\\env                                  |
      | jq -n env                                   |
      | jq -n 'env.GITHUB_TOKEN'                    |
      | awk 'BEGIN{print ENVIRON["X"]}'             |
      | gh api repos/o/r --jq env                   |
      | git diff --no-index /dev/null /etc/hosts    |
      | cat .en{v,v}                                |
      | git log -p -- '.e*'                         |
      | git ls-files ':(glob).e*'                   |
      | git log --out=x                             |
      | rg KEY -g .env .                            |
      | diff -r apps/api apps/web                   |
      | sed -n '/x/p;w o/p' AGENTS.md               |
      | awk 'BEGIN{ARGV[ARGC++]="x"} {print}' a.txt |
      | grep -v .e* README.md                       |
      | rg -n foo apps                              |
      | git branch -v evil                          |
      | gh pr list --json number --jq env           |
      | gh api https://example.com/x                |
      | GIT_PAGER=sh git log --oneline              |
      | ./git log --oneline                         |
      | /tmp/cat AGENTS.md                          |
      | cd apps/api && node scripts/phase-status.mjs |
      | gh api -H 'X-HTTP-Method-Override: DELETE' repos/o/r |

  @GPR-03 @NFR-11
  Scenario: Two commands on two lines are not a read-only line
    When the agent asks the gate to run a command line of "cat AGENTS.md" and "rm -rf apps" on two lines
    Then the gate does not answer "allow"

  @GPR-04 @GPR-30 @NFR-11
  Scenario Outline: Reading a secret is denied, whatever the reading command
    When the agent asks the gate to run "<command>"
    Then the gate answers "deny"

    Examples:
      | command                           |
      | cat apps/api/.env                 |
      | grep KEY apps/api/.env            |
      | grep -e KEY apps/api/.env         |
      | rg -e KEY .env                    |
      | sed -n 1p .env.local              |
      | git show HEAD:.env                |
      | git log -p -- .npmrc              |
      | jq . .npmrc                       |
      | cat .ENV                          |
      | cat apps/api/.Env.local           |
      | rg -n ledger .git                 |
      | cat apps/web/.dev.vars            |
      | grep token .git/d2rmm/ledger.json |

  @GPR-04 @NFR-11
  Scenario: Another rule's deny wins over a read the table allows
    When the agent asks the gate to run "cat AGENTS.md" 4 times in one session
    And the agent asks the gate to run "cat AGENTS.md" once more in the same session
    Then the gate answers "deny"

  @GPR-31 @NFR-11
  Scenario Outline: Reading outside the checkout is not allowed on the read-only ground
    When the agent asks the gate to run "<command>"
    Then the gate does not answer "allow"

    Examples:
      | command                  |
      | cat ~/.ssh/id_rsa        |
      | cat /proc/self/environ   |
      | head -n 5 ../other/a.txt |

  @GPR-05 @GPR-06 @GPR-07 @NFR-11
  Scenario Outline: A read of a harness file with stream redirections is a read
    When the agent asks the gate to run "<command>"
    Then the gate neither asks nor denies

    Examples:
      | command                                                   |
      | cat .claude/hooks/gate.mjs 2>&1 \| head -n 5              |
      | grep -n deny .claude/hooks/lib/gate-rules.mjs 2>/dev/null |
      | sed -n 1,20p eslint.config.mjs >/dev/null                 |
      | grep '>' .github/workflows/ci.yml                         |
      | echo "a > b" && cat lefthook.yml                          |

  @GPR-05 @GPR-08 @NFR-11
  Scenario Outline: A shell write to a harness, sensor or test file is denied with the Edit tool named
    When the agent asks the gate to run "<command>"
    Then the gate answers "deny"
    And the reason names "Edit tool"

    Examples:
      | command                                  |
      | echo x > eslint.config.mjs               |
      | echo x >\| eslint.config.mjs             |
      | sed -i s/warn/off/ eslint.config.mjs     |
      | cp /tmp/ci.yml .github/workflows/ci.yml  |
      | tee lefthook.yml < /tmp/x                |
      | echo '{}' >> .quality-baseline.json      |
      | mv apps/api/src/x.test.ts /tmp/x.test.ts |
      | bash -c "echo x > eslint.config.mjs"     |

  @GPR-09 @NFR-11
  Scenario: Inline code that writes a harness file is denied with the Edit tool named
    When the agent asks the gate to run "node -e \"require('fs').writeFileSync('eslint.config.mjs','')\""
    Then the gate answers "deny"
    And the reason names "Edit tool"

  @GPR-10 @NFR-11
  Scenario: A shell write to a self-protected file still asks
    When the agent asks the gate to run "echo x > .claude/hooks/gate.mjs"
    Then the gate answers "ask"

  @GPR-11 @GPR-09 @NFR-11
  Scenario Outline: A script outside the repository is judged by what it holds
    Given a script outside the repository that <does>
    When the agent asks the gate to run that script with "<runner>"
    Then the gate <decision>

    Examples:
      | does                              | runner  | decision         |
      | prints the lines of AGENTS.md     | bash    | answers "allow"  |
      | prints the lines of AGENTS.md     | python3 | does not ask     |
      | writes eslint.config.mjs          | python3 | answers "deny"   |
      | runs git push --force origin main | bash    | answers "deny"   |

  @GPR-12 @NFR-11
  Scenario Outline: A script the gate cannot judge asks
    Given <script>
    When the agent asks the gate to run that script with "bash"
    Then the gate answers "ask"

    Examples:
      | script                                                         |
      | a script path that does not exist                              |
      | a binary file outside the repository                           |
      | a script outside the repository that sources another one there |

  @GPR-13 @NFR-11
  Scenario Outline: Tokens that are not scripts are never read as scripts
    When the agent asks the gate to run "<command>"
    Then the gate does not ask about a script

    Examples:
      | command                        |
      | rg '//' src                    |
      | ls /**                         |
      | git log --grep '/fix/'         |
      | grep -E '/api/(v1\|v2)/' a.txt |

  @GPR-32 @NFR-11
  Scenario: A command named by its path gets the decision of its name
    When the agent asks the gate to run "/bin/rm -rf apps"
    Then the gate answers "deny"

  @GPR-33 @NFR-11
  Scenario Outline: A package scope is not the ledger
    When the agent asks the gate to run "<command>"
    Then the gate <decision>

    Examples:
      | command                                            | decision               |
      | pnpm --filter @d2rmm/api list                      | does not answer "deny" |
      | cat .git/d2rmm/ledger.json                         | answers "deny"         |
      | pnpm --filter @d2rmm/api typecheck && cat d2rmm/x  | answers "deny"         |

  @GPR-14 @NFR-11
  Scenario Outline: Asking a sensor for help is not running it
    When the agent asks the gate to run "<command>"
    Then the gate does not answer "deny"

    Examples:
      | command                     |
      | pnpm exec vitest --help     |
      | pnpm exec playwright -h     |
      | cargo nextest --version     |
      | pnpm exec eslint --version  |

  @GPR-14 @NFR-11
  Scenario Outline: Running a sensor is still only through the wrapper
    When the agent asks the gate to run "<command>"
    Then the gate answers "deny"

    Examples:
      | command                                              |
      | pnpm exec vitest run --help && pnpm exec vitest run  |
      | pnpm exec vitest --help \| head -n 5                 |

  @GPR-15 @GPR-18 @NFR-11
  Scenario Outline: Long sleeps are refused with what to do instead
    When the agent asks the gate to run "<command>"
    Then the gate <decision>

    Examples:
      | command                  | decision                                                      |
      | sleep 30                 | does not answer "deny"                                        |
      | sleep 31                 | answers "deny" with a reason that names the task notification |
      | sleep 1m                 | answers "deny" with a reason that names the task notification |
      | sleep 20 && sleep 20     | answers "deny" with a reason that names the task notification |
      | sleep infinity           | answers "deny" with a reason that names the task notification |
      | sleep $N                 | answers "deny" with a reason that names the task notification |
      | sleep 0.5                | does not answer "deny"                                        |
      | sleep 1e2                | answers "deny" with a reason that names the task notification |
      | bash -c "sleep 40"       | answers "deny" with a reason that names the task notification |

  @GPR-16 @GPR-18 @NFR-11
  Scenario Outline: Polling loops are refused
    When the agent asks the gate to run "<command>"
    Then the gate answers "deny" with a reason that names the task notification

    Examples:
      | command                                                |
      | until test -f done; do sleep 5; done                   |
      | while ! gh run view 1 --exit-status; do sleep 10; done |

  @GPR-17 @GPR-18 @NFR-11
  Scenario: The fifth identical command within ten minutes is refused
    When the agent asks the gate to run "git status --short" 4 times in one session
    Then the gate allowed each of them
    When the agent asks the gate to run "git status --short" once more in the same session
    Then the gate answers "deny" with a reason that names the task notification

  @GPR-17 @NFR-11
  Scenario: Identical commands in two sessions are counted apart
    When the agent asks the gate to run "git status --short" 4 times in one session and 4 times in another
    Then the gate allowed each of them

  @GPR-20 @NFR-11
  Scenario Outline: The gate answers any input without failing
    When the agent sends the gate <input>
    Then the gate's output carries no "Gate hook error"
    And the gate does not answer "allow"

    Examples:
      | input                          |
      | a Write of a 60 MB file        |
      | a Write of a 60 MB file to apps/api/.env |
      | a Bash command of 2 MB         |
      | a payload that is not JSON     |
      | a Bash call with no command    |
