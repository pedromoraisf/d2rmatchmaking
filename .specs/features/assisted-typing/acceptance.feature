# Acceptance scenarios for assisted-typing (ADR 023). English Gherkin. Executed as-is by tests/acceptance (playwright-bdd).
# The typing helper was withdrawn by the maintainer on 2026-11-22 ("o usuario copia o valor pelo site, e da ctrl+v nativo no
# jogo"). The scenarios of the withdrawn requirements AST-02 … AST-07 (and AST-08's fill status line) were removed with
# their step definitions in batch 4. What remains is the site's copy button (AST-11).
#
# not-scenario: AST-01 — proved by Rust unit tests (combination rules, hotkey registered only while a ready check is open) and the window component test
# not-scenario: AST-02 — withdrawn (maintainer, 2026-11-22); its scenarios and steps were removed with the code
# not-scenario: AST-03 — withdrawn (maintainer, 2026-11-22); its scenarios and steps were removed with the code
# not-scenario: AST-04 — withdrawn (maintainer, 2026-11-22); its scenarios and steps were removed with the code
# not-scenario: AST-05 — withdrawn (maintainer, 2026-11-22); its scenarios and steps were removed with the code
# not-scenario: AST-06 — withdrawn (maintainer, 2026-11-22); its scenarios and steps were removed with the code
# not-scenario: AST-07 — withdrawn (maintainer, 2026-11-22); its scenarios and steps were removed with the code
# not-scenario: AST-08 — proved by Rust unit tests (view, the hotkey.unavailable and hotkey.unmatched span events) and the window component tests; the fill status scenario was withdrawn
# not-scenario: AST-09 — withdrawn (maintainer, 2026-11-22); the harness source rules now forbid every input name, with no exception (`pnpm test:harness`)
# not-scenario: AST-10 — proved by the locales tests and the web component test

Feature: The player copies the game name from the site and the agent types nothing
  The host copies the room's game name with the site's copy button and pastes it in the game with the game's own Ctrl+V.
  The agent sends nothing to the game.

  Background:
    Given Alice and Bob accepted a ready check for a GM duel on Hell in the Americas, Alice first
    And each has a headless agent with capture consent

  @AST-11 @FR-28 @NFR-13 @web
  Scenario: The player copies the game name with the copy button, by keyboard
    When Bob opens the site
    Then using only the keyboard he can copy the game name and reach "Leave room"
