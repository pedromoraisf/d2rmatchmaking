# Acceptance scenarios for agent-release (ADR 023). English Gherkin. Executed as-is by tests/acceptance (playwright-bdd).
# The steps arrive with the feature PR, never before (lessons: playwright-bdd fails on a feature file without its steps).
# The release itself runs on GitHub Actions on `windows-latest`, so what a browser can observe is the site; the order of the
# jobs and the assets are proved by harness tests and unit tests.
# not-scenario: AGR-01 — proved by the harness test on the job graph of release-agent.yml and by the first real signed run
# not-scenario: AGR-02 — proved by the harness test (one publication, in its own job, after `sign`) and a failed-sign run
# not-scenario: AGR-03 — proved by unit tests of scripts/agent/release-assets.mjs on drawn asset sets
# not-scenario: AGR-04 — proved by unit tests on the Authenticode verdict and by the first real signed run
# not-scenario: AGR-05 — proved by the harness tests on release-agent.yml and agent.yml (channel, no release from a preview)
# not-scenario: AGR-06 — proved by unit tests of the publish helper (public, draft, older tag)
# not-scenario: AGR-07 — proved by the release links of agent 0.4.0 and the maintainer's update check on an installed 0.3.0
# not-scenario: AGR-09 (signed) — the signed variant is a build-time setting and the acceptance stack serves one build; proved by the
#   Layout component tests (English and pt-BR) and the unit tests of `installerIsSigned`
# not-scenario: AGR-10 — proved by the harness tests on secrets, install scripts, pins and the artifact id, and the security review
# not-scenario: AGR-11 — proved by review and a harness test that the runbook names every variable and secret the workflow reads

Feature: The site is honest about the installer and publishes how it is signed
  A player who downloads the agent can see whether the installer is signed, and the code signing policy that SignPath
  Foundation asks every project to publish is on the site, in both languages.

  @AGR-08 @FR-29 @NFR-04 @web
  Scenario Outline: The code signing policy page says who signs, who approves and what the program does
    Given the browser prefers "<language>"
    When a visitor opens the code signing policy page
    Then the page names the project and its licence
    And the page says free code signing is provided by SignPath.io with a certificate from SignPath Foundation
    And the page lists who commits, who reviews and who approves a signing request
    And the page says the agent reads only the game window's pixels and operating-system signals
    And the page has a privacy statement

    Examples:
      | language |
      | en-US    |
      | pt-BR    |

  @AGR-08 @FR-29 @web
  Scenario: The footer links to the policy page
    When a visitor opens the site
    And the visitor follows the code signing policy link in the footer
    Then the code signing policy page opens

  @AGR-09 @FR-29 @web
  Scenario: An unsigned installer is announced next to the download link
    When a visitor opens the site
    Then the download link is shown with the SmartScreen note beside it
