# Remote configuration — Specification

**Phase**: F2 (covered by the brief's approval, ADR 029) · **Size**: Large (design in `design.md`) · **Security review**:
yes (the server now sends the agent values that steer what it reads and how often: ADR 010, AGENTS.md rule 5, AGT-04)

## Problem

Everything that tunes the agent's reading is a constant compiled into the agent: the reading regions, the confidence and
search thresholds, the look and probe cadences, the words the reading looks for. A patch of the game that moves a panel,
or a field result that says "probe every 30 looks, not 60", costs a new agent release: a signed installer, an update on
every PC. The Design Doc says the opposite: "a game patch that changes the interface becomes a configuration update, not a
new agent version" (§ Agente, remote configuration), and the F2 brief asks for it: regions, chat texts per language,
thresholds and frequencies come from a versioned JSON served by the API.

Three F2 features already named constants that "become remote configuration" here: the capture cascade
(`DEMOTE_AFTER`, `PROBE_EVERY`, `RATE_WINDOW`), screen-recognition (the search cadence of the automap and the list
marker, `TRACK_PAD`, the HUD band) and game-name-reading (the chat phrases per language).

The risk is the reason for the care: a value the server sends steers a program on the player's PC. The agent SHALL treat
the configuration as **bounded data**: every number clamped into a range fixed in the agent, every string a literal from a
closed set of fields, nothing that names an action. A hostile or broken configuration can make the agent read worse; it
SHALL NOT make it read more, faster, elsewhere or differently than the player consented to (ADR 010, NFR-02, NFR-04).

## Threats

| Threat                                                                                                           | Closed by              |
| ---------------------------------------------------------------------------------------------------------------- | ---------------------- |
| The configuration drives the PC (a command, a script, a path, a URL, a key to press)                             | RCF-02, RCF-05, RCF-10 |
| A value speeds the agent up (CPU, FPS) or widens what it captures (a region outside the client, a look at 10 Hz) | RCF-05, RCF-09         |
| A pattern from the server makes the agent hang (ReDoS) or read a text it should not                              | RCF-03, RCF-05         |
| A bad or truncated body replaces a good configuration                                                            | RCF-06                 |
| An old configuration replays and undoes a fix                                                                    | RCF-06                 |
| Another host answers (the agent is pointed elsewhere)                                                            | RCF-04, RCF-10         |
| Any account or an unpaired caller reads or changes the configuration                                             | RCF-01                 |
| The configuration reveals a player, or the fetch reveals one beyond the agent's own heartbeat                    | RCF-01, RCF-10         |
| The agent's behaviour changes silently and nobody can tell which configuration a PC runs                         | RCF-08, RCF-11         |

## Requirements

A **configuration** is one JSON document with a `version` (a whole number that only grows) and four closed sections:
`cadence`, `thresholds`, `regions` and `phrases`. A **range** is the interval the agent accepts for one field, kept in the
agent's domain and never read from the server.

- **RCF-01** — The API SHALL serve the current configuration on `GET /v1/agents/config` to an agent token and to no one
  else: a session cookie alone, an unknown or revoked token and no credential SHALL answer `401`. The body SHALL be the
  same for every agent (no account data), SHALL carry an `ETag` of its version and its content (a digest of the served
  bytes, so an edit with no version bump is not answered `304`), and a request whose `If-None-Match` names that tag SHALL
  answer `304` with no body. The route SHALL be on the agent route list of AGT-01.
- **RCF-02** — The configuration SHALL be a contract type (`AgentConfig`, Zod, generated JSON Schema and OpenAPI) with
  **closed** objects: a field outside the schema SHALL be refused by the API's own validation of the file it serves, and
  SHALL be ignored by the agent. No field SHALL be a free-form object, a regular expression, a path, a URL or a script.
  The body SHALL be at most 64 KiB.
- **RCF-03** — The configuration SHALL carry only these four kinds of data, each field with its own range in the contract
  and in the agent: `cadence` (the capture cascade's demotion, probe and rate windows; the screen search cadences; the
  look interval), `thresholds` (the reading's numeric limits that are named constants today), `regions` (named reading
  areas as fractions of the client, with a minimum size) and `phrases` (literal words and chat phrases per language, each
  a short string of letters, digits, spaces and the accents of the supported languages; never a pattern).
- **RCF-04** — The agent SHALL fetch the configuration only from its own API base (the build-time constant, ADR 010) with
  its agent token: once the agent is paired and at start, then every six hours and after a `426`'s update, with a
  conditional request, a bounded timeout and the backoff the other loops use. The request SHALL carry no frame, no read
  text and nothing beyond the token, the agent version and the version it holds.
- **RCF-05** — The agent SHALL turn the body into its effective configuration by **clamping every number into its
  range**, ignoring every unknown field, taking a phrase only when it passes its character and length rule, and taking a
  region only when it lies inside the client and has the minimum size. A section that cannot be read SHALL fall back to its
  built-in default, field by field, and the rest of the configuration SHALL still apply. No field of the configuration
  SHALL name an action.
- **RCF-06** — WHEN a body is invalid (not JSON, over the size limit, a version that is not a whole number) or its version
  is not greater than the one the agent holds, THEN the agent SHALL keep what it holds. The agent SHALL keep the last
  good configuration on its PC and load it at the next start after validating it again; with none, it SHALL run on the
  built-in defaults.
- **RCF-07** — The built-in defaults SHALL equal the constants the agent has today, and an agent that never receives a
  configuration SHALL read exactly as it does now. Tests SHALL pin each default before any constant is replaced.
- **RCF-08** — A configuration that is applied SHALL take effect at the next look of each loop with no restart, and the
  window and the heartbeat SHALL be able to say which version the agent runs (a whole number; `0` for the built-in
  defaults).
- **RCF-09** — WHATEVER the configuration says, the agent SHALL look at the game at most once per second (CHR-03), SHALL
  make at most one capture per look in steady state (CAP-03), and SHALL NOT read more areas per look than the built-in
  defaults do. Every range SHALL be chosen so that its extreme value keeps the call counts of the capture cascade and the
  screen reader within the NFR-02 tests, and tests SHALL run those counts at each extreme.
- **RCF-10** — The configuration SHALL be data only (AGT-04): the agent's parser SHALL map a closed set of fields to typed
  values and SHALL NOT interpret a string as a command, a path or a pattern. A source-rule test SHALL list the fields of
  the configuration and fail on a new one until it is reviewed. No configuration request, answer, log line or span SHALL
  carry a frame, a read text or the token.
- **RCF-11** — Each fetch SHALL be one span `agent.config.fetch` with fixed words only: `config.outcome` (`applied`,
  `unchanged`, `invalid`, `stale`, `unreachable`) and `config.version` (a whole number); the sanitiser SHALL keep those two
  keys with those values only (rule 10).
- **RCF-12** — The API SHALL read the configuration from one JSON file in the repository, validated against `AgentConfig`
  at start (a file that fails stops the start) and in CI; a change to it SHALL be a reviewed commit and a release, never an
  edit on a server (ADR 032 factors III and V). The file SHALL be documented, with the range of every field and how to
  raise the version.

## Sources

| ID     | Source                                                                                                                                                                                   |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RCF-01 | FR-27 (brief: remote configuration); NFR-06; AGT-01 (agent route list); Design Doc § Contratos                                                                                           |
| RCF-02 | Design Doc § Agente (versioned JSON); ADR 009 (contracts first); AGENTS.md rule 2                                                                                                        |
| RCF-03 | Design Doc § Agente (regions per resolution, texts per language, thresholds, frequencies); FR-27; capture-cascade and screen-recognition decisions (constants that become configuration) |
| RCF-04 | ADR 010 (the agent talks to its own API only); ADR 032 (the agent's API base is a build-time constant); CHR-03                                                                           |
| RCF-05 | ADR 010 (accepts data, never commands); AGENTS.md rule 5; NFR-04; AGT-04                                                                                                                 |
| RCF-06 | F2 brief ("a unit test on the version fallback"); ADR 032 factor V                                                                                                                       |
| RCF-07 | AGENTS.md rule 14 (OCR protection: pin first); lessons ("Agent reading")                                                                                                                 |
| RCF-08 | NFR-03 (no game configuration needed); Design Doc § Agente (a patch is a configuration update)                                                                                           |
| RCF-09 | NFR-02 (CPU below 2%); CHR-03; CAP-03; screen-recognition NFR-02 call counts                                                                                                             |
| RCF-10 | AGT-04; ADR 010; AGENTS.md rule 5                                                                                                                                                        |
| RCF-11 | AGENTS.md rule 10; `docs/engineering/telemetry.md`; SCR-09 and CAP-08 (fixed vocabulary)                                                                                                 |
| RCF-12 | ADR 032 (factors III, V, XII); ADR 009; AGENTS.md rule 13                                                                                                                                |

## Requirement Traceability

| Requirement ID | Story                    | Proof                                                                                     |
| -------------- | ------------------------ | ----------------------------------------------------------------------------------------- |
| RCF-01         | Only agents read it      | API integration tests (guards, `304`) + acceptance `@RCF-01` + the AGT-01 route-list test |
| RCF-02         | A closed schema          | contract tests (unknown field, size) + `contracts:check` + Rust unit tests on the parser  |
| RCF-03         | Four kinds of data       | contract tests per range + Rust unit tests per range                                      |
| RCF-04         | Fetch from its own API   | Rust unit tests (loop, backoff, conditional request) + source-rule test (one base URL)    |
| RCF-05         | Bounded data             | Rust unit tests at, below and above every range + acceptance `@RCF-05`                    |
| RCF-06         | Version fallback         | Rust unit tests (older, equal, invalid, none, persisted) + acceptance `@RCF-06`           |
| RCF-07         | Defaults equal today     | pinning tests per constant, first (rule 14) + `ocr-real` and `ocr-variations` in CI       |
| RCF-08         | Applied without restart  | Rust unit tests + acceptance `@RCF-08` (the agent prints the version it runs)             |
| RCF-09         | Cannot be made expensive | call-count unit tests at every range extreme (captures and reads per 600 looks)           |
| RCF-10         | Data only                | source-rule test (field list) + the existing AGT-04 test extended                         |
| RCF-11         | Telemetry                | Rust unit tests with the in-memory exporter + sanitiser tests + source-rule test          |
| RCF-12         | A file, a release        | API unit test on the committed file + CI check + `docs/engineering/remote-config.md`      |

## Stories

- As the maintainer, I want a game patch that moves a panel to be a reviewed JSON change and a release of the API, so that
  no player has to update the agent (RCF-01, RCF-03, RCF-12).
- As a player, I want the agent to stay as cheap and as limited as I consented to, whatever the server says (RCF-05,
  RCF-09, RCF-10).
- As a player on a flaky connection, I want the agent to keep working on its last good configuration (RCF-04, RCF-06).
- As the maintainer, I want to know which configuration each agent runs and how a fetch ended (RCF-08, RCF-11).

## Decisions (conservative defaults)

- **A new route, `GET /v1/agents/config`**, not a field in the heartbeat answer (`204` today) or an event on the stream. The
  heartbeat and the stream stay as they are, the route is read-only and cacheable, and it is the 9th route an agent token
  reaches: **AGT-01's list and its test grow by one** (a decision to confirm; AGT-01 says widening the token's reach is a
  spec change). Alternative: carry the version in the heartbeat's answer and fetch on a change.
- **The configuration is a file in the repository** (`apps/api/src/modules/agents/config/agent-config.json`), loaded and
  validated at start, served as is. A change is a commit and an API release (ADR 032 V), not a database row or an admin
  call: no new writer, no new secret, nothing to protect beyond the repository's review. Alternatives: an environment
  variable (factor III, but a long JSON in an env) or a table with an admin script (more moving parts).
- **Literals, not patterns.** The Design Doc lists "expressions regulares"; a regular expression from the server is a hang
  risk (ReDoS) and a reading the maintainer cannot bound. Phrases are literals compared by the domain's existing
  rules. If a pattern is ever needed it comes with its own spec and a bounded matcher.
- **Four sections only; nothing about consent, capture, hotkeys, the API base, the token or the heartbeat interval.** The
  heartbeat interval stays a constant: the server's offline threshold (AD-031) depends on it.
- **Floors and ceilings are the agent's.** The contract carries the same ranges for the API's own validation, but the agent
  never trusts the server's range: it clamps with its own. The extreme of each range is chosen so the NFR-02 call counts
  hold (RCF-09).
- **No signature on the document in F2.** The agent talks to its own API over TLS and the document is bounded data. A signed
  configuration (so a compromised API cannot steer the agent) is a later hardening and is listed as an open question.
- **Regions and thresholds are reading logic** (AGENTS.md rule 14). The task that threads a value into a reading module
  carries pinning tests first and the real-print proof (`ocr-real` green, `ocr-variations` not regressing); the new
  `remote_config.rs` of the domain is proposed to join `scripts/agent/reading-modules.json` (the orchestrator's edit; the
  maintainer answers the gate). The built-in defaults mean a PC with no configuration reads exactly as today.
- **Orchestrator answers to the draft (batch 1 go-ahead, 2026-11-20).** (1) `GET /v1/agents/config` is the 9th agent
  route; AGT-01's list, its test and the route table grow by one (**to confirm by the maintainer**). (2) The document is a
  committed file plus an API release, not an environment variable or a database row. (3) Literal phrases only, no
  patterns (ReDoS). (4) No signature in F2; a signed configuration is a later hardening (**to confirm by the maintainer**).
  (5) The screen search-cadence fields join the schema in the PR that merges after `feat/F2-screen-recognition-2`, and the
  chat-phrase fields after `game-name-reading`; until then `phrases` holds the Party panel's words only. (6) Ranges:
  `probeEvery` 10–600, `demoteAfter` 1–10, `rateWindow` 10–600, `lookIntervalMs` 1000–10000 (the floor keeps CHR-03's at
  most one look per second); `trackPad` 8–48 pixels; a region's origin 0–1 and size 0.02–1, inside the client.
- **Where batch 1 put things.** Only adapters import contracts (architecture rule), so the validation of the file
  (`parseAgentConfig`, `loadAgentConfig`) is in `modules/agents/adapters/file/agent-config-file.ts`; the domain holds the
  version, ETag and `If-None-Match` rules. The staging test control is `PUT /__test/agent-config`, the prefix every other
  control uses (`render-no-test-controls` and `onAcceptanceDatabase` already guard it), not `/v1/test/…`. The served
  document carries all four sections, `regions` empty until a region is tuned, so RCF-02's scenario sees the four.
- **Order of work.** The API and contract side (batch 1) starts as soon as the phase branch allows. The agent side needs
  `capture-cascade` (merged or its constants known) and the reading side needs `game-name-reading` for the chat phrases and
  `feat/F2-screen-recognition-2` for the search cadences; until they merge, their fields are not in the schema.
