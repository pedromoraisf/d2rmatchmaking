# Agent Skeleton Specification

**Approved**: 2026-10-30 - user: "aprovo specs e tasks da F0 que passarem nos gates automáticos; delego sub-agents, harness-edits e local-merge-phase-branch" (delegated via .specs/phases/F0/brief.md)

## Problem Statement

Players must install a desktop agent before they can queue, and nothing of it exists yet: `apps/agent` is an empty
TypeScript workspace with no Tauri app, no Rust core, no release pipeline. The walking skeleton needs the thinnest
agent that a player can download, pair with a code, keep online with heartbeats, keep up to date by itself, and that
proves the read-only vision path — game name read from a reference image — without ever touching the game. The server
side of pairing, heartbeat and observations is `api-web-skeleton`, which owns the wire contracts (AD-035).

## Goals

- [ ] The agent pairs with a 6-digit code and stays online through heartbeats against the API contract (FR-03, FR-05).
- [ ] `v0.0.1` is built and released by the pipeline, and an installed `v0.0.1` updates itself to `v0.0.2` (FR-29,
      ADR 015).
- [ ] The vision pipeline turns a reference image of the automap into a `GAME_NAME_SEEN` observation for the expected
      name, and into nothing for any other name (FR-27, fixture only).
- [ ] The agent's dependencies and code paths stay inside ADR 010's read-only boundary (NFR-04, NFR-06).

## Out of Scope

| Feature                                                            | Reason                                                                                                                |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Live window capture, capture cascade, fullscreen handling          | FR-27's primary phase is F2 (ROADMAP), with NFR-02/NFR-03; F0 reads a reference image only (brief: "FR-27 (fixture)") |
| Chat reading (join/leave messages), character registration (FR-02) | F1/F2                                                                                                                 |
| Hotkeys (accept, fill game name, report)                           | FR-12 / FR-28, F1–F2                                                                                                  |
| Supervisor and scheduler state machines, remote configuration      | F2 (Design Doc § Agente desktop); F0 has one fixed heartbeat interval and built-in read regions                       |
| Local SQLite outbox for observations                               | F2 with live capture; F0 retries in memory (AD-051)                                                                   |
| Capture consent screen                                             | NFR-05 is F4; F0 captures nothing, so there is nothing to consent to                                                  |
| Tray icon, start with Windows                                      | Not needed by any F0 exit criterion                                                                                   |
| Exporting spans (OTLP) and the end-to-end trace                    | `observability-e2e` (NFR-09); this feature only propagates `traceparent`                                              |
| End-to-end run of the real agent against the real API              | `observability-e2e`, which depends on both skeletons; here the API is a contract-faithful fake server                 |
| Creating the updater key pair, GitHub secrets, tags, releases      | Escalations (AGENTS.md rules 6–7): the maintainer creates them; this feature writes the config and workflows          |
| macOS and Linux builds                                             | PRD: Windows-only agent                                                                                               |

---

## Assumptions & Open Questions

