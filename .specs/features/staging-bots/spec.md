# Staging bots — Specification

**Phase**: F2 (covered by the brief's approval, ADR 029) · **Size**: Medium (Complex in its security surface) ·
**Security review**: yes (a staging-only identity, agent tokens, a workflow that creates sessions) · **Status**: APPROVED by the orchestrator, 2026-11-21 (batches 1 to 3 in progress)

## Problem

The maintainer tests alone and has no second player. A ready check needs a full group: 2 players in a PvP duel, 8 in
Leveling (FR-12, QUE-07). So they cannot reach a ready check, a room, the agent's presence confirmation or the site's
room screens on staging, which blocks the field log of the F2 exit criteria ("at least 20 rooms across normal,
nightmare and hell reach Confirmed by the agent") and the agent lifecycle checks (FR-05, FR-16).

The maintainer chose **bots in staging** (2026-11-21): synthetic players join the staging queue with them, accept the
ready check and confirm presence through fake agents. Production is never touched.

## What exists today (reuse, do not rebuild)

- **Staging identity.** `POST /v1/auth/test-login` signs in (and creates) a _test account_ from a name of 2 to 16
  letters, digits and `-` (`PlayerName`). It is registered only when `ENABLE_STAGING_ENDPOINTS=true`; `render.ts`
  refuses that flag unless `D2RMM_ENV=staging`, and `render.yaml` sets it to `'false'` on `d2rmm-api-production`.
  A test account counts as linked (INV-03) only while staging endpoints are on (`isLinked`). It needs no secret: its only
  guard is the same-origin check (the staging site's origin, a public value).
- **`GET /v1/config`** answers `stagingEndpoints` (a boolean), so a client can tell a staging API from a production one.
- **The load journey** (`scripts/load/lib/provision-requests.mjs`, `provision.mjs`, `k6/journey.mjs`) already builds
  every request a player and an agent make: test login, character registration, pairing code, pair, claim, heartbeat,
  agent stream, accept, observation, leave, close. It runs in k6 and in the nightly; bots reuse its request builders.
- **The acceptance stack** (`tests/acceptance/support/`) has the same agent client and SSE reader in TypeScript, and the
  integration suite starts the real app with `stagingEndpoints: true`.
- **Staging** is the `d2rmm-api` Render service and the `staging` GitHub environment (ADR 033, `api.yml`,
  `stage-smoke.yml`).

So the server already has everything a bot needs. **This feature adds no server route.**

## Requirements

- **SBT-01** — The maintainer SHALL start bots with the manual workflow `staging-bots.yml` (`workflow_dispatch`,
  usable from the GitHub phone app), running `scripts/staging/bots.mjs` (an admin task, ADR 032 XII). Inputs:
  - `mode`: `pvp` or `leveling`;
  - `difficulty`: `normal`, `nightmare` or `hell`;
  - `region`: `americas`, `europe` or `asia` (default `americas`);
  - `ladder` and `era`, the values the bots' characters declare (CHR-15), so they fall in the maintainer's bucket
    (QUE-07);
  - for `leveling`: `activity` and the bots' `role` (QUE-02);
  - `bots`: how many, from 1 to the group size minus 1 (SBT-06);
  - `human_first` (default `true`): the bots queue only after a non-bot waits in the bucket (SBT-06);
  - `host_policy`: what a bot does when the match still names it host, `bot-reports` (default) or `bot-silent` (SBT-07);
  - `minutes`: how long they stay, from 1 to 60 (default 15).
    An input outside its set SHALL fail the run before any request.
- **SBT-02** — The script SHALL refuse a target that is not staging, before it makes any write:
  - the API origin comes only from the `staging` environment's variable `STAGING_API_URL` (never from an input, so a
    dispatcher cannot type a URL), and the script SHALL refuse a value that is not an https origin (loopback http is
    allowed for tests);
  - it SHALL call `GET /v1/config` first and exit non-zero unless `stagingEndpoints` is `true`;
  - it SHALL exit non-zero when the environment says `D2RMM_ENV=production`.
    Every refusal SHALL name the reason and make no request other than `/healthz` and `/v1/config`.
- **SBT-03** — The server side that lets a bot exist SHALL NOT be reachable in the production composition root:
  - the feature SHALL add no route, test control or flag to the API; bots use only `POST /v1/auth/test-login` and the
    public agent and site routes;
  - a test SHALL build the API with the production settings (`stagingEndpoints: false`) and prove that
    `/v1/auth/test-login` and `/v1/staging/match-formed` answer 404, that a session-less queue join stays 401, and that
    `render.ts`'s `refusalOf` refuses `ENABLE_STAGING_ENDPOINTS=true` outside `D2RMM_ENV=staging`;
  - the route-table test (`agent-route-table.ts`) SHALL keep every route that exists only with staging endpoints in a
    list, and fail when a route registered in the staging branch is missing from it, so a later bot route cannot slip
    into production unnoticed.
- **SBT-04** — A bot's identity SHALL be a test account whose name starts with `bot-` (for example `bot-k7-3`: `bot-`, a
  two-character run tag, the bot's number). The name is the bot's marker and is never reused by a real player:
  Battle.net display names come from a BattleTag (letters and digits, then `#`), which cannot hold a `-`. Bots SHALL
  NEVER sign in through Battle.net and SHALL NOT use a Battle.net credential, a client secret or a token of a real
  account. The threat model below is part of this requirement.
- **SBT-05** — For each bot the script SHALL, with one HTTP client per bot and no state outside the process:
  1. sign in with `test-login` (same-origin header of the staging site, `SITE_ORIGIN`, read from the environment);
  2. pair a fake agent through the real flow: pairing code, `POST /v1/agents/pair` with the bot's session, claim;
  3. register one character with the agent token (`POST /v1/me/characters`): a name of letters starting with `Bot`
     (the contract's character pattern allows no digit), level 90, every difficulty unlocked, and the declared ladder
     and era;
  4. start heartbeats every 15 s, with `game.running: true`, `window: "Diablo II: Resurrected"`, the screen the room
     stage implies, and the agent version the API accepts (`minAgentVersion` of `/v1/config`);
  5. hold the bot's **site stream** (`GET /v1/stream` with its session cookie), because a queue needs a paired and
     online agent, a linked account and a connected site (INV-03, FR-31). The first heartbeat and the site stream come
     before the join.
- **SBT-06** — The bots SHALL join the same queue bucket as the maintainer (mode, region, difficulty, ladder, era and,
  in Leveling, activity and the level floor), `bots` of them, and stay queued until the group forms.
  - With `human_first` (the default) the first bot is a **sentinel**: it queues, reads `poolSize` of
    `GET /v1/queue/tickets/me` (the number the site shows as "N jogadores nesta fila"; the API counts a bucket only for
    an account that holds a ticket), and the other bots queue only when `poolSize` minus the bots of this run already
    queued is at least 1, so a non-bot waits. The sentinel waits at most `minutes`, then the run ends cleanly. The human
    hosts when they queued before the sentinel and no bot has the `teleporter` role (`matcher.ts`: PvP hosts the first
    ticket, Leveling the teleporter, else the first); bots never take `teleporter`, and the maintainer queues first and
    dispatches after. With `human_first: false` every bot queues at once.
  - The group size is 2 for a PvP duel and 8 for Leveling (QUE-07). `bots` SHALL be at most size − 1, so the bots can
    never form a group among themselves: the group forms only when the maintainer joins. The default is size − 1.
  - A bot whose ready check failed returns to the queue through the API's own rules (RDY-04, RDY-05) and nothing else
    is added; a bot never joins twice.
- **SBT-07** — Each bot's fake agent SHALL speak only the real agent contract, as the load journey does, and SHALL send
  nothing a real agent would not:
  - it holds the agent stream (`GET /v1/stream` with its agent bearer token) beside the site stream of SBT-05, and
    reconnects each with `Last-Event-ID`;
  - on `ready_check.started` it accepts with the agent's route after a random delay of 2 to 10 s (RDY-02, RDY-07 is the
    hotkey, so the same route a real agent calls);
  - on `room.assigned` it posts the room's `GAME_NAME_SEEN` observation with the assigned name and run, as the agent
    does once its Party-panel read matches (LBR-03, LBR-04). A bot named host posts first, and the room reaches
    `created` without a real game: the maintainer sees the room's states (FR-15) but cannot join a game that does not
    exist. See open question 1;
  - it posts no screenshot, no capture, nothing from a game, and no field a real agent's contract lacks. The contract's
    schemas validate every body before it is sent.
- **SBT-08** — The script SHALL be bounded and idempotent:
  - at most 7 bots and 60 minutes, whatever the inputs say; the workflow SHALL set `timeout-minutes` and a
    `concurrency` group of one run at a time, `cancel-in-progress: false`;
  - one request at a time per bot after the join, never faster than the API's rate limits (the heartbeat route's
    bucket, the observation bucket); a `429` backs off by `Retry-After` and is never a failure of the run;
  - a run of N bots spends N of the 10 pairing codes an IP may ask per hour (`IP_CODE_REQUESTS`), so a second large run
    from the same runner IP within the hour can be refused; the script reads that 429 as "wait for the hour", fails
    before it queues anyone and never asks for the limit to be raised;
  - a second dispatch with the same inputs creates no duplicate accounts (test accounts are found by name) and no
    duplicate tickets (a second join is a `409` the script reads as "already queued").
- **SBT-09** — The maintainer SHALL be able to tell a bot from a player without any change to the site or the contract
  (decision 2026-11-21: no badge; a test tool earns no server or contract change, and the site shows no other player's
  name). A bot is told apart by:
  - the job summary, which lists the bots' names (`bot-<tag>-<n>`) and each room;
  - the structured log, which names each bot on every line;
  - its character, named `Bot…` at level 90, so the class marks of a group show bots of level 90 only.
- **SBT-10** — The bots SHALL leave cleanly. They do so when the room ends (`room.closed`, or their own `room.member_changed`
  with `left`), when `minutes` pass, when the run is cancelled (SIGINT, SIGTERM) and when the script fails. Leaving is:
  1. `POST /v1/lobby-rooms/{id}/leave` when in a room, or `DELETE /v1/queue/tickets/{id}` when queued;
  2. `DELETE /v1/agents/{id}` for the bot's agent, with the bot's session (the route is a session route), which revokes
     its token (NFR-06);
  3. `POST /v1/auth/logout` for its session;
  4. closing its streams.
     A failed step SHALL be logged and SHALL NOT stop the others. The exit code is non-zero when any cleanup step failed,
     and after the cleanup no token of the run SHALL be valid.
- **SBT-11** — The run SHALL write no secret. Session cookies and agent tokens live in process memory only, are never
  printed, never written to a file, an artifact or the job summary, and are masked in the workflow's log. The job summary
  SHALL list, for the maintainer: the mode and bucket, the bots' names, the group that formed, the room's name and
  stage changes with timestamps, and how each bot left. Log lines are structured, one JSON object per line, on stdout
  (ADR 032 XI). The script has no new telemetry exporter; its structured log is its telemetry (rule 10).
- **SBT-12** — The workflow SHALL need no new secret and no write permission:
  - `permissions: contents: read`, the GitHub environment `staging`, actions pinned by SHA (as the harness test
    requires);
  - it reads only the environment variables `STAGING_API_URL` and `SITE_ORIGIN` (not secrets: both are public URLs);
  - it SHALL NOT read `BNET_*`, `DATABASE_URL` or any other secret. Config is read only in `scripts/staging/config.mjs`
    (the script's `main/`, rule 13 III), never in the libraries.
    If the design needs a secret, the implementation SHALL stop and report which one (rule 6).
- **SBT-13** — The maintainer SHALL find the runbook in `docs/engineering/staging-bots.md`: how to dispatch from the
  phone, what each input means, how a run reads, and how to stop one. It states that the bots exist only on staging, and
  the "how to run" section below.

## Threat model of the bot identity (for the security reviewer)

**What a bot is.** A test account created by `POST /v1/auth/test-login`, the same call the load harness and the
acceptance stack make, plus an agent paired to it. Nothing new on the server: the identity is the _narrowest_ one that
exists, because it already is staging-only and secret-free. The alternatives were weighed and rejected:

| Option                                           | Why not                                                                                                                |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| A Battle.net account per bot                     | Violates "bots never sign in through Battle.net"; needs real credentials (a secret) and Blizzard's terms               |
| A new `/v1/staging/bots` route with a bot secret | A new route and a new secret; one more thing that must stay out of production                                          |
| A `is_bot` column                                | A migration and a contract change for a marker the name already carries, with no extra protection                      |
| A signed bot token minted by the workflow        | A new secret and a new verifier in the API                                                                             |
| The `test-login` account with a `bot-` name      | **Chosen.** No server change, no secret, only reachable on staging, marker unspoofable by Battle.net accounts (SBT-04) |

**Assets.** The staging database and queue (test data only, no real player's data), the staging API's free-tier quota
(NFR-07), the maintainer's staging session. Production assets are outside the reach of this feature.

**Actors.** (1) Anyone on the internet: `test-login` on staging is already public today, so any visitor can create a
test account named `bot-x`. This feature does not widen that exposure; it relies on it. (2) A user with write access to
the repository, who can dispatch the workflow (GitHub's permissions are the gate). (3) A malicious or confused
maintainer input.

| #   | Threat                                                          | Mitigation                                                                                                                                                                                      | Proof                                           |
| --- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| T1  | The script runs against production                              | URL only from the `staging` environment variable, never an input; exact-match check; `/v1/config` must say `stagingEndpoints: true`; refuses `D2RMM_ENV=production`; no write before the checks | SBT-02 unit tests with a production-shaped fake |
| T2  | Production serves the bot identity                              | No new route. `test-login` exists only with `stagingEndpoints`; `render.ts` refuses the flag outside `D2RMM_ENV=staging`; `render.yaml` sets `'false'` on production                            | SBT-03 integration test and route-table test    |
| T3  | A bot is mistaken for a real player, or a real player for a bot | `bot-` names, the job summary and log naming each bot, a `Bot` character prefix. BattleTags cannot hold `-`, so Battle.net accounts never carry the marker                                      | SBT-04, SBT-09 tests                            |
| T4  | A bot token leaks (log, artifact, summary)                      | Memory only; never printed; masked; the summary lists names and rooms only; the agent is deleted at exit, which revokes the token; staging tokens cannot touch production (separate database)   | SBT-10, SBT-11 tests                            |
| T5  | Bots flood or exhaust staging                                   | At most 7 bots and 60 minutes; one run at a time; rate-limit aware back-off; heartbeats at the real 15 s cadence                                                                                | SBT-08 tests                                    |
| T6  | Bots grief other staging users (a real tester stuck waiting)    | `bots` ≤ size − 1, so a bot never fills a group alone; bots accept their ready checks and leave on time; staging users are the maintainer and invited testers                                   | SBT-06, SBT-10 tests                            |
| T7  | The workflow gains a write path (secrets, repo, deployments)    | `contents: read`, no secrets, pinned actions, environment `staging` only; a harness test reads the workflow file and fails on a `secrets.` reference or a write permission                      | SBT-12 harness test                             |
| T8  | A fake agent says what a real agent would never say             | Every body is validated by the contract schemas; the only observation is `GAME_NAME_SEEN` with the room's own name; no capture, no screenshot                                                   | SBT-07 tests                                    |
| T9  | Bot accounts and tickets pile up                                | Tickets, rooms' memberships, agents and sessions are removed at exit; test accounts remain (they are cheap rows and a rerun reuses them)                                                        | SBT-10 test                                     |

**Residual risk.** `test-login` stays open to the internet on staging (an existing, accepted exposure, F0 decision). A
visitor could create a `bot-` account and queue with it. That harms only staging test data. Closing it (a shared secret
for staging sign-in) is out of scope and would be a new secret, the maintainer's decision.

## Sources

| ID     | Source                                                                                                                 |
| ------ | ---------------------------------------------------------------------------------------------------------------------- |
| SBT-01 | Maintainer 2026-11-21 ("bots em staging", workflow from the phone); ADR 032 XII (admin tasks as scripts)               |
| SBT-02 | Maintainer 2026-11-21 (never production); ADR 033 (staging and production are separate); AGENTS.md rule 7              |
| SBT-03 | Maintainer 2026-11-21; AWS-03 (staging endpoints answer 404 without the flag), AD-045; `render.ts` `refusalOf`         |
| SBT-04 | Maintainer 2026-11-21 (no Battle.net for bots); FR-31, INV-03 (a queue needs a linked account); AD-029 (test accounts) |
| SBT-05 | FR-05, FR-16 (agent presence); AGS-10, AGS-11 (heartbeat); CHR-09, CHR-15 (characters, ladder and era)                 |
| SBT-06 | FR-08, FR-09, INV-01 (same bucket, never relaxed); QUE-07 (group sizes); FR-12                                         |
| SBT-07 | FR-12, RDY-02; FR-14, FR-15, FR-16, INV-06, LBR-03, LBR-04; ADR 010 (the agent reads, the server sends data); NFR-04   |
| SBT-08 | NFR-07 (free tier); NFR-14 (rate limits stay as designed); ADR 032 VIII (concurrency), IX (disposability)              |
| SBT-09 | FR-16; NFR-12 (i18n); AGENTS.md rule 9                                                                                 |
| SBT-10 | LBR-07, LBR-08, LBR-09; NFR-06 (revocable token); ADR 032 IX (graceful shutdown)                                       |
| SBT-11 | AGENTS.md rules 6 and 10; NFR-04; ADR 032 XI                                                                           |
| SBT-12 | AGENTS.md rules 6, 7, 13; ADR 033 (secrets reach only deploy and promote); F2 brief (no new cost, NFR-07)              |
| SBT-13 | F2 brief ("field log", exit criteria for the read rate and the agent lifecycle)                                        |

## Requirement Traceability

| Requirement ID | Story         | Proof                                                                                                |
| -------------- | ------------- | ---------------------------------------------------------------------------------------------------- |
| SBT-01         | Dispatch      | `node --test` on the input plan + harness test on the workflow's inputs                              |
| SBT-02         | Refuse        | `node --test` with fake APIs (production-shaped, wrong origin, `stagingEndpoints:false`)             |
| SBT-03         | Not in prod   | API integration test on the production settings + route-table test + `refusalOf` test                |
| SBT-04         | Identity      | unit tests on the name builder; threat model reviewed by the security reviewer                       |
| SBT-05         | Provision     | integration test against the real app (`stagingEndpoints: true`)                                     |
| SBT-06         | Join          | `node --test` on the plan (bounds) + integration test: a duel with one bot and one test player forms |
| SBT-07         | Fake agent    | integration test: accept + observation reach `active`; schema-validation unit test                   |
| SBT-08         | Bounded       | unit tests (bounds, back-off) + harness test (timeout, concurrency)                                  |
| SBT-09         | Marker        | the summary test of SBT-11 (names listed); no site change                                            |
| SBT-10         | Clean leave   | integration test: after the run no token authenticates; failing step does not stop the rest          |
| SBT-11         | No secret     | unit test: the log and summary of a full run hold no token or cookie value                           |
| SBT-12         | No new secret | harness test on `staging-bots.yml`                                                                   |
| SBT-13         | Runbook       | `pnpm specs:check` and the doc exists                                                                |

## Decisions (conservative defaults)

- **One script, one HTTP client per bot** in Node 26 (`fetch`, native TypeScript stripping like `apps/api`), importing the
  load harness's request builders (`scripts/load/lib/provision-requests.mjs`) instead of copying them. k6 is not used:
  the run is one-shot and long-lived streams are plain `fetch`.
- **No server change** (SBT-03). If implementation shows a server change is needed, it stops and reports before writing it.
- **`bots` defaults to size − 1** and is capped there. Two bots never match each other.
- **Bots join as soon as the run starts** and wait. The maintainer joins after; the group forms on their join.
- **A bot named host posts `GAME_NAME_SEEN`** (open question 1).
- **The marker is the name**, not a column.
- Bots are staging-only by construction: production cannot be reached from the workflow because the URL is the staging
  environment's variable.

## How to run (the runbook's core)

1. Join the queue yourself first, on the site you already use, with the bucket you want (mode, difficulty, region,
   ladder, era, and in Leveling the activity).
2. Dispatch `staging-bots` from the GitHub phone app with the same bucket, and the number of bots (default: group size
   minus 1).
3. The sentinel sees you waiting, the others queue, the group forms and the ready check opens on your site. Accept it.
4. The bots leave when the room ends or after `minutes`. Cancel the run to make them leave at once.

Today the staging API **is** the service the maintainer already uses: `https://d2rmm-api.onrender.com`, whose
`GET /v1/config` answers `stagingEndpoints: true`; the production service does not exist yet. The `staging` environment
variables are `STAGING_API_URL=https://d2rmm-api.onrender.com` and `SITE_ORIGIN=https://staging.d2rmatchmaking.pages.dev`. The
script still trusts `/v1/config`, never the name of the host, because that host may change (SBT-02). The maintainer adds
the two variables; the repository settings are theirs.

## Decisions taken with the orchestrator (2026-11-21)

- The human hosts: `human_first` is the default, with the sentinel above. A bot named host follows `host_policy`.
- A second dispatch queues behind the first (`cancel-in-progress: false`).
- The rate limits stay as they are (notes.md A3).
