# Roadmap

Source: PRD § Roadmap. Each phase is one kickoff (brief approved with delegation) and one review (`review.md`).
`pnpm specs:check` verifies that every FR/NFR of the PRD has exactly one primary phase below, and that an approved
phase brief covers every requirement assigned to that phase.

| Phase | Name | Goal | Exit (summary) |
| --- | --- | --- | --- |
| <a id="f0"></a>F0 | Walking skeleton | Prove architecture, pipelines, observability and harness end to end with no real feature | "Test room becomes Created" across web, API, agent; three pipelines live; one trace end to end; L4; load baseline ≥ 100 players |
| <a id="f1"></a>F1 | Match core | Login, characters, queues, ready check, rooms, runs | J1/J2 playable with agents confirming presence |
| <a id="f2"></a>F2 | Agent with presence | Robust capture cascade, OCR, fusion, assisted typing, remote config | Read rate ≥ 95% on fixtures and real sessions; NFR-02/03 |
| <a id="f3"></a>F3 | Competition | PvP score by paired observations, disputes, ELO, ranking, live rooms | J3/J5; ranking boards per difficulty |
| <a id="f4"></a>F4 | Closed beta | Hardening, moderation, LGPD, signing, regions | Beta in Americas/Europe/Asia; success metrics instrumented |

## Requirement coverage

Primary phase = the phase whose review must prove the requirement. Earlier phases may build pieces of it (e.g. F0
stubs login); later phases may harden it. Proposed by the pre-foundation; each kickoff confirms or moves rows (a move
is recorded as an AD in STATE.md).

| Phase | Requirements |
| --- | --- |
| F0 | FR-03, FR-29, NFR-07, NFR-08, NFR-09, NFR-10, NFR-11, NFR-14 |
| F1 | FR-01, FR-02, FR-04, FR-05, FR-06, FR-07, FR-08, FR-09, FR-10, FR-11, FR-12, FR-13, FR-14, FR-15, FR-16, FR-17, FR-18, FR-31, FR-32, NFR-01, NFR-12, NFR-13 |
| F2 | FR-27, FR-28, NFR-02, NFR-03, NFR-04, NFR-06 |
| F3 | FR-19, FR-20, FR-21, FR-22, FR-23, FR-24, FR-25, FR-26, FR-30 |
| F4 | NFR-05 |

Before F1 kickoff, the maintainer settles two domain questions (see `docs/domain/invariants.md`): the ready-check
decliner penalty and the 1v1 dispute conflict of interest.