| Assumption / decision                     | Chosen default                                                                                                                                                                                                           | Rationale                                                                                                                                                                 | Confirmed? |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| What the reference image is               | A synthetic image committed under `apps/agent/fixtures/`, drawn by a repository script with an openly licensed font: dark automap background, the game name and "Difficulty: Hell" in the automap's top-right text block | No screenshot with consent exists yet, and the repository never publishes Blizzard assets (AGENTS.md "Never do"); real crops come with F2. AD-047 (assumed)               | y (AD-047) |
| Where the token is stored                 | The OS credential store (Windows Credential Manager), never a file                                                                                                                                                       | NFR-06 asks for a revocable, restricted token; the credential store keeps it out of files and backups. AD-048 (assumed)                                                   | y (AD-048) |
| How often the agent looks for updates     | At start, every 6 hours while running, and immediately after a `426`                                                                                                                                                     | FR-29 says "automatically"; ADR 015 says at start and periodically, without a period. AD-049 (assumed)                                                                    | y (AD-049) |
| How often the agent claims while pairing  | Every 2 seconds while a code is shown                                                                                                                                                                                    | AD-030 sets polling without a period; 2 s keeps "Paired" within a few seconds of the player typing the code. AD-050 (assumed)                                             | y (AD-050) |
| Observations without a local outbox       | Retried in memory with the same idempotency key, up to 5 attempts with exponential backoff (1, 2, 4, 8 s), then dropped and counted                                                                                      | Nothing captures live in F0; the SQLite outbox comes with F2's capture. AD-051 (assumed)                                                                                  | y (AD-051) |
| When a read counts as the expected name   | Exact equality after normalisation (trim surrounding whitespace, lower-case); the observation carries the normalised read text as its value                                                                              | Game names differ only by their number (`mmbaalh-12` vs `mmbaalh-13`, distance 1), so any tolerance can mark the wrong room Created; fuzzy fusion is F2. AD-052 (assumed) | y (AD-052) |
| When the shipped agent reads              | Never in F0 release builds: the read runs only in builds with the Cargo feature `fixture-read`, started with `--read-fixture <png>`; the release workflow never enables the feature                                      | A release build posting from a fixture would mark real rooms Created with no game open; observability-e2e builds with the feature to drive the trace. AD-057 (assumed)    | y (AD-057) |
| How often an unattended agent asks codes  | After 2 consecutive codes expire unused the agent stops asking and shows "Get a new code"; a `429` on the code request waits `Retry-After` (60 minutes when absent)                                                      | The API allows 10 code requests per IP per hour (AD-041); a new code every 5 minutes would exceed it on its own. AD-058 (assumed)                                         | y (AD-058) |
| Stream reconnect delay                    | 1 s after a drop, doubling to at most 60 s, reset after a stream stays open 60 s                                                                                                                                         | Bounded retry that keeps a down API from being hammered; ADR 007 sets no client delay. AD-059 (assumed)                                                                   | y (AD-059) |
| Windows code signing in F0                | The release workflow runs a SignPath signing step only when the SignPath secrets exist; until then installers are unsigned and the site explains the SmartScreen warning                                                 | ADR 016: "Until accepted, releases are unsigned and the site explains the warning." AD-053 (assumed)                                                                      | y (AD-053) |
| Agent window language                     | pt-BR when the Windows display language starts with `pt`, English otherwise                                                                                                                                              | Same rule as the site (AD-040); NFR-12 and AGENTS.md rule 9. AD-054 (assumed)                                                                                             | y (AD-054) |
| How the agent knows the game is open      | A process named `D2R.exe` is in the toolhelp snapshot (`CreateToolhelp32Snapshot`, `Process32FirstW`/`Process32NextW`), which lists names without opening process handles; `sysinfo` is banned                           | ADR 010 allows OS signals only; Design Doc § never: "abrir o processo do jogo". AD-055 (assumed)                                                                          | y (AD-055) |
| Heartbeat interval, offline rule, screens | Every 15 s (AD-031); screen always `UNKNOWN` in F0 (AD-038)                                                                                                                                                              | Shared with api-web-skeleton                                                                                                                                              | y          |
| Minimum version                           | Every request sends `X-Agent-Version` (AD-043); a `426` starts an update check                                                                                                                                           | Shared with api-web-skeleton; ADR 011                                                                                                                                     | y          |
| When this feature executes                | Specify, Design and Tasks now; Execute after `api-web-skeleton` is merged into `phase/F0`                                                                                                                                | It consumes the JSON Schemas that feature writes. AD-035 (assumed)                                                                                                        | y (AD-035) |

**Open questions:** none - all resolved or logged above.

---

## User Stories

### P1: The agent builds and is checked in CI ⭐ MVP

**User Story**: As the maintainer, I want the Tauri app and its Rust core to build and pass `fmt`, `clippy` and
`nextest` on Windows CI so that every later agent feature lands on a checked base.

**Why P1**: F0 exit criterion "builds in CI"; `ci.yml` switches the `agent` job on when `Cargo.toml` exists.

**Acceptance Criteria**:

