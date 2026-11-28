# Roadmap

Source: PRD § Roadmap, replanned on 2026-11-28 around `docs/product/direction-2026-11.md` (AD-178, AD-179). Each
phase is one kickoff (brief approved with delegation) and one review (`review.md`). `pnpm specs:check` verifies that
every FR/NFR of the PRD has exactly one primary phase below, and that an approved phase brief covers every requirement
assigned to that phase.

| Phase             | Name                | Goal                                                                                                      | Exit (summary)                                                                                                                            |
| ----------------- | ------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="f0"></a>F0 | Walking skeleton    | Prove architecture, pipelines, observability and harness end to end with no real feature                  | "Test room becomes Created" across web, API, agent; three pipelines live; one trace end to end; L4; load baseline ≥ 100 players           |
| <a id="f1"></a>F1 | Match core          | Login, characters, queues, ready check, rooms, runs                                                       | J1/J2 playable with agents confirming presence                                                                                            |
| <a id="f2"></a>F2 | Agent with presence | Robust capture cascade, OCR, fusion, assisted typing, remote config                                       | Read rate ≥ 95% on fixtures and real sessions; NFR-02/03                                                                                  |
| <a id="f3"></a>F3 | Open rooms          | The new product end to end with platform rooms, in the new identity: room list, create, join, quick match | J3 playable on staging; every designed screen but the ranking built; the game-search screen read on real prints with no wrong reading     |
| <a id="f4"></a>F4 | Spotted rooms       | Regular D2R games seen by agents fill the list next to platform rooms; the product is launchable          | J6 on staging with two real PCs: a spotted room appears, goes stale, expires, and is removed when the game answers that it does not exist |
| <a id="f5"></a>F5 | Competition         | PvP score by paired observations, disputes, ELO, ranking                                                  | J1/J5; ranking boards per difficulty                                                                                                      |
| <a id="f6"></a>F6 | Closed beta         | Hardening, moderation, LGPD, signing, regions                                                             | Beta in Americas/Europe/Asia; success metrics instrumented                                                                                |

## Requirement coverage

Primary phase = the phase whose review must prove the requirement. Earlier phases may build pieces of it (e.g. F0
stubs login); later phases may harden or revise it. Proposed by the pre-foundation; each kickoff confirms or moves rows
(a move is recorded as an AD in STATE.md).

| Phase | Requirements                                                                                                                                                |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F0    | FR-03, FR-29, NFR-07, NFR-08, NFR-09, NFR-10, NFR-11, NFR-14                                                                                                |
| F1    | FR-01, FR-02, FR-04, FR-05, FR-06, FR-07, FR-08, FR-09, FR-10, FR-11, FR-12, FR-13, FR-14, FR-15, FR-16, FR-17, FR-18, FR-31, FR-32, NFR-01, NFR-12, NFR-13 |
| F2    | FR-27, FR-28, NFR-02, NFR-03, NFR-04, NFR-06                                                                                                                |
| F3    | FR-25, FR-26, FR-33, FR-37                                                                                                                                  |
| F4    | FR-34, FR-35, FR-36                                                                                                                                         |
| F5    | FR-19, FR-20, FR-21, FR-22, FR-23, FR-24, FR-30                                                                                                             |
| F6    | NFR-05                                                                                                                                                      |

## What the replanning of 2026-11-28 changed

- The old F3 (Competition) is split. The room list (FR-25, FR-26) and the new FR-37 open F3; the score, disputes, ELO
  and ranking (FR-19…FR-24, FR-30) move to F5; the old F4 (Closed beta) becomes F6 (AD-178).
- Rooms spotted in game take their own phase, F4 (FR-34…FR-36). The reading of the game-search screen (FR-33) stays in
  F3 as an agent-only feature that sends nothing, because reading logic took the longest in F2 and needs the
  maintainer's real prints (AD-179).
- F3 revises the wording, not the primary phase, of requirements F1 already proved: FR-02, FR-06, FR-07, FR-12, FR-14,
  FR-18 and FR-31 (AD-180…AD-182). The F3 brief lists them and its review proves the revised behaviour.
- F2 carry-overs (AD-186): the 125,000 bytes per player-hour target goes to F3 (the live list changes the stream);
  the 95 % share of synthetic variations and ultrawide/4:3 go to F4; SignPath and agent promotion (delivery-platform
  T11b-2) go to F6.

Before the F5 kickoff, the maintainer settles the 1v1 dispute conflict of interest (see `docs/domain/invariants.md`).
The ready-check decliner penalty was settled on 2026-11-10 (no penalty for now).
