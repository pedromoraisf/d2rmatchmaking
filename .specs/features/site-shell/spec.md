# Site shell from the prototype — Specification

**Phase**: F1 · **Size**: Medium · **Origin**: maintainer, 2026-11-10 — "Use o último protótipo (artefato) adequando as
capacidades que são requisitos da entrega", read as: the F1 site takes the look and flows of the prototype artifact
"D2R Match Making" (2026-10-30), adapted to what F1 delivers.

## Problem

The F1 site has no styling: F0 shipped bare HTML. The maintainer's prototype fixes the look (dark stone, gold engraving,
blood-red calls to action, Cinzel / Alegreya Sans / IBM Plex Mono) and the frame (a sticky header with the brand, the
sections, the agent's state and the Battle.net account; a main column and a status column). This feature builds that
frame and theme for the screens F1 already has. Later F1 features (queues, ready-check, lobby-rooms) build their own
screens inside it, following the prototype's matching parts.

## Adapting the prototype to F1 (what is not copied)

| Prototype                                        | F1 site                                                                 |
| ------------------------------------------------ | ----------------------------------------------------------------------- |
| Simulated players, rooms, counts, ELO, read rate | Real data only; a value F1 does not have is not shown                   |
| Portuguese copy hard-coded                       | English source strings and pt-BR translations (NFR-12)                  |
| "Salas ao vivo" and "Ranking" sections           | Not in F1 (F3); the navigation shows only the sections that exist       |
| Game password, "declining gives 5 minutes"       | No password (ADR 017); declining has no penalty (FR-13, brief)          |
| Muted text and gold-dim lines on dark panels     | AA contrast for every text (NFR-13): 4.5:1 body, 3:1 large and UI parts |
| Mouse-first controls                             | Every control reachable and usable by keyboard, visible focus (NFR-13)  |

## Requirements

- **SHL-01** — The site SHALL use the prototype's theme as design tokens (colours, fonts, panel, button and tag styles)
  in one stylesheet, with every text colour pair meeting WCAG AA contrast.
- **SHL-02** — WHILE a player is signed in, the header SHALL show the brand, the sections that exist, the agent's state
  (no agent, offline, online with the game closed, online with the game open) and the Battle.net display name with a
  sign-out control; WHILE signed out it SHALL show the brand and the sign-in controls.
- **SHL-03** — The home page SHALL lay out the player's content in a main column (characters and, later, queues and
  rooms) and a status column (the agent panel: online, game, current screen; and the agent download), collapsing to
  one column under 980 px wide without horizontal scrolling at 360 px.
- **SHL-04** — The character list SHALL show each character as a card with the class mark, name, class, level, mode,
  ladder, era and the unlocked difficulties as coloured tags (Normal, Nightmare, Hell), as in the prototype.
- **SHL-05** — Every interactive element SHALL be reachable by Tab in reading order and show a visible focus outline,
  and the page SHALL keep a single `h1` and landmark regions (`header`, `nav`, `main`, `footer`).
- **SHL-06** — Every user-facing string of the shell SHALL come from the translation files in English and pt-BR, and
  the non-affiliation notice and the agent download link SHALL stay on every page.

## Sources

| ID     | Source                                      |
| ------ | ------------------------------------------- |
| SHL-01 | Maintainer, 2026-11-10 (prototype); NFR-13  |
| SHL-02 | Prototype header; FR-01, FR-05              |
| SHL-03 | Prototype "Partida" layout; FR-05           |
| SHL-04 | Prototype character cards; FR-02            |
| SHL-05 | NFR-13                                      |
| SHL-06 | NFR-12; AGENTS.md rule 9; F0 AWS-17, AWS-38 |

## Requirement Traceability

| Requirement ID | Story  | Proof                                                                    |
| -------------- | ------ | ------------------------------------------------------------------------ |
| SHL-01         | Theme  | unit test computing the contrast of every text token pair on its surface |
| SHL-02         | Header | acceptance `@SHL-02` + component tests                                   |
| SHL-03         | Layout | acceptance `@SHL-03`                                                     |
| SHL-04         | Cards  | acceptance `@SHL-04` + component tests                                   |
| SHL-05         | Access | acceptance `@SHL-05`                                                     |
| SHL-06         | i18n   | i18n lint + locale completeness test                                     |

## Decisions

- Fonts load from Google Fonts (the prototype's three families); system fonts are the fallback.
- No new runtime dependency: plain CSS with custom properties, imported once by the app.
- The prototype's rune ranks, ELO card and queue counters wait for the features that have that data.