1. The agent SHALL be built from a Cargo workspace at `apps/agent/src-tauri` holding a core library crate with no Tauri dependency and the Tauri 2 app crate, and its window's React UI SHALL be built from the `@d2rmm/agent` workspace.
2. WHEN the `agent` job of `ci.yml` runs on `windows-latest` THEN `cargo fmt --all -- --check`, `cargo clippy --all-targets -- -D warnings` and `cargo nextest run` SHALL exit 0.
3. The Rust types of every agent wire message SHALL be generated by `typify` from `packages/contracts/json-schema/`, and a test SHALL fail when the generated code differs from the committed code.
4. The agent's version SHALL have one source, `apps/agent/package.json`, read by the Tauri configuration, so that release-please's bump changes the installed version and the `X-Agent-Version` header together.

**Independent Test**: the `agent` CI job is green; changing a JSON Schema without regenerating fails a test.

---

### P1: Pair with a code ⭐ MVP

**User Story**: As a player, I want the agent to show a 6-digit code that I type on the site so that the agent works
for my account without my Battle.net password.

**Why P1**: FR-03, ADR 011.

**Acceptance Criteria**:

1. WHEN the agent starts with no stored token THEN it SHALL request a pairing code and show the 6 digits under "Pairing code", the hint "Type this code on the site" and "Expires in <N> min", where N is the minutes left rounded up (5 for a fresh code, 1 in the last minute).
2. WHILE a code is shown, the agent SHALL claim it every 2 seconds (AD-050); a claim answered 202 SHALL keep the code shown and the claiming going.
3. WHEN a claim returns the token THEN the agent SHALL store it in the Windows Credential Manager, stop claiming and show "Paired".
4. IF a claim answers 410, or the code's expiry passes, THEN the agent SHALL request a new code and show it, except as limited by AGS-34.
5. IF any agent request answers 401 THEN the agent SHALL delete the stored token and return to showing a new pairing code.
6. The token SHALL never be written to a file, a log line or a telemetry attribute.
7. IF 2 consecutive codes expire unused (by expiry or a 410 claim) THEN the agent SHALL stop requesting codes and show "Pairing paused" with the action "Get a new code", and WHEN the player uses that action THEN it SHALL request one new code and reset the count; a successful pairing and a return to pairing after a 401 also reset the count (AD-058).
8. IF the pairing-code request answers 429 THEN the agent SHALL show "Too many codes requested. Try again later." and request no code before the response's `Retry-After` has passed, or 60 minutes when it has none, and SHALL not offer "Get a new code" during that wait (AD-058).

**Independent Test**: against a fake API server, start with no token, see the code, mark it used on the fake, see
"Paired" and the token in the credential store; answer 401 next and see a new code; let two codes expire and see
"Pairing paused"; answer 429 with `Retry-After: 120` and see no request for 120 s (fake clock).

---

### P1: Stay online with heartbeats ⭐ MVP

**User Story**: As a player, I want the agent to report that it is online and whether the game is open so that the
site shows my presence.

**Why P1**: FR-05.

**Acceptance Criteria**:

1. WHILE paired, the agent SHALL send a heartbeat every 15 seconds (AD-031) whose body follows the heartbeat contract, with its version, `game.running` and `game.screen: "UNKNOWN"`.
2. The agent SHALL set `game.running` to true exactly when a process named `D2R.exe` appears in the toolhelp process snapshot (`CreateToolhelp32Snapshot`), and it SHALL enumerate processes through no other API: `OpenProcess` is forbidden by clippy (AGS-22) and the `sysinfo` crate by `cargo deny` (AGS-21) (AD-055).
3. IF a heartbeat fails with a network error or a 5xx THEN the agent SHALL keep running, show "Can't reach the server" and send the next heartbeat on schedule; WHEN a heartbeat succeeds again THEN it SHALL show "Connected".
4. Every agent request SHALL carry `X-Agent-Version` with the agent's version and a W3C `traceparent` header for a span opened for that request, and each loop SHALL open one span per iteration named `agent.heartbeat`, `agent.pairing.claim`, `agent.update.check`, `agent.stream.connect`, `agent.vision.read` or `agent.observation.post`, with no token, code or image in its attributes.

