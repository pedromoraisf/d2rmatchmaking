# API and Web Skeleton Specification

## Problem Statement

The workspaces exist but nothing runs: there is no API process, no database schema, no site, no event stream. The
walking skeleton needs the thinnest slice that proves every server-side layer end to end — "a test room becomes
Created" — so that F1's real features add rules to a working pipe instead of building the pipe and the rules together.
The agent side of the slice is `agent-skeleton`; this feature is the server and the site, and it owns the wire
contracts both sides use.

## Goals

- [ ] A signed-in test player sees a test room go from "Awaiting host" to "Created" on the site within 2 seconds of the
      host's agent reporting the game name (NFR-01), through API → Postgres → outbox → SSE.
- [ ] A player pairs an agent with a 6-digit code and sees its presence live on the site (FR-03, FR-05).
- [ ] The same app starts from `main/local.ts` (Docker Postgres) and `main/render.ts` (Render + Neon), and only those
      files know the provider (NFR-08).
- [ ] The site is translated into English and pt-BR from the first string (NFR-12).

## Out of Scope

| Feature                                                                   | Reason                                                                                                               |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Real Battle.net OAuth (`/auth/bnet/*`), linking, sign-out                 | FR-01's primary phase is F1 (ROADMAP); F0 uses a test sign-in that exists only on staging (AD-029)                   |
| Revoking an agent from the site                                           | FR-04, F1                                                                                                            |
| Queue, ready check, real `MatchFormed` from matchmaking                   | F1; the staging-only "Start test match" is the single fake (brief, scope notes)                                      |
| Room stages after `created` (`active`, `closed`, `expired`), runs after 1 | FR-15–FR-18, F1                                                                                                      |
| Observation types other than `GAME_NAME_SEEN` changing state              | F1/F3; the other types are accepted by the contract and ignored                                                      |
| Telemetry SDK, OTLP export, the end-to-end trace and Grafana              | `observability-e2e` (NFR-09, ADR 013); this feature only opens the spans                                             |
| Load test and bytes per player-hour                                       | `load-baseline` (NFR-14)                                                                                             |
| Swagger UI at `/docs`                                                     | ADR 020 serves it outside production; nothing in F0's exit criteria reads it, F1 adds it with the first public route |
| Daily `pg_dump` backup                                                    | Already in `nightly.yml` (pre-foundation); its proof needs the maintainer's R2 and Neon secrets (phase review)       |
| Outbox and observation retention clean-up                                 | F0 volume is a handful of rows; the 30-day observation retention job comes with F1's observations                    |
| Deploying, pushing, creating secrets                                      | Escalations (AGENTS.md rule 7); this feature writes the workflows, the maintainer runs them after the phase review   |
| Keyboard navigation and AA contrast audit                                 | NFR-13, F1                                                                                                           |

---

## Assumptions & Open Questions

