# Observability tiers — Specification

**Phase**: F2 (brief Revision 2, approved 2026-11-21; ADR 037, accepted) · **Size**: Large · **Security review**: yes
(privacy of telemetry, the agent's exporter, the site's exporter, the relay)

## Problem

On 2026-11-21 the field tests could not be followed in Grafana. The API exported 10% of its traces, the agent and the
site exported nothing (AD-098), and no span said which account, room or read it was about. The orchestrator rebuilt one
journey by `url.path` and `d2r.room.id` alone. ADR 037 decides two tiers:

- **Full** (`deployment.environment` = `staging`, `preview`, `development`): every useful field, including the player's
  BattleTag and character names, the text the OCR read and each correction applied, and names read on screen.
- **Production**: ids (UUIDs of account, agent, room, run, ticket, ready check) and all non-personal game data
  (generated game name, difficulty, act, mode, screen, confidence, correction classes, capture method, timings). Never a
  BattleTag, a character name, text read from the screen or the chat, pixels or crops.

What exists today:

- API: `packages/telemetry` redacts by key (`redact-attributes.ts`, `FORBIDDEN_WORDS` holds `battletag`) in every
  environment; `apps/api/src/main/config.ts` reads `D2RMM_ENV` (`local`, `staging`, `production`); SNM-04 and
  `name-leak-scan.ts` forbid a read name in every span, log and row.
- Agent: `adapters/src/telemetry/sanitize.rs` keeps 14 attribute keys and fixed vision words; it exports only when the
  build sets `D2RMM_TELEMETRY=on` (no workflow does), with `deployment.environment` `development` or `production` from
  the profile. The build channel (`D2RMM_CHANNEL`: `preview`, `staging`, `production`, `src/channel.rs`) already exists.
- Site: exports only when the build sets `VITE_TELEMETRY=on` (the e2e build). The site is built once and promoted
  (ADR 033), so a build-time tier would be wrong in one of its two environments.
- Agent and site spans reach Grafana through the API relay (`/v1/telemetry/traces`), which forwards bodies unchanged.

## Requirements

### Tier

- **OBT-01** — Each app SHALL decide its tier from its environment once, at start: the API from `D2RMM_ENV` in `main/`
  (ADR 032); the agent from its compile-time channel (`preview` and `staging` → full, `production` and a build without a
  channel → production); the site from the API's public boot configuration (a `telemetryTier` field set by the API from
  `D2RMM_ENV`). WHEN the tier is unknown or cannot be read THEN the app SHALL use **production**.
- **OBT-02** — Every exported span, log record and metric resource SHALL carry `deployment.environment` with the
  environment's name and `d2r.telemetry.tier` (`full` or `production`).

### What each tier carries

- **OBT-03** — In both tiers, the API's application spans SHALL carry the ids their use case knows: `d2r.account.id`,
  `d2r.agent.id`, `d2r.room.id`, `d2r.run.id`, `d2r.ticket.id`, `d2r.ready_check.id`, and the game data
  `d2r.game.name` (the generated name), `d2r.difficulty`, `d2r.queue.mode`, `d2r.room.stage`. Metrics SHALL NOT gain an
  id label (bounded cardinality, `telemetry.md`).
- **OBT-04** — In the full tier, the API's spans SHALL also carry the player's `d2r.account.battletag`, the character's
  `d2r.character.name`, and, on `lobby.record-observation` and `identity.record-characters`, the read text
  (`d2r.observation.read_text`) and the names read (`d2r.observation.read_names`).
- **OBT-05** — In both tiers, the agent SHALL export its spans (AD-098 lifted) through the relay, sampled at 100% in the
  full tier and at the production ratio otherwise, with `d2r.agent.id`, `d2r.room.id`, `d2r.run.id`, `d2r.game.name`,
  `d2r.difficulty`, the recognised screen, capture method, read confidence, the correction classes applied
  (`d2r.ocr.corrections`, e.g. `rn>m`) and step timings.
