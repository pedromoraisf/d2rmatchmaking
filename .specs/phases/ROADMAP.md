# Roadmap

Source: PRD § Roadmap. Each phase is one kickoff (brief approved with delegation) and one review (`review.md`).

| Phase | Name | Goal | Exit (summary) |
| --- | --- | --- | --- |
| <a id="f0"></a>F0 | Walking skeleton | Prove architecture, pipelines, observability and harness end to end with no real feature | "Test room becomes Created" across web, API, agent; three pipelines live; one trace end to end; L4; load baseline ≥ 100 players |
| <a id="f1"></a>F1 | Match core | Login, characters, queues, ready check, rooms, runs | J1/J2 playable with agents confirming presence |
| <a id="f2"></a>F2 | Agent with presence | Robust capture cascade, OCR, fusion, assisted typing, remote config | Read rate ≥ 95% on fixtures and real sessions; NFR-02/03 |
| <a id="f3"></a>F3 | Competition | PvP score by paired observations, disputes, ELO, ranking, live rooms | J3/J5; ranking boards per difficulty |
| <a id="f4"></a>F4 | Closed beta | Hardening, moderation, LGPD, signing, regions | Beta in Americas/Europe/Asia; success metrics instrumented |

Before F1 kickoff, the maintainer settles two domain questions (see `docs/domain/invariants.md`): the ready-check
decliner penalty and the 1v1 dispute conflict of interest.