| Assumption / decision                                          | Chosen default                                                                                                                                                                                | Rationale                                                                                                                                                                 | Confirmed?                 |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| How a player signs in during F0                                | A test sign-in by player name, only when `ENABLE_STAGING_ENDPOINTS=true`; the account's BattleTag is `<name>#test`                                                                            | Brief Q2/Q3 and Design Doc § load test ("login falso que só existe fora de produção"); real OAuth is F1. AD-029 (assumed)                                                 | y (AD-029)                 |
| Session lifetime and cookie attributes                         | 7 days; `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`; the session id is random and stored in `identity.sessions`                                                                            | Shorter than a typical 30 days, reversible constant. AD-036 (assumed)                                                                                                     | y (AD-036)                 |
| Pairing limits (ADR 011 says "rate-limited", gives no numbers) | 10 code submissions per account per 5 minutes, then 429 (AD-032); 10 code requests per IP per hour (AD-041); the agent claims its token once by polling with a one-time claim secret (AD-030) | Strict on safety, one constant each                                                                                                                                       | y (AD-030, AD-032, AD-041) |
| How many agents an account has                                 | One paired agent per account; pairing a new one revokes the previous token                                                                                                                    | The site shows "the agent"; fewer live tokens is stricter (NFR-06). AD-037 (assumed)                                                                                      | y (AD-037)                 |
| When an agent counts as offline                                | The agent heartbeats every 15 s; the API marks it offline after 45 s without a heartbeat                                                                                                      | Three missed beats; 15 s keeps a heartbeat well under the egress budget. AD-031 (assumed)                                                                                 | y (AD-031)                 |
| Which screens presence reports in F0                           | `UNKNOWN` and `AUTOMAP_OPEN`; F2 adds values (an additive contract change)                                                                                                                    | F0's agent detects no screen; adding enum values later is backward compatible. AD-038 (assumed)                                                                           | y (AD-038)                 |
| What the test match is                                         | Leveling, activity `baal`, difficulty `hell`, region `americas`, `sc-ladder`, `rotw`; the signed-in player is host and only member; game name `mmbaalh-<n>`, `n` from one database sequence   | Smallest match that exercises ADR 017; `n` unique across rooms so two test rooms never share a name. The full name table is FR-14 (F1). AD-033, AD-039 (assumed)          | y (AD-033, AD-039)         |
| Whether a room shows `formed`                                  | The room is created and moves to `awaiting_host` in the same transaction; the site first shows "Awaiting host"                                                                                | The brief's seed scenario starts at "Awaiting host"; `formed` has no observable duration until the ready check (F1). AD-039 (assumed)                                     | y (AD-039)                 |
| When an observation creates the game                           | Only a `GAME_NAME_SEEN` from the host's agent whose value equals the expected name (case-insensitive); confidence is stored, not gated, in F0                                                 | INV-06; the agent's fusion decides confidence (Design Doc § agent). AD-034 (assumed)                                                                                      | y (AD-034)                 |
| Site language                                                  | pt-BR when the browser's first preferred language starts with `pt`, English otherwise; no language switcher in F0                                                                             | NFR-12 asks for both from day 0, not for a control. AD-040 (assumed)                                                                                                      | y (AD-040)                 |
| Who owns the agent's wire contracts                            | This feature: every agent-facing schema (pairing, claim, heartbeat, assignment, observation, stream events) is in `packages/contracts`, exported as JSON Schema for `typify`                  | Contracts first (AGENTS.md rule 2); one owner avoids two features editing `openapi.json` in parallel; agent-skeleton executes after this feature merges. AD-035 (assumed) | y (AD-035)                 |
| How presence reaches the site                                  | Pushed on the site's stream when it changes, no polling                                                                                                                                       | NFR-01's 2 s and the egress budget; the event name is a design choice                                                                                                     | y                          |
| Player-name identity                                           | Names compare ignoring case: `PlayerOne` and `playerone` open the same `<name>#test` account, shown as first typed                                                                            | Avoids look-alike test accounts; reversible. AD-042 (assumed)                                                                                                             | y (AD-042)                 |
| Minimum agent version                                          | `AGENT_MIN_VERSION`, read in `main/`, default `0.0.0`; every agent endpoint, pairing included, requires `X-Agent-Version`                                                                     | ADR 011 gives the 426 rule but no value; F0 ships `v0.0.1`. AD-043 (assumed)                                                                                              | y (AD-043)                 |

**Open questions:** none - all resolved or logged above.

---

## User Stories

### P1: Sign in with a test account ⭐ MVP

**User Story**: As a tester on staging, I want to sign in with a test account so that I can drive the skeleton
journey before Battle.net login exists.

**Why P1**: Every other story needs a session; FR-01 is stubbed in F0 (brief).

**Acceptance Criteria**:

1. WHERE `ENABLE_STAGING_ENDPOINTS` is `true`, WHEN a visitor uses "Sign in with a test account" and submits a player name of 2–16 letters, digits or `-` THEN the system SHALL open the account `<name>#test` — creating it on the first sign-in and reusing it when the same name, compared ignoring case, signs in again (AD-042) — set the session cookie with `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/` and `Max-Age=604800` (7 days), and show "Signed in as <display name>", where the display name is the name exactly as typed at the account's first sign-in.
2. IF the submitted player name is empty, has 1 character or 17 or more characters, or contains a character other than an ASCII letter, a digit or `-` (the name is not trimmed, so a leading or trailing space is such a character) THEN the system SHALL keep the visitor signed out and show "Use 2 to 16 letters, digits or hyphens."
3. IF `ENABLE_STAGING_ENDPOINTS` is not `true` THEN the API SHALL answer 404 to the test sign-in and test-match endpoints and the site SHALL not show "Sign in with a test account" or "Start test match".
4. IF a request to a site endpoint carries no session cookie, an unknown one or an expired one THEN the API SHALL answer 401 and the site SHALL show "Sign in with a test account" (staging) and no "Signed in as" text.