- **OBT-06** — In the full tier, the agent's spans SHALL also carry the text the OCR read (`d2r.ocr.text`), the character
  names read on the selection screen and the names read in the Party panel and the chat (`d2r.ocr.names`).
- **OBT-07** — In both tiers, the site SHALL export its spans through the relay, with `d2r.account.id`, `d2r.room.id`,
  `d2r.ticket.id`, `d2r.ready_check.id` and the action (`site.<area>.<action>`); in the full tier also the signed-in
  BattleTag.

### Production redaction (the proof)

- **OBT-08** — WHILE the tier is production, the API, the agent and the site SHALL drop, before export, every attribute,
  event attribute, log body field and resource key that is staging-only (OBT-04, OBT-06, OBT-07's BattleTag), and every
  value that is a name or text read from the screen under any key a library can carry it in (lessons: "test every
  attribute key"). The redaction SHALL be one pure function per app with unit tests that feed every staging-only key and
  assert none survives, and a test that feeds the same spans in the full tier and asserts they survive.
- **OBT-09** — `name-leak-scan.ts` SHALL run the API's name-leak scenarios in the production tier and still find no
  read name in any span, log, answer or row; in the full tier the same scenarios SHALL find the names only in spans and
  logs, never in a stored row, an outbox row, an event or a response that SNM-04 forbids.
- **OBT-10** — A source rule (harness test) SHALL fail when an agent or site source sets a staging-only key outside the
  module that applies the tier, so a new field cannot skip the redaction.
- **OBT-11** — Credentials SHALL never be exported in any tier: tokens, cookies, pairing codes, authorization headers,
  IP addresses, user agents, pixels and crops stay redacted as today (OBS-28, OBS-29, AD-107).

### Using it

- **OBT-12** — WHEN the site runs in the full tier THEN it SHALL show a notice on every page that everything done on
  this environment is recorded for debugging, in English and pt-BR.
- **OBT-13** — `docs/engineering/telemetry.md` SHALL say what each tier carries (one table per app), how to find a
  journey in Grafana by `d2r.room.id`, `d2r.account.id` and `d2r.ticket.id` (TraceQL run once against
  `grafanacloud-traces`), and that the egress numbers must be re-measured (ADR 037 consequence).

### The player's switch (maintainer decision 2026-11-22; security review of PR #148)

- **OBT-14** — The agent window SHALL show a notice of what the diagnostics carry in this build's tier, in English and
  pt-BR, next to a "Send diagnostics" switch: in the production tier, ids, game data and timings and no names or read
  text; in the full tier, also the names and the text read, and that the full tier exists on staging and preview builds
  only. WHEN the window cannot read the setting THEN it SHALL still show the switch, as on, with an error line.
- **OBT-15** — The "Send diagnostics" switch SHALL be on by default and SHALL persist across restarts in the agent's own
  settings on this PC, never on the server. WHEN the file is missing THEN the switch SHALL read as on; WHEN the file exists but is unreadable, malformed
  or not a boolean flag THEN it SHALL read as off. A save SHALL write a temporary file beside it and rename it, so a failed
  write leaves the previous choice.
- **OBT-16** — WHILE the switch is off the agent SHALL export no span: every ended span is dropped before it is queued
  and the export loop discards what was queued, so the relay client is never called and no request leaves the PC for the
  relay. The change SHALL take effect at once, without a restart.
- **OBT-17** — The switch SHALL NOT affect heartbeats, observations, presence, pairing, the remote configuration or any
  other request the matchmaking needs; it governs the diagnostics export only.

## Sources

- ADR 037 (accepted 2026-11-21), brief Revision 2 (approved 2026-11-21): OBT-01 to OBT-13.
- NFR-09 (OpenTelemetry in the three apps): OBT-02, OBT-03, OBT-05, OBT-07.
- NFR-04 (privacy) as amended for telemetry by ADR 037: OBT-06, OBT-08, OBT-09, OBT-10.
- ADR 032 (config from the environment, read in `main/`), ADR 033 (build once, promote): OBT-01.
- ADR 036 / SNM-04 (names read on screen), AD-107, OBS-28, OBS-29: OBT-09, OBT-11.
- NFR-12 (i18n): OBT-12, OBT-14.
- NFR-04, NFR-05 (privacy, consent) and ADR 037: OBT-14 to OBT-17 (security review of PR #148: a notice and an opt-out).

## Requirement Traceability

| Requirement ID | Story                 | Proof                                                                                                                                                                                                                            |
| -------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OBT-01         | Tier                  | unit tests per app (API config, agent channel, site boot) + acceptance `@OBT-01`                                                                                                                                                 |
| OBT-02         | Resource              | unit tests on each resource builder                                                                                                                                                                                              |
| OBT-03         | API ids               | API unit tests on the span attributes + traced acceptance `@OBT-03`                                                                                                                                                              |
| OBT-04         | API full              | API unit tests in the full tier + traced acceptance `@OBT-04`                                                                                                                                                                    |
| OBT-05         | Agent export          | Rust unit tests on the export config and the sanitizer                                                                                                                                                                           |
| OBT-06         | Agent full            | Rust unit tests on the sanitizer in the full tier                                                                                                                                                                                |
| OBT-07         | Site export           | site unit tests on the telemetry start and the span attributes                                                                                                                                                                   |
| OBT-08         | Redaction             | one pure redaction function per app with unit tests in both tiers                                                                                                                                                                |
| OBT-09         | Name leak             | `name-leak-scan` in both tiers (API integration tests)                                                                                                                                                                           |
| OBT-10         | Source rule           | harness test with a fixture that sets a staging-only key outside the tier module                                                                                                                                                 |
| OBT-11         | Credentials           | the existing redaction tests, run in both tiers                                                                                                                                                                                  |
| OBT-12         | Notice                | component test (en, pt-BR) + acceptance `@OBT-12`                                                                                                                                                                                |
| OBT-13         | Docs                  | `telemetry.md` in review; the TraceQL query run once on `grafanacloud-traces`                                                                                                                                                    |
| OBT-14         | Notice                | agent window component test (en, pt-BR); not in acceptance (the agent window is not in the stack)                                                                                                                                |
| OBT-15         | Default, persist      | Rust unit tests on the settings store (default on, read back, existing unreadable → off, failed write keeps the choice)                                                                                                          |
| OBT-16         | Zero export           | Rust unit tests: switch off → the exporter is never called, spans never queued; live toggle                                                                                                                                      |
| OBT-17         | Matchmaking untouched | `diagnosticsSwitchViolations` in `scripts/test/agent-source-rules.test.mjs` ("the diagnostics switch is read only by the span processor and the export loop (OBT-17)") with the `diagnostics-switch-leak` fixture it must reject |

## Decisions (conservative defaults)

- **The site's tier comes from the API at run time, not from the build.** ADR 037 § 3 says "the build-time config of
  the agent and the site"; the site is built once and promoted (ADR 033), so a build-time tier would make the promoted
  production build carry the staging tier. The API already serves the site's boot configuration from `D2RMM_ENV`, read
  in `main/`. Reversible: one field. To confirm in `decisions.md`.
- **Unknown means production** in every app: the stricter tier is the safe failure.
- **Logs**: the API's logs follow the same tier as its spans; the agent and the site send no logs (unchanged).
- **Metrics stay without ids** in both tiers: ADR 037 is about debugging journeys, and an id label would break the
  bounded cardinality rule and the free tier's series limit.
- **The relay stays a byte forwarder.** Redaction happens at the source (agent sanitizer, site exporter), where the
  tier is known; parsing every OTLP body on the free API would cost CPU and egress. A production agent pointed at
  staging (or the reverse) is not possible: the channel fixes both the API base and the tier.
- **Production sampling ratio for the agent and the site** stays the current default of the exporters (the API's
  production ratio is the maintainer's Render variable).
