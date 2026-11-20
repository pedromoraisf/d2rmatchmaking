# Agent trust — Specification

**Phase**: F2 (covered by the brief's approval, ADR 029) · **Size**: Medium · **Security review**: yes (agent token,
the agent's outgoing data, the stream it accepts, the telemetry it emits)

## Problem

The brief's exit criterion "Privacy and token (NFR-04, NFR-06)" says the agent captures only the game window, sends only
structured observations, holds a revocable token that works for the agent's own routes only, and accepts data and never
commands. Today each half is true by construction but pinned in few places:

- **Token reach.** `requireAgent` guards the agent's routes, and one scenario (AWS-11) proves the token is refused on
  one site route. Nothing stops a future route from adding `requireAgent` and widening what a stolen token can do. The
  agent's surface is also wider than the PRD's wording ("heartbeat, observations and push"): it holds seven routes
  (see Decisions).
- **Revocation.** IDB-08 proves a heartbeat and the stream are cut after a revoke. The other agent routes (observation,
  characters, ready check, telemetry relay) are not proved.
- **What the agent accepts.** `StreamItem` and the SSE parser (`adapters/src/http/sse.rs`) are the only inbound data
  path. No test says that an unknown event, or an event shaped like a command, changes nothing.
- **What the agent sends.** Request bodies are contract types, but no rule says an image or frame can never reach the
  gateway, and no test pins the keys each request carries. No rule says the token is never logged, put in a span, or
  sent to another host.
- **Telemetry (F1 post-close item j).** The Party reading span carries only `matched` and `masked`; the maintainer asked
  to add `panel_open` and the field state to find field failures from traces. The existing span test pins the two-field
  set, so it changes with the span.

## Threats

| Threat                                                                                  | Answered by    |
| --------------------------------------------------------------------------------------- | -------------- |
| A stolen agent token acts as the player on the site (moderate a room, revoke, sign out) | AGT-01         |
| A revoked agent keeps working on a route nobody re-checked                              | AGT-02         |
| The token leaks through a log, a span, a crash line or a request to another host        | AGT-03         |
| The server (or whoever controls its answers) drives the player's PC                     | AGT-04         |
| A frame, a crop or a print leaves the PC; capture runs without consent or off the game  | AGT-05, AGT-06 |
| Telemetry carries a game name, a character name or a text read from the screen          | AGT-07         |

## Requirements

- **AGT-01** — The API SHALL accept an agent token only on the agent routes: `POST /v1/agents/heartbeat`,
  `GET /v1/agents/me/assignment`, `POST /v1/lobby-rooms/:id/observations`, `POST /v1/me/characters`, the ready-check
  accept, `GET /v1/stream` and `POST /v1/telemetry/traces`. Every other route SHALL answer an agent token `401`, and
  every agent route SHALL answer a session cookie alone `401`. A test SHALL list every route registered by the app with
  the guards it uses, and fail when a route outside that list uses the agent guard, so widening the token's reach needs
  a visible change to the list.
- **AGT-02** — WHEN a player revokes their agent, or pairs a new one, THEN the old token SHALL be refused on every route
  of AGT-01 on its next request, and an open stream of that agent SHALL end. A token cached by the API SHALL not outlive
  the revocation.
- **AGT-03** — The agent SHALL keep its token only in the Windows Credential Manager (AGS-06) and SHALL send it only to
  the API base of its configuration. The token SHALL NOT appear in any log line, span, span event, error text, `Debug`
  output or window message, including when a request fails.
- **AGT-04** — The agent SHALL accept from the API only data: the stream parser SHALL map a closed set of event types to
  `StreamItem` variants that carry data, and SHALL ignore an unknown event type, an unknown field and a malformed frame
  without changing any state. No `StreamItem` variant, and no field of one, SHALL name an action (a command, a script, a
  path, a URL to open, a key to press). A source-rule test SHALL list the variants and fail on a new one until it is
  reviewed.
- **AGT-05** — Every body the agent sends SHALL be a contract type with only the keys of its schema (heartbeat,
  observation, characters, telemetry). No request SHALL carry image bytes, a frame, a crop or free text read from the
  screen beyond the fields of the contract. The gateway and the HTTP adapters SHALL NOT import the frame or pixel types
  of the capture path, and SHALL have no multipart or binary upload. A print SHALL leave the PC only on an action of the
  player; the agent has no such path today, and adding one needs its own spec and this rule updated (NFR-04).
- **AGT-06** — WHILE the player has not consented, or the game is not running, the agent SHALL NOT capture a frame.
  WHEN the player withdraws consent THEN capture SHALL stop within one tick (CHR-03). The capture source SHALL be
  opened on the game window only, never the screen or another window (ADR 010).
- **AGT-07** — The Party reading span (`agent.vision.read-game-name`) SHALL record `panel_open` (boolean) and `field`,
  one of `not_read`, `empty`, `masked`, `text`, besides `matched` and `masked` (F1 post-close item j). It SHALL carry no
  text read from the screen, no game name and no character name. The span test that pinned two fields SHALL pin these
  four, and a test SHALL fail on any other field.

## Sources

| ID     | Source                                                                                          |
| ------ | ----------------------------------------------------------------------------------------------- |
| AGT-01 | NFR-06; ADR 011 (token scoped to heartbeat, observations and push); AWS-11; brief exit criteria |
| AGT-02 | NFR-06; ADR 011 (revocable token); IDB-08; AWS-10                                               |
| AGT-03 | NFR-06; ADR 011; AGS-06, AGS-09; AGENTS.md rule 6                                               |
| AGT-04 | NFR-06 ("accepts only data, never commands"); ADR 010 (no commands from the server); rule 5     |
| AGT-05 | NFR-04; ADR 010; AGENTS.md "Never do" (prints); NFR-05                                          |
| AGT-06 | NFR-04, NFR-05; ADR 010; CHR-01 to CHR-03                                                       |
| AGT-07 | NFR-04 (no personal data in telemetry), AGENTS.md rule 10; F1 post-close item j; AGN-07         |

## Requirement Traceability

| Requirement ID | Story                | Proof                                                                         |
| -------------- | -------------------- | ----------------------------------------------------------------------------- |
| AGT-01         | Stolen token         | API route-inventory test + API integration suite + acceptance `@AGT-01`       |
| AGT-02         | Revoke               | API integration test per route + acceptance `@AGT-02`                         |
| AGT-03         | Token never leaks    | Rust unit tests (core, adapters) + source-rule test                           |
| AGT-04         | Data only            | Rust unit tests on the parser + source-rule test + acceptance `@AGT-04`       |
| AGT-05         | Structured data only | Rust unit tests on request bodies + source-rule test + acceptance `@AGT-05`   |
| AGT-06         | Consent, game window | Rust unit tests (core, fake frame source) + existing source rules + `@AGT-06` |
| AGT-07         | Telemetry            | Rust unit tests with the in-memory span subscriber                            |

## User stories

- As a player, I want a stolen agent token to be useless outside the agent's own routes, so that losing it never lets
  someone act as me on the site (AGT-01).
- As a player, I want revoking my agent to cut it everywhere at once (AGT-02).
- As a player, I want the agent to never send my token, a screenshot or my character names where they should not go
  (AGT-03, AGT-05, AGT-07).
- As a player, I want the server to be unable to make the agent do anything but show me data (AGT-04).
- As a player, I want capture to happen only after I consent, and only of the game window (AGT-06).

## Decisions (conservative defaults)

- **The agent's route list is the one the code has**, seven routes, not the PRD's three words. The extra four are the
  assignment read, the stream, the ready-check accept and the telemetry relay; each is already shipped and needed.
  AGT-01 pins the list instead of narrowing it. To confirm in the phase review: whether the PRD's wording of NFR-06
  should name the seven.
- **No new route, no contract change, no new Rust crate.** The work is tests, source rules and one span change. A task
  that touches a route or a crate runs the gate lessons require.
- **Reading modules stay untouched except the span of AGT-07.** The change is two `span.record` calls and two declared
  span fields in `core/src/party.rs::apply_reading`, using values `look_of` already computes. No threshold, box, glyph
  table, anchor or `look_of` logic changes, so the real-print proof (ocr-real, ocr-variations) is not required; if
  `ocr-protection`'s guard lists `party.rs` when this lands, its span-only exception must be recorded in that PR.
  To confirm in the phase review: item j was "not asked yet"; the brief's approval is read as covering it.
- **Span values are a closed set.** `field` is one of four fixed strings, never text; the test fails on any other key.
- **No change to the 45-second offline rule, to the pairing flow or to the version gate (426).**
- **No new user-facing string**, so no i18n work (rule 9).
