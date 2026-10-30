# Acceptance scenarios for harness-foundation (ADR 023). English Gherkin. Executed as-is by tests/acceptance
# (playwright-bdd). The actor is a contributor at a clean checkout; steps run the repository's own commands.

Feature: A contributor builds every workspace and the sensors enforce the layers
  The walking skeleton needs six workspaces, five API modules with three layers, and architecture rules that are
  proven to reject a violation before any real feature code lands.

  # not-scenario: HF-06 — a full Stryker run takes minutes, beyond the 60 s acceptance timeout, and runs nightly anyway; proved by `pnpm --filter @d2rmm/api test:mutation` and a Vitest check on both report files (tasks.md ## Checks, written at Tasks)
  # not-scenario: HF-09 — the empty application layer holds only until `api-web-skeleton` adds code, so a scenario would break by design; proved by a unit test of the mutation runner on an empty `mutate` set in a temporary directory
  # not-scenario: HF-10 — needs a push, an escalation (AGENTS.md rule 7); proved by the first green `ci.yml` run on the maintainer's PR

  Background:
    Given a contributor has a clean checkout with dependencies installed

  @HF-01
  Scenario: The six workspaces build, type-check and test together
    When the contributor lists the workspaces
    Then the list holds "@d2rmm/web", "@d2rmm/api", "@d2rmm/agent", "@d2rmm/contracts", "@d2rmm/telemetry" and "@d2rmm/config"
    When the contributor runs "pnpm build", "pnpm typecheck" and "pnpm test" from the repository root
    Then each command succeeds
    And each command ran in the workspaces "@d2rmm/web", "@d2rmm/api", "@d2rmm/agent", "@d2rmm/contracts", "@d2rmm/telemetry" and "@d2rmm/config"

  @HF-02
  Scenario: Every workspace uses the shared configuration presets
    When the contributor lists the TypeScript configuration of every TypeScript workspace
    Then every one extends the TypeScript preset of "@d2rmm/config"
    And the root lint and format configurations come from "@d2rmm/config"

  @HF-03
  Scenario Outline: The architecture check rejects a deliberate layer violation
    Given the violation fixture "<violation>"
    When the contributor runs the architecture check on that fixture
    Then the check fails
    And the failure names the rule "<rule>"

    Examples:
      | violation                                  | rule                      |
      | a domain file imports an adapter           | domain-is-pure            |
      | an application file imports an adapter     | application-no-adapters   |
      | a module imports another module's internal | no-cross-module-internals |
      | a module file imports the composition root | nobody-imports-main       |

  @HF-04
  Scenario: Regenerating the contracts leaves no drift
    When the contributor runs "pnpm contracts:check"
    Then the command succeeds
    And the OpenAPI document declares version "3.1" with no paths
    And the AsyncAPI document declares version "3.0" with no channels

  @HF-05
  Scenario: The five API modules exist with three layers and break no rule
    Given the violation fixtures are present in the repository
    When the contributor runs "pnpm arch"
    Then the command succeeds
    And the API modules "identity", "agents", "matchmaking", "lobby-room" and "ranking" each have the layers "domain", "application" and "adapters" and a public entry point

  @HF-07
  Scenario: The quality baseline holds the first measured values
    When the contributor reads the quality baseline
    Then the metrics "arch.violations", "lint.warnings", "tests.skipped" and "mutation.api.domain" have a measured value
    # HF-07 AC 1's null application score and AC 2 (CI and load metrics stay null) hold only until later features; proved by the baseline check at Tasks.

  # NFR-11 asks for level 4 verified in CI; this scenario proves the local gate, and HF-10 proves the CI run.
  @HF-08 @NFR-11
  Scenario: The repository stays at harness level 4 locally
    When the contributor runs "pnpm harness:gate"
    Then the command succeeds

  @HF-11
  Scenario: Only the agent is released, with agent tags
    When the contributor reads the release configuration
    Then "apps/agent" is the only released package, starting at version "0.0.0"
    And its release tags read "agent-v" followed by the version