**Independent Test**: on a staging build, sign in as `PlayerOne`, reload the page and still see "Signed in as PlayerOne";
with the flag off, the control is absent and the endpoint answers 404.

---

### P1: Pair an agent with a code ⭐ MVP

**User Story**: As a player, I want to type the 6-digit code my agent shows into the site so that the agent acts for
my account without ever touching my Battle.net credentials.

**Why P1**: FR-03, ADR 011; heartbeat and observations need an agent token.

**Acceptance Criteria**:

1. WHEN an agent requests a pairing code THEN the API SHALL answer 201 with a 6-digit code (`000000`–`999999`), its expiry 5 minutes later and a claim secret, and store the code with no account.
2. WHEN a signed-in player submits an unexpired, unused code THEN the API SHALL bind that agent to the player's account, mark the code used and the site SHALL show "Agent paired".
3. WHEN an agent whose code was used claims with its claim secret THEN the API SHALL return an agent token once, store only its SHA-256 hash, and answer 410 to any later claim with the same secret.
4. IF an agent claims with the claim secret of a code that expired unused THEN the API SHALL answer 410 with no token.
5. WHILE the code is unused and unexpired, WHEN the agent claims THEN the API SHALL answer 202 with no token.
6. IF a signed-in player submits a code that is unknown, expired or already used THEN the API SHALL answer 400 without pairing and the site SHALL show "This code is invalid or has expired."
7. IF an account has submitted 10 codes within the last 5 minutes THEN the API SHALL answer 429 to that account's further code submissions until the oldest of them is 5 minutes old, and the site SHALL show "Too many attempts. Try again in a few minutes."
8. IF one IP address requests more than 10 pairing codes within one hour THEN the API SHALL answer 429 to the 11th and later requests in that hour.
9. WHEN an account that already has a paired agent pairs another one THEN the API SHALL revoke the previous agent's token, so that the previous token gets 401 on every agent endpoint.
10. The agent token SHALL be accepted only by the heartbeat, assignment, observation and stream endpoints, and the session cookie SHALL not be accepted by those agent endpoints (each answers 401 to the other credential).
11. IF a request to any agent endpoint — pairing code, claim, heartbeat, assignment, observation or agent stream — carries no `X-Agent-Version`, a value that is not a semantic version, or a version below `AGENT_MIN_VERSION` (default `0.0.0`, AD-043) THEN the API SHALL answer 426 without processing it; a version equal to or above the minimum SHALL be processed.

**Independent Test**: request a code as the agent, submit it on the site, claim the token, then call the heartbeat
with it (204) and a site endpoint with it (401).

---

### P1: See my agent's presence ⭐ MVP

**User Story**: As a player, I want to see on the site whether my agent is online, whether the game is open and which
screen it sees so that I know the platform can follow my game.

**Why P1**: FR-05; F1's queue requires an online agent (FR-31).

**Acceptance Criteria**:

1. WHEN the API receives a heartbeat with a valid agent token THEN it SHALL record the agent's presence (online, game running, screen) in memory, answer 204 and write nothing to Postgres.
2. WHEN a paired agent's presence changes THEN the site of its account SHALL show the new presence within 2 seconds of the API recording it: "Agent online" or "Agent offline", "Game open" or "Game closed", and "Screen: Unknown" or "Screen: Automap open".
3. IF the API receives no heartbeat from a paired agent for 45 seconds THEN it SHALL mark that agent offline.
4. WHILE a signed-in player has no paired agent the site SHALL show the pairing form with the label "Pairing code" and the action "Pair agent".
5. The site SHALL show "Download the agent" on every page, linking to `https://github.com/pedromoraisf/d2rmatchmaking/releases/latest/download/D2RMatchMaking-setup.exe`.
6. IF a heartbeat body does not match the heartbeat contract THEN the API SHALL answer 400 and keep the previous presence.

**Independent Test**: pair a simulated agent, send one heartbeat with the game running and watch the site switch to
"Agent online" and "Game open"; stop the heartbeats and watch "Agent offline" after 45 s.

---

### P1: A test room becomes Created ⭐ MVP

**User Story**: As a tester, I want to start a test match, see the room appear with its game name and see it become
Created when my agent reports that name so that the whole pipe — API, Postgres, outbox, SSE, agent — is proven.