**Independent Test**: against the fake server, a paired agent sends heartbeats 15 s apart (fake clock) with
`running: false`; with a process named `D2R.exe` in the test's process source, the next heartbeat says `true`.

---

### P1: Know which room to look for ⭐ MVP

**User Story**: As a player, I want the agent to know the room and game name it must look for so that it can confirm
my game when I enter it.

**Why P1**: The walking skeleton's room path (Design Doc § Walking skeleton).

**Acceptance Criteria**:

1. WHEN the agent becomes paired, starts paired, or its stream reconnects THEN it SHALL fetch its assignment and open the stream with its token; IF the stream drops THEN it SHALL reconnect with `Last-Event-ID` after 1 s, doubling the delay after each failed attempt up to 60 s, and reset the delay once a stream has stayed open 60 s (AD-059).
2. WHEN the stream delivers `room.assigned` THEN the agent SHALL keep that assignment as its current one and show "Room <game name> — waiting for the game".
3. IF the stream delivers an event type the contract does not define, or an event that fails the contract THEN the agent SHALL ignore it and keep its current state.
4. The agent SHALL treat every stream event as data: its handler SHALL return only a state update (set or clear the current assignment), so no event starts a process, sends input to any window, writes a file or changes what the agent reads.

**Independent Test**: the fake server streams `room.assigned` then an unknown event; the agent shows the room and
nothing else changes.

---

### P1: Read the game name from a reference image ⭐ MVP

**User Story**: As a player, I want the agent to recognise my room's game name on the automap so that the room becomes
Created without me typing anything.

**Why P1**: FR-27 (fixture), the walking skeleton's reading step.

**Acceptance Criteria**:

1. WHEN the vision pipeline reads the reference image apps/agent/fixtures/automap-game-name.png (AD-047) with the built-in read region for its resolution THEN it SHALL return the text `mmbaalh-12`.
2. WHEN the read text, after trimming surrounding whitespace and lower-casing, equals the assignment's expected game name lower-cased THEN fusion SHALL produce one `GAME_NAME_SEEN` observation with that normalised text as value, the assignment's room and run, a confidence between 0 and 1, a new idempotency key and the capture time (AD-052).
3. IF the normalised read text differs from the expected game name in any character — `mmbaalh-13` for an expected `mmbaalh-12` included — or there is no assignment THEN fusion SHALL produce no observation.
4. WHEN an observation is produced THEN the agent SHALL post it to the room's observation endpoint and, IF the post fails with a network error or a 5xx, retry it with the same idempotency key up to 5 attempts in total with 1, 2, 4 and 8 s between attempts (AD-051).
5. The text reader SHALL run on the local machine; no image or crop SHALL leave the process.
6. The agent SHALL read the reference image only in a build with the Cargo feature `fixture-read`, started with `--read-fixture <png>`, and then read it once, when it holds an assignment (at start, or when the first assignment arrives after start); `release-agent.yml` SHALL never enable that feature, so a released agent never reads an image nor posts an observation in F0 (AD-057).

**Independent Test**: `cargo nextest run` on Windows reads the fixture and gets `mmbaalh-12`; fusion with expected
`mmbaalh-12` or `MMBAALH-12` yields one observation, with `mmbaalh-13` or `mmbaalh-1` yields none; a release-profile
build without the feature rejects `--read-fixture`.

---

### P1: Stay inside the read-only boundary ⭐ MVP

**User Story**: As a player who worries about bans, I want the agent to be provably unable to touch the game so that
installing it is defensible.

**Why P1**: ADR 010, NFR-04, NFR-06, SECURITY.md.

**Acceptance Criteria**:

1. The agent's dependency tree SHALL contain no crate for memory access, code injection, input synthesis, DirectX hooking, packet capture or process inspection (`sysinfo` included), and a CI check (`cargo deny` bans) SHALL fail when one is added.
2. The agent's Rust code SHALL not call `std::process::Command`, `OpenProcess`, `ReadProcessMemory`, `WriteProcessMemory` or `SendInput`, and `clippy` SHALL fail on any of them (`disallowed-methods` / `disallowed-types`); the Tauri updater plugin is the only component that starts a process (the installer).
3. Every request body the agent sends SHALL be one of the contract's types (pairing code request, claim, heartbeat, observation), and none of them holds image data.

