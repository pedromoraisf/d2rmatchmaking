# ADR 037 — Telemetry in two tiers: everything on staging, everything but people's identities in production

**Status**: Accepted
**Date**: 2026-11-21 (accepted 2026-11-21: the maintainer asked for "o máximo de dados que podemos levar para a
telemetria sem esbarrar em riscos legais — IDs, nomes, correções, TUDO" and approved the two tiers below with "aprovo")
**Deciders**: maintainer
**Amends**: AD-098 (site and agent telemetry off in production), NFR-04 as applied to telemetry, the "no names" clauses of
span requirements (e.g. ARL-07, AST-10, SCR-09, RCF-11, GNR-10 for telemetry only)

## Context

On 2026-11-21 the orchestrator could follow a player's journey in Grafana only by inference: the API exported 10% of its
traces, the agent and the site exported nothing (AD-098), and no span said which account, room or read it was about. The
maintainer wants to debug field tests in real time from the traces. The legal limit is third parties: the Party panel
and the chat show other players' names, people who never agreed to anything (LGPD: personal data needs a legal basis).

## Decision

1. **Staging and per-PR test installers (`deployment.environment` = `staging` or `preview`)**: every signal exports
   everything useful: account, agent, room, run, ticket and ready-check ids; the player's BattleTag and character names;
   the text the OCR read, each correction applied (`rn>m`, `k>h`…), confidence, region, capture method, recognised
   screen and the timing of each step; game data (game name, difficulty, act, mode); names read on screen. Staging users
   are the maintainer and bots; anyone else who tests staging is shown a notice that everything is recorded. API
   sampling on staging is 100% (`OTEL_TRACES_SAMPLER_ARG=1`, set by the maintainer).
2. **Production**: the agent and the site export too (AD-098 is lifted), with everything except what identifies a
   person: internal ids (UUIDs of account, agent, room, run, ticket) are allowed so a journey can be followed; all
   non-personal game data is allowed (generated game name, difficulty, screen, confidence, OCR correction classes,
   capture method, timings). **Never** in production telemetry: BattleTags, character names, any text read from the
   screen or chat that can hold a player's name, pixels or crops.
3. **One switch**: the tier comes from the environment (`deployment.environment`), read in `main/` (API, ADR 032) and in
   the build-time config of the agent and the site; a source rule or test proves that production builds redact the
   staging-only fields. Retention is the Grafana Cloud free default.
4. A legal review of the privacy policy happens before the service opens to the public (not an F2 item).

## Consequences

- Field tests are debuggable from Grafana alone; the orchestrator follows a journey by room or account id.
- Telemetry volume grows on staging (100% sampling, larger spans); production volume grows with agent and site spans.
  The egress budget numbers in `docs/engineering/telemetry.md` must be re-measured.
- Specs that say "no names" in spans keep that rule for production and gain a staging exception; tests pin both tiers.