**Why P1**: The walking skeleton's chosen case (Design Doc § Walking skeleton); NFR-01.

**Acceptance Criteria**:

1. WHERE `ENABLE_STAGING_ENDPOINTS` is `true`, WHEN a signed-in player uses "Start test match" THEN the API SHALL answer 202 and form one test match (AD-033) with that player as its only member, delivered to the Lobby Room as a `MatchFormed` event.
2. WHEN the Lobby Room module consumes a `MatchFormed` event THEN it SHALL create one room in stage `awaiting_host` with run 1, the game name `mm{activity}{difficulty}-{n}` (`mmbaalh-<n>` for the test match), an empty password and the member with the lowest join order as host, and write `RoomAssignmentChanged` and `RoomStageChanged` to the outbox in the same transaction.
3. IF the Lobby Room module consumes a `MatchFormed` event whose `matchId` already has a room THEN it SHALL create no second room.
4. WHEN a room is assigned to a signed-in player THEN the site SHALL show the room's game name, "No password" and the stage "Awaiting host".
5. WHEN a room is assigned to a member THEN that member's agent SHALL receive the room, run, expected game name and members on its stream, and the assignment endpoint SHALL return the same assignment.
6. WHEN the host's agent posts a `GAME_NAME_SEEN` observation for the room's current run whose value equals the expected game name, ignoring case THEN the room SHALL move to `created` and the site SHALL show "Created" within 2 seconds of the API receiving the observation.
7. IF a `GAME_NAME_SEEN` observation comes from a member who is not the host, names another run, or has a value different from the expected game name THEN the API SHALL answer 202, store the observation and leave the stage unchanged.
8. IF the room is already `created` and another `GAME_NAME_SEEN` with the expected name arrives under a new idempotency key THEN the room SHALL stay `created` and raise no second stage change.
9. IF an observation carries an idempotency key the API already stored THEN the API SHALL answer 202 and change no state.
10. IF an observation's `type` is not one of the contract's types THEN the API SHALL answer 202 and neither store it nor change state.
11. IF an agent posts an observation for a room its account is not a member of THEN the API SHALL answer 403 and store nothing.
12. WHEN a signed-in player with an assigned room loads or reloads the site THEN the site SHALL show that room's game name and current stage.
13. WHEN a player starts a test match while an earlier test room is still open THEN the system SHALL create a new room for the new match and the site SHALL show the newest room (staging only; INV-04's one-room rule arrives with the queue in F1).

**Independent Test**: sign in, pair a simulated agent, use "Start test match", see "Awaiting host" with the game name,
post the matching observation as the agent and see "Created" within 2 s.

---

### P1: Events survive restarts and reconnects ⭐ MVP

**User Story**: As a player, I want room updates to reach me even if the API restarts or my connection drops so that
the site never shows a stale stage.

**Why P1**: ADR 007 and ADR 008; the single Render instance restarts on every deploy and sleep.

**Acceptance Criteria**:

1. The API SHALL write every domain event to `platform.outbox` in the same transaction as the state change that raises it.
2. WHEN an outbox row is unpublished THEN the in-process relay SHALL publish it to the event bus and mark it published, also after a restart that happened between commit and publish.
3. WHEN a client opens the stream THEN the API SHALL send only events addressed to that client: a site stream receives its account's events and an agent stream receives its agent's events.
4. Every stream event SHALL carry an `id` that increases with the outbox order.
5. WHEN a client reopens the stream with `Last-Event-ID` THEN the API SHALL first send that client's events after that id, in order, then continue live.
6. WHILE a stream is open the API SHALL send a keep-alive comment every 25 seconds.
7. WHEN the site calls the API through the same-origin `/api/*` Pages Function THEN the Function SHALL forward the request with its cookies to the API origin and return the response with its `Set-Cookie` headers, and stream responses SHALL reach the browser event by event without buffering.

**Independent Test**: kill the API between the commit and the relay (integration test), restart it and see the event
delivered; reconnect a stream with `Last-Event-ID` and receive only the missed events.

---

### P1: Two composition roots, one app ⭐ MVP

**User Story**: As the maintainer, I want the API to start locally and on Render from two composition roots so that a
provider change touches only `main/` (NFR-08) and the free tier holds (NFR-07).

**Why P1**: F0 exit criteria (API on Render, `GET /healthz`, migrations before deploy).

**Acceptance Criteria**:

1. WHEN `GET /healthz` is called THEN the API SHALL answer 200 with `{"status":"ok"}` without querying Postgres.
2. The API SHALL be startable from `apps/api/src/main/local.ts` (Postgres from Docker) and from `apps/api/src/main/render.ts` (Render with Neon), and no file outside `apps/api/src/main/` SHALL read `process.env` (ESLint `n/no-process-env` or equivalent, as an error).
3. WHEN the API migration command runs THEN it SHALL apply every pending migration in `apps/api/migrations` (schemas `identity`, `agents`, `lobby`, `platform`), and a second run SHALL apply none and exit 0.
4. The API SHALL keep presence, rate-limit counters and the event bus in memory behind ports, run the outbox relay in the same process, and depend on no Redis, message broker or second service.
5. WHEN a commit that touches `apps/api/**` or `packages/**` reaches `main` and `ci.yml` is green THEN `deploy-api.yml` SHALL run the migrations against `NEON_DATABASE_URL`, call `RENDER_DEPLOY_HOOK`, and fail unless `GET /healthz` on the deployed API answers 200 within 5 minutes.
6. WHEN a commit that touches `apps/web/**` or `packages/**` reaches `main` THEN `deploy-web.yml` SHALL publish the site and its `/api/*` Function to Cloudflare Pages, and WHEN a pull request touches them THEN it SHALL publish a preview and post its URL on the pull request.
7. Every application use case SHALL run inside an OpenTelemetry span named `<context>.<use-case>` (e.g. `lobby.record-observation`), using `@opentelemetry/api` only.

**Independent Test**: `main/local.ts` starts against Testcontainers Postgres and `/healthz` answers; migrations run twice;
ESLint fails on a `process.env` read in a module file.

---

### P1: Contracts first ⭐ MVP

**User Story**: As a contributor, I want every route, event and agent message defined once in `packages/contracts` so
that the API, the site and the Rust agent cannot drift (ADR 009, ADR 020).

**Why P1**: `agent-skeleton` generates its Rust types from these schemas (AD-035).

**Acceptance Criteria**:

1. Every HTTP route of this feature, the staging-only test sign-in and test-match routes included, SHALL validate its body, params and response with a Zod schema from `@d2rmm/contracts`, and `packages/contracts/openapi.json` SHALL list each route with those schemas.
2. Every stream event of this feature SHALL have a Zod schema in `@d2rmm/contracts` and appear in `packages/contracts/asyncapi.json`.
3. WHEN a contributor runs `pnpm contracts:openapi` THEN `@d2rmm/contracts` SHALL also write one JSON Schema file per agent-facing message (pairing code, claim, heartbeat, assignment, observation, agent stream event) under `packages/contracts/json-schema/`, and `pnpm contracts:check` SHALL report no drift.

**Independent Test**: change a schema without regenerating; `pnpm contracts:check` fails.

---

### P2: The site speaks English and Portuguese

**User Story**: As a Brazilian player, I want the site in Portuguese when my browser is in Portuguese so that the
community's second language is served from day 0.

**Why P2**: NFR-12 (F1 is its primary phase); the strings this feature adds must already be translated.

**Acceptance Criteria**:

1. The site SHALL take every user-facing string from `en` and `pt-BR` translation files that hold the same keys, and ESLint SHALL fail on a literal user-facing string in a component.
2. WHEN the browser's first preferred language starts with `pt` THEN the site SHALL render in pt-BR; otherwise it SHALL render in English.
3. The site SHALL show on every page the notice "D2R Match Making is a community project and is not affiliated with Blizzard Entertainment."

**Independent Test**: open the site with `Accept-Language: pt-BR` and see Portuguese labels; a unit test fails when a
key is missing in one file.

---

## Edge Cases

- IF the stream drops while a room changes stage THEN the reconnect with `Last-Event-ID` SHALL deliver the missed `room.stage_changed` (AWS-28).
- IF the agent posts the matching observation twice with two different idempotency keys THEN the room SHALL stay `created` and raise `RoomStageChanged` only once (AWS-24).
- IF a pairing code expires while the agent is claiming THEN the claim SHALL answer 410 (AWS-07) and the agent requests a new code (agent-skeleton).
- WHEN a heartbeat arrives from a revoked token THEN the API SHALL answer 401 and record no presence (AWS-10).

---

## Implicit-requirement dimensions

| Dimension                                | Resolution                                                                                                                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Input validation & bounds                | AWS-02 (player name), AWS-08 (codes), AWS-18 (heartbeat contract), AWS-25 (observation types and room membership), AWS-36 (every route validated) |
| Failure / partial-failure states         | AWS-26 (restart between commit and relay), AWS-15 (offline after 45 s), AWS-34 (deploy fails without a healthy `/healthz`)                        |
| Idempotency / retry / duplicate handling | AWS-07 (claim once), AWS-20 (one room per match), AWS-24 (idempotency key), AWS-28 (`Last-Event-ID` replay)                                       |
| Auth boundaries & rate limits            | AWS-03, AWS-04, AWS-09, AWS-10, AWS-11, AWS-12                                                                                                    |
| Concurrency / ordering                   | AWS-39 (ids increase with outbox order), AWS-28 (replay in order), AWS-21 (a newer test match replaces the shown room)                            |
| Data lifecycle / expiry                  | AWS-05 (codes expire in 5 min), AWS-01 (sessions expire in 7 days); clean-up jobs out of scope (F0 volume)                                        |
| Observability                            | AWS-35 (use-case spans); export and the end-to-end trace are `observability-e2e`                                                                  |
| External-dependency failure              | AWS-26 (Postgres commit vs relay), AWS-34 (Render/Neon deploy fails closed)                                                                       |
| State-transition integrity               | AWS-23, AWS-24 (only the host's matching observation moves `awaiting_host` → `created`), AWS-20 (no second room)                                  |

---

## Requirement Traceability

| Requirement ID | Story                                               | Phase  | Status  |
| -------------- | --------------------------------------------------- | ------ | ------- |
| AWS-01         | P1: Sign in with a test account (AC 1)              | Design | Pending |
| AWS-02         | P1: Sign in with a test account (AC 2)              | Design | Pending |
| AWS-03         | P1: Sign in with a test account (AC 3)              | Design | Pending |
| AWS-04         | P1: Sign in with a test account (AC 4)              | Design | Pending |
| AWS-05         | P1: Pair an agent with a code (AC 1)                | Design | Pending |
| AWS-06         | P1: Pair an agent with a code (AC 2)                | Design | Pending |
| AWS-07         | P1: Pair an agent with a code (AC 3-5)              | Design | Pending |
| AWS-08         | P1: Pair an agent with a code (AC 6)                | Design | Pending |
| AWS-09         | P1: Pair an agent with a code (AC 7-8)              | Design | Pending |
| AWS-10         | P1: Pair an agent with a code (AC 9)                | Design | Pending |
| AWS-11         | P1: Pair an agent with a code (AC 10)               | Design | Pending |
| AWS-12         | P1: Pair an agent with a code (AC 11)               | Design | Pending |
| AWS-13         | P1: See my agent's presence (AC 1)                  | Design | Pending |
| AWS-14         | P1: See my agent's presence (AC 2)                  | Design | Pending |
| AWS-15         | P1: See my agent's presence (AC 3)                  | Design | Pending |
| AWS-16         | P1: See my agent's presence (AC 4)                  | Design | Pending |
| AWS-17         | P1: See my agent's presence (AC 5)                  | Design | Pending |
| AWS-18         | P1: See my agent's presence (AC 6)                  | Design | Pending |
| AWS-19         | P1: A test room becomes Created (AC 1)              | Design | Pending |
| AWS-20         | P1: A test room becomes Created (AC 2-3)            | Design | Pending |
| AWS-21         | P1: A test room becomes Created (AC 4, 12-13)       | Design | Pending |
| AWS-22         | P1: A test room becomes Created (AC 5)              | Design | Pending |
| AWS-23         | P1: A test room becomes Created (AC 6)              | Design | Pending |
| AWS-24         | P1: A test room becomes Created (AC 7-9)            | Design | Pending |
| AWS-25         | P1: A test room becomes Created (AC 10-11)          | Design | Pending |
| AWS-26         | P1: Events survive restarts and reconnects (AC 1-2) | Design | Pending |
| AWS-27         | P1: Events survive restarts and reconnects (AC 3)   | Design | Pending |
| AWS-28         | P1: Events survive restarts and reconnects (AC 5)   | Design | Pending |
| AWS-29         | P1: Events survive restarts and reconnects (AC 7)   | Design | Pending |
| AWS-30         | P1: Two composition roots, one app (AC 1)           | Design | Pending |
| AWS-31         | P1: Two composition roots, one app (AC 2)           | Design | Pending |
| AWS-32         | P1: Two composition roots, one app (AC 3)           | Design | Pending |
| AWS-33         | P1: Two composition roots, one app (AC 4)           | Design | Pending |
| AWS-34         | P1: Two composition roots, one app (AC 5-6)         | Design | Pending |
| AWS-35         | P1: Two composition roots, one app (AC 7)           | Design | Pending |
| AWS-36         | P1: Contracts first (AC 1-3)                        | Design | Pending |
| AWS-37         | P2: The site speaks English and Portuguese (AC 1-2) | Design | Pending |
| AWS-38         | P2: The site speaks English and Portuguese (AC 3)   | Design | Pending |
| AWS-39         | P1: Events survive restarts and reconnects (AC 4)   | Design | Pending |
| AWS-40         | P1: Events survive restarts and reconnects (AC 6)   | Design | Pending |

**Coverage:** 40 total, 0 mapped to tasks, 40 unmapped ⚠️ (mapped at Tasks)

---

## Sources

- `docs/product/prd.md#FR-01` - sign-in and session cookie; stubbed in F0 → AWS-01..04 (AD-029, AD-036)
- `docs/product/prd.md#FR-03` - pairing by a 6-digit code → AWS-05..12
- `docs/product/prd.md#FR-05` - presence: online, game open, current screen → AWS-13..18
- `docs/product/prd.md#NFR-01` - room stage on the site within 2 s of the observation → AWS-14, AWS-23
- `docs/product/prd.md#NFR-06` - agent token revocable and restricted → AWS-10, AWS-11
- `docs/product/prd.md#NFR-07` - free tiers: in-memory stores, no heartbeat writes → AWS-13, AWS-33
- `docs/product/prd.md#NFR-08` - provider only in the composition layer → AWS-31, AWS-34
- `docs/product/prd.md#NFR-12` - English source strings, pt-BR from day 0 → AWS-37
- PRD § Restrições ("aviso de não afiliação no site") and AGENTS.md "Never do" → AWS-38
- ADR 002 (modular monolith) - the five modules talk through ports and events → AWS-19, AWS-20
- ADR 005 (hosting) - Pages, Render, Neon → AWS-31, AWS-34
- ADR 006 (no Redis) - presence and bus in memory → AWS-13, AWS-33
- ADR 007 (SSE) - one stream, `Last-Event-ID`, 25 s keep-alive → AWS-27, AWS-28, AWS-39, AWS-40
- ADR 008 (outbox) - events in the same transaction, in-process relay → AWS-20, AWS-26
- ADR 009 (shared contracts) - Zod → JSON Schema → `typify` → AWS-36 (AD-035)
- ADR 011 (agent auth) - short-lived single-use rate-limited codes, hashed revocable token, 426 → AWS-05..12 (AD-043)
- ADR 012 (session cookie through the Pages proxy) - `/api/*` Function, SSE through it → AWS-29, AWS-01
- ADR 015 (agent release) - the site links `releases/latest/download/D2RMatchMaking-setup.exe` → AWS-17
- ADR 017 (game name) - `mm{activity}{difficulty}-{n}`, empty password → AWS-20 (AD-033, AD-039)
- ADR 020 (OpenAPI generated) - routes and events in `openapi.json` / `asyncapi.json` → AWS-36
- `docs/domain/invariants.md` INV-06, INV-08, INV-09 → AWS-20, AWS-23, AWS-24
- `docs/architecture/design-doc.md` § Walking skeleton, § Contratos, § Modelo de dados, § CI/CD → all
- `docs/engineering/telemetry.md` and AGENTS.md rule 10 (spans from day 0) → AWS-35
- `.specs/phases/F0/brief.md` - features table, exit criteria (download button, Pages proxy, Render deploy), Q2/Q3 answers → all
- AD-029 … AD-043 (assumed) - `.specs/STATE.md`

---

## Success Criteria

- [ ] The acceptance scenario "The host's agent sees the expected game name" passes locally against `main/local.ts`.
- [ ] `pnpm check` and `pnpm contracts:check` exit 0 with the new routes.
- [ ] The domain and application mutation scores meet 80% / 70%.