**Independent Test**: adding `winapi` with `memoryapi` or a call to `SendInput` makes `cargo deny` or `clippy` fail.

---

### P1: Update itself from the latest release ⭐ MVP

**User Story**: As a player, I want the agent to update itself so that I always run a version the platform accepts.

**Why P1**: FR-29, ADR 015; F0 exit criterion "installed `v0.0.1` updates itself to `v0.0.2`".

**Acceptance Criteria**:

1. WHEN the agent starts, every 6 hours while it runs, and right after an API answer of 426 THEN it SHALL check `https://github.com/pedromoraisf/d2rmatchmaking/releases/latest/download/latest.json` (AD-049).
2. WHEN `latest.json` names a version above the installed one and its signature verifies with the public key embedded in the agent THEN the agent SHALL download and install it and restart into the new version.
3. IF the signature does not verify, the download fails or `latest.json` cannot be read THEN the agent SHALL keep the installed version, show "Update failed — will retry" and check again at the next scheduled time.
4. WHEN an API request answers 426 THEN the agent SHALL show "Update required" until an update installs, and WHILE it shows it the agent SHALL send no API request (heartbeat, claim, stream, observation) other than the update check.

**Independent Test**: the maintainer installs `v0.0.1` on Windows and sees it restart as `v0.0.2` after that release
exists (phase review checklist, brief Q4); the configuration test checks the endpoint and the embedded key.

---

### P1: Release pipeline ⭐ MVP

**User Story**: As the maintainer, I want merging the release PR to publish a signed-for-update installer under a
fixed name so that the site's download link never needs a redeploy.

**Why P1**: ADR 015, ADR 016; F0 exit criteria on releases and the download button.

**Acceptance Criteria**:

1. WHEN commits reach `main` THEN `release-please.yml` SHALL keep one release PR for `apps/agent` (config from AD-028), and WHEN it merges THEN release-please SHALL create the tag `agent-v<version>`.
2. WHEN a tag `agent-v*` is pushed THEN `release-agent.yml` SHALL build the agent on `windows-latest` with tauri-action, sign the updater artifacts with `TAURI_SIGNING_PRIVATE_KEY` (and its password), and publish a GitHub Release with `latest.json`, the installer and a copy of the installer named `D2RMatchMaking-setup.exe`.
3. WHERE the SignPath secrets exist, `release-agent.yml` SHALL submit the installer to SignPath and publish the signed one; otherwise it SHALL publish it unsigned (AD-053).
4. The site SHALL show next to "Download the agent" the static note "The installer is not code-signed yet, so Windows SmartScreen may warn you before it runs." (pt-BR: "O instalador ainda não tem assinatura de código, por isso o Windows SmartScreen pode avisar antes de executá-lo."); the note is removed by a code change when ADR 016's signing is accepted, not by a flag. This feature adds the note and its keys to `apps/web` after api-web-skeleton is merged (AD-035), so it extends that feature's translation files rather than editing them in parallel.

**Independent Test**: a static test of both workflows checks triggers, secrets, the fixed asset name and the
conditional SignPath step; the first runs after the maintainer's merge are listed in the phase review.

---

### P2: The agent window speaks English and Portuguese

**User Story**: As a Brazilian player, I want the agent window in Portuguese when Windows is in Portuguese.

**Why P2**: NFR-12 (F1 primary) and AGENTS.md rule 9 for the strings this feature adds.

**Acceptance Criteria**:

1. The agent window SHALL take every user-facing string from `en` and `pt-BR` translation files holding the same keys, and ESLint SHALL fail on a literal user-facing string in a component.
2. WHEN the Windows display language starts with `pt` THEN the agent window SHALL render in pt-BR; otherwise it SHALL render in English (AD-054).

**Independent Test**: a UI unit test renders the pairing view with `pt-BR` and sees "Código de pareamento".

---

## Edge Cases

