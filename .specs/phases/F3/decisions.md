# Phase F3 — decisions

What the maintainer should see in the review. Routine decisions live in each feature PR's description.

## To confirm

| Feature | Decision                                                                                                                                                                                                                  | Why                                                                                | Reversal cost                                                             |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| all     | **The replanning defaults (AD-178, AD-179, AD-183, AD-184, AD-186)** were adopted from the conservative options shown on 2026-11-28, without a one-by-one answer; the brief lists them under "Decisions already taken"    | the maintainer answered the identity and the prints and told the runner to proceed | each is a constant, a guard or a roadmap row; none needs a data migration |
| all     | **`phase/F3` starts from `main` plus `docs/spotted-rooms-direction`** (the direction, the replanning, the canvas source and the logo masters), merged directly into the phase branch; they reach `main` with the phase PR | the brief and every spec cite those files                                          | merge the docs branch into `main` on its own                              |

## Blocked

| Feature / task | What failed | Last error | What each attempt changed | Options |
| -------------- | ----------- | ---------- | ------------------------- | ------- |

## Waiting on the maintainer

| Feature               | Item                                                                                                                                                                 | Asked      | Answer                                                     |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------- |
| `game-search-reading` | The real prints of the game-search screen: list (top and scrolled), a selected game, every join answer; English and pt-BR; windowed and full screen (brief, input 1) | 2026-11-28 | 2026-11-28, user: "Sobre as prints vou fazer na sequência" |
| `design-system`       | Accept ADR 041 (brief, input 2)                                                                                                                                      | 2026-11-28 | pending                                                    |
| `stream-budget`       | The 125,000 bytes target as an exit criterion (brief, input 3)                                                                                                       | 2026-11-28 | pending                                                    |
| `game-search-reading` | New ratchet metrics in `.quality-baseline.json` after the first green run (brief, input 4)                                                                           | 2026-11-28 | pending                                                    |
| `site-home`           | Hero art: drawn in code around the mascot, or an illustration of the maintainer's (brief, input 5)                                                                   | 2026-11-28 | pending                                                    |
| `agent-telemetry-fix` | Telemetry egress: room-path spans only and vision spans at 1 % in production, 1 % everywhere, or accept the share (brief, input 6)                                   | 2026-11-24 | pending                                                    |
| `pt-br-select-screen` | Two pt-BR selection prints: cards listed, and the difficulty popup open (brief, input 7)                                                                             | 2026-11-24 | pending                                                    |
| F4                    | Accept ADR 039 and ADR 040 before the F4 kickoff                                                                                                                     | 2026-11-28 | pending                                                    |
