# Remote configuration — Design

The agent keeps its hexagonal shape (ADR 027) and the API its modular monolith (ADR 006): the configuration is a thin read
path in the **Agents** module, a pure value type in the agent's domain, and one loop in the agent's core. No new service, no
new table, no new secret.

## Principle

The server sends **data**; the agent decides what to do with it. Between the wire and the reading there is one pure function,
`RemoteConfig::from_wire(body, held) → Effective`, that clamps every number into a range owned by the agent, drops what it
does not know, falls back field by field to the built-in default and refuses an older version. Everything downstream reads
`Effective`, never the body. A configuration can make the agent read worse; it has no field that makes it read more, faster
or elsewhere (RCF-05, RCF-09), and none that names an action (RCF-10).

## What is in the document (closed schema, v1)

| Section      | Fields (all optional; each with a range in the contract and in the agent)                                                                                 | Replaces today's constant                                                 |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `cadence`    | `demoteAfter` 1–10, `probeEvery` 60–600, `rateWindow` 10–600 (capture cascade); `lookIntervalMs` 1000–10000; the screen search cadences (once merged)     | `DEMOTE_AFTER`, `PROBE_EVERY`, `RATE_WINDOW`, `TICK`, the search cadences |
| `thresholds` | the named numeric limits of the reading that today are constants (`trackPad`, confidence limits, ink deltas); only those a field result asked for         | `TRACK_PAD`, `MIN_INK_DELTA`, and the like                                |
| `regions`    | named areas (`hudBand`, `automapArea`, `partyArea`) as `{x, y, width, height}` fractions of the reference client, inside 0–1 with a minimum size          | the reading areas of `layout.rs`                                          |
| `phrases`    | per language (`en`, `pt-BR`): the Party words and the chat "joined" and "left" phrases, each a literal of letters, digits, spaces and accents, ≤ 40 chars | the words of `resources/lang/en.json`, the chat phrases                   |

`version` is a whole number that only grows; `0` is the built-in defaults. The document is at most 64 KiB. There is no field
for consent, capture, hotkeys, the API base, the token or the heartbeat interval.

## API side (Agents module)

| Layer       | File (`apps/api/src/…`)                          | Change                                                                                                                                                                                                           |
| ----------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| contracts   | `packages/contracts/src/http/agent-config.ts`    | `AgentConfig` (Zod, closed objects, ranges), `AgentConfigResponse`; regenerates `openapi.json` and JSON Schema                                                                                                   |
| domain      | `modules/agents/domain/agent-config.ts`          | `parseAgentConfig(json)`: validates the file against `AgentConfig`; computes the `ETag` from the version                                                                                                         |
| application | `modules/agents/application/get-agent-config.ts` | `getAgentConfig({ ifNoneMatch })` → `{ status: 200, body, etag } \| { status: 304 }`; no account data                                                                                                            |
| adapters    | `modules/agents/adapters/http/routes.ts`         | `GET /v1/agents/config` behind `requireAgentVersion` and `requireAgent`; `ETag`, `If-None-Match`, `Cache-Control: no-cache`                                                                                      |
| config file | `modules/agents/config/agent-config.json`        | the committed document, version 1, built-in values; loaded by `main/` and validated at start (ADR 032 III)                                                                                                       |
| main        | `main/local.ts`, `main/render.ts`                | read the file once at start and hand the parsed value to the module; a bad file stops the start                                                                                                                  |
| test only   | `main/test-controls.ts`                          | `PUT /v1/test/agent-config` (staging composition only, never `render.ts`): serve a raw body or none, so a scenario can send a value outside the range or a broken body; the `render-no-test-controls` rule stays |

The route is the 9th an agent token reaches: `main/__tests__/agent-route-table.ts` and AGT-01's test list it (a decision to
confirm). Nothing is stored per agent and nothing is written: the handler returns the same bytes to every caller, which
keeps the API stateless (ADR 032 VI) and costs one comparison per request (NFR-14).

## Agent side

| Layer   | File (`apps/agent/src-tauri/…`)                         | Change                                                                                                              |
| ------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| domain  | `domain/src/remote_config.rs` (new)                     | `Ranges` (the agent's own limits), `Defaults` (today's constants), `Effective`, `from_wire`; pure, no I/O, no clock |
| core    | `core/src/remote_config.rs` (new)                       | `run` loop: fetch on start and every six hours with `If-None-Match`, backoff, apply through a `watch` channel       |
| core    | `core/src/ports.rs`                                     | `ConfigGateway` (`fetch(token, held_version) → Fetched`), `ConfigStore` (`load`, `save` of the last good body)      |
| adapter | `adapters/src/http/gateway.rs`, `translate.rs`          | the conditional GET on the agent's API base only; the generated type; no other host                                 |
| app     | `src/adapters/config_store.rs` (new)                    | the last good body in the app config directory, written atomically, read back through `from_wire` at start          |
| core    | `core/src/capturer.rs`, `watch_screen.rs`               | read `Effective.cadence` at each look (non-reading modules; call-count tests at every extreme)                      |
| reading | `domain/src/layout.rs`, `hud_track.rs`, `language.rs` … | read `Effective` for regions, thresholds and phrases — **rule 14**: pinning tests first, real-print proof           |
| ui      | `apps/agent/src/…`                                      | the window shows the configuration version in the diagnostics (RCF-08), en and pt-BR                                |

The loop holds an `Arc<watch::Sender<Effective>>`; readers take a snapshot per look. A new `Effective` is a value, not a
callback: nothing is executed on arrival. `Effective` has no `String` that is ever interpreted: phrases are compared as
literals by the domain's existing rules.

## Data and state

- The server keeps no state per agent. The agent persists one file (the last good body, at most 64 KiB) and re-validates it
  at every start; a file that fails is deleted and the defaults apply.
- Fetch cadence: at start, after pairing, every six hours (`CHECK_EVERY`) with a jitter taken from the agent's id modulo a
  minute (no clock or randomness in the domain), and on `5xx` or a network error the backoff of the other loops (1 s to 60 s).

## Proof strategy

- **Contract and API first** (batch 1): contract tests for every range and the closed schema; API unit tests for the file
  and the ETag; integration tests for the guards; the whole API integration suite, because `openapi.int.test.ts` pins every
  route (lessons).
- **Pinning tests before any constant is replaced** (batch 3, rule 14): each default equals today's value.
- **Range tests** at, below and above every limit, and **call counts** (captures and reads per 600 looks) at every extreme
  of the cadence ranges (RCF-09).
- **Version fallback tests**: older, equal, invalid, none, persisted, a corrupted persisted file.
- **Acceptance**: the headless agent against the real API with the staging test control; the agent prints a `config` line.
- **Real prints**: `ocr-real` and `ocr-variations` in CI on the PRs that thread a value into a reading module.

## Telemetry (rule 10, RCF-11)

`agent.config.fetch` with `config.outcome` (`applied`, `unchanged`, `invalid`, `stale`, `unreachable`) and `config.version`
(a number). The sanitiser keeps those two keys with those values only. No body, no field name and no value of the
configuration is ever a span attribute or a log line.

## ADRs

ADR 010 (the agent accepts data, never commands), ADR 009 (contracts first), ADR 027 (hexagonal agent), ADR 032 (factors III,
V, XII). No new ADR is proposed; a signed configuration, a pattern field or a per-account configuration would each need one.