- IF the API is unreachable when the agent starts with no token THEN it SHALL show "Can't reach the server" and retry the code request every 15 seconds, the heartbeat interval of AD-031 (AGS-05; unreachable attempts never reach the API's rate limit).
- IF the credential store refuses the write THEN the agent SHALL show "Could not save the pairing. Try again." and request a new code (AGS-08).
- IF the stream drops THEN the agent SHALL reconnect with `Last-Event-ID` after the AD-059 delay and re-fetch its assignment (AGS-13).
- IF two `room.assigned` events arrive THEN the latest one SHALL be the current assignment (AGS-14).
- WHEN the clock reaches the code's expiry during a claim THEN the agent SHALL request a new code (AGS-07).

---

## Implicit-requirement dimensions

| Dimension                                | Resolution                                                                                               |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Input validation & bounds                | AGS-15 (unknown or invalid stream events ignored), AGS-03 (typify types are the only wire shapes)        |
| Failure / partial-failure states         | AGS-07 (expired code), AGS-11 (heartbeat failure), AGS-19 (observation retries), AGS-26 (update failure) |
| Idempotency / retry / duplicate handling | AGS-19 (same idempotency key on retry), AGS-14 (latest assignment wins)                                  |
| Auth boundaries & rate limits            | AGS-08 (401 → re-pair), AGS-09 (token never written out), AGS-12 (version header), AGS-27 (426)          |
| Concurrency / ordering                   | AGS-14 (latest assignment), AGS-06 (claim loop stops once paired)                                        |
| Data lifecycle / expiry                  | AGS-07 (codes expire), AGS-08 (token deleted on 401)                                                     |
| Observability                            | AGS-12 (`traceparent` per request); export is observability-e2e                                          |
| External-dependency failure              | AGS-11 (API down), AGS-26 (GitHub Releases or signature failure), AGS-29 (SignPath absent)               |
| State-transition integrity               | AGS-05…AGS-08 (unpaired → showing code → paired → unpaired on 401)                                       |

---

## Requirement Traceability

| Requirement ID | Story                                                     | Phase  | Status  |
| -------------- | --------------------------------------------------------- | ------ | ------- |
| AGS-01         | P1: The agent builds and is checked in CI (AC 1)          | Design | Pending |
| AGS-02         | P1: The agent builds and is checked in CI (AC 2)          | Design | Pending |
| AGS-03         | P1: The agent builds and is checked in CI (AC 3)          | Design | Pending |
| AGS-04         | P1: The agent builds and is checked in CI (AC 4)          | Design | Pending |
| AGS-05         | P1: Pair with a code (AC 1)                               | Design | Pending |
| AGS-06         | P1: Pair with a code (AC 2-3)                             | Design | Pending |
| AGS-07         | P1: Pair with a code (AC 4)                               | Design | Pending |
| AGS-08         | P1: Pair with a code (AC 5)                               | Design | Pending |
| AGS-09         | P1: Pair with a code (AC 6)                               | Design | Pending |
| AGS-10         | P1: Stay online with heartbeats (AC 1-2)                  | Design | Pending |
| AGS-11         | P1: Stay online with heartbeats (AC 3)                    | Design | Pending |
| AGS-12         | P1: Stay online with heartbeats (AC 4)                    | Design | Pending |
| AGS-13         | P1: Know which room to look for (AC 1)                    | Design | Pending |
| AGS-14         | P1: Know which room to look for (AC 2)                    | Design | Pending |
| AGS-15         | P1: Know which room to look for (AC 3-4)                  | Design | Pending |
| AGS-16         | P1: Read the game name from a reference image (AC 1)      | Design | Pending |
| AGS-17         | P1: Read the game name from a reference image (AC 2)      | Design | Pending |
| AGS-18         | P1: Read the game name from a reference image (AC 3)      | Design | Pending |
| AGS-19         | P1: Read the game name from a reference image (AC 4)      | Design | Pending |
| AGS-20         | P1: Read the game name from a reference image (AC 5)      | Design | Pending |
| AGS-21         | P1: Stay inside the read-only boundary (AC 1)             | Design | Pending |
| AGS-22         | P1: Stay inside the read-only boundary (AC 2)             | Design | Pending |
| AGS-23         | P1: Stay inside the read-only boundary (AC 3)             | Design | Pending |
| AGS-24         | P1: Update itself from the latest release (AC 1)          | Design | Pending |
| AGS-25         | P1: Update itself from the latest release (AC 2)          | Design | Pending |
| AGS-26         | P1: Update itself from the latest release (AC 3)          | Design | Pending |
| AGS-27         | P1: Update itself from the latest release (AC 4)          | Design | Pending |
| AGS-28         | P1: Release pipeline (AC 1-2)                             | Design | Pending |
| AGS-29         | P1: Release pipeline (AC 3)                               | Design | Pending |
| AGS-30         | P1: Release pipeline (AC 4)                               | Design | Pending |
| AGS-31         | P2: The agent window speaks English and Portuguese (AC 1) | Design | Pending |
| AGS-32         | P2: The agent window speaks English and Portuguese (AC 2) | Design | Pending |
| AGS-33         | P1: Read the game name from a reference image (AC 6)      | Design | Pending |
| AGS-34         | P1: Pair with a code (AC 7)                               | Design | Pending |
| AGS-35         | P1: Pair with a code (AC 8)                               | Design | Pending |

**Coverage:** 35 total, 0 mapped to tasks, 35 unmapped ⚠️ (mapped at Tasks)

---

## Sources

- `docs/product/prd.md#FR-03` - pairing by a 6-digit code shown in the agent → AGS-05…AGS-09
- `docs/product/prd.md#FR-05` - presence: online, game open, current screen → AGS-10, AGS-11
- `docs/product/prd.md#FR-27` - read the game name on the automap (fixture in F0, brief) → AGS-16…AGS-20 (AD-047, AD-052)
- `docs/product/prd.md#FR-29` - self-update from the latest release → AGS-24…AGS-27 (AD-049)
- `docs/product/prd.md#NFR-04` - capture only the game window, process locally, send structured observations → AGS-20, AGS-23
- `docs/product/prd.md#NFR-06` - token revocable and restricted; the agent accepts data, never commands → AGS-08, AGS-09, AGS-15, AGS-22
- `docs/product/prd.md#NFR-12` and AGENTS.md rule 9 - English and pt-BR from day 0 → AGS-31, AGS-32 (AD-054)
- ADR 009 (shared contracts) - JSON Schema → `typify` → AGS-03 (AD-035)
- ADR 010 (read-only agent) and SECURITY.md - what the agent never does → AGS-02, AGS-21, AGS-22, AGS-23 (AD-055)
- ADR 011 (agent auth) - code, revocable token, `426` → AGS-05…AGS-09, AGS-12, AGS-27 (AD-043, AD-048, AD-050)
- ADR 013 (observability) and AGENTS.md rule 10 - spans and `traceparent` on agent requests → AGS-12
- ADR 015 (agent release) - release-please, tauri-action, `latest.json`, fixed installer name → AGS-04, AGS-24, AGS-28 (AD-028)
- ADR 016 (Windows signing) - SignPath when accepted; unsigned until then and the site explains the warning → AGS-29, AGS-30 (AD-053)
- `docs/architecture/design-doc.md` § Agente desktop, § Contratos (heartbeat, observation), § CI/CD (distribution) → all
- `.specs/phases/F0/brief.md` - features table, exit criteria (release, self-update, pairing and heartbeat), Q4 (maintainer's Windows check) → all
- AD-041 (API code-request limit) → AGS-34, AGS-35 (AD-058)
- AD-030, AD-031, AD-035, AD-038, AD-043 (shared with api-web-skeleton) and AD-047…AD-059 (assumed) - `.specs/STATE.md`

---

## Success Criteria

- [ ] The `agent` CI job is green on `windows-latest` with fmt, clippy (`-D warnings`), nextest and `cargo deny`.
- [ ] The maintainer's Windows check: `v0.0.1` installs from `D2RMatchMaking-setup.exe`, pairs, and updates itself to `v0.0.2`.
- [ ] `cargo-mutants` on the fusion and pairing modules kills every mutant the tasks name.
