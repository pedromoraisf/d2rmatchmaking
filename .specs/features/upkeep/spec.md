# Upkeep — Specification

**Phase**: F2 (covered by the brief's approval, ADR 029) · **Size**: Medium · **Security review**: yes, on the diff (a new
429 on session and agent-token routes; the dependency bumps change what runs in CI)

## Problem

F1 closed with a list of small items that belong to no feature: review notes of #77, #80 and #81, two API hardening
items, CI cost items in the nightly, and 11 open Dependabot PRs (#13–#18, #36, #38, #39, #42, #78), several of them
majors. The brief's exit criterion "Upkeep" asks that every Dependabot PR open at kickoff is merged or closed with its
reason, and that the review items of #77, #80 and #81 are done (proof: the PR list). This feature collects them as one
batch so they do not compete with the product features for a worker slot.

Stream-egress items are not here (their own feature). No Rust reading module is touched (AGENTS.md rule 14,
`scripts/agent/reading-modules.json`); UPK-01 touches only the contract plumbing for the agent's stream event.

## User stories

- As the maintainer, I want the agent's stream event types generated from the contract, so the agent cannot drift from
  what the API sends (ADR 009).
- As a player, I want a runaway client (a stuck tab, a looping script) unable to hammer my agent-status and ready-check
  routes, and no limit that I can hit by normal use.
- As the maintainer, I want the nightly report to read cleanly and the load job not to build its images twice.
- As the maintainer, I want the open Dependabot PRs resolved with all gates green, or closed with a reason.

## Requirements

- **UPK-01** — The agent's `room.stage_changed` stream event SHALL be a type generated from the contract, as the other
  agent stream events are. The adapters SHALL parse the event through that type, not through a hand-written struct. A
  change to the event's schema SHALL change the generated type or fail the contract check. Reading modules are not touched.
- **UPK-02** — `GET /v1/agents/me` SHALL allow at most 60 requests per minute for one account (sliding window). The 61st
  and later requests in the window SHALL answer `429` with `{ "error": "rate-limited" }` and a `Retry-After` header with
  the whole seconds until the oldest request leaves the window. Another account SHALL be unaffected, and the same
  account SHALL be answered again once the window has passed.
- **UPK-03** — The ready-check routes (`GET /v1/ready-checks/me`, `POST /v1/ready-checks/:id/accept` and `…/decline`)
  SHALL share one window of 60 requests per minute for the calling principal: the account of a session, or the account
  of an agent token. Over the limit they SHALL answer `429` as UPK-02 does. The refusals that exist today (`401`, `404`,
  `409`, `426`) SHALL not change inside the limit.
- **UPK-04** — `projectStreamEvent` SHALL look up each member's current agent concurrently (`Promise.all`) in every case
  that does so, and SHALL return the deliveries in the same order as today: for each member, the site delivery before
  that member's agent delivery, members in payload order.
- **UPK-05** — The nightly report SHALL show load p95 values, and their trend against the previous run, rounded to two
  decimals with no floating-point residue (`12.3` not `12.300000000000001`), and `n/a` when absent.
- **UPK-06** — The load job of `nightly.yml` SHALL build the API and k6 images once. `pnpm test:load` SHALL skip its own
  build when `LOAD_IMAGES_PREBUILT=1` is set and both images exist locally, and SHALL still build them in every other
  case (a local run is unchanged). The workflow SHALL set the variable after its cached builds. `ci.yml` job names and
  `ocr-real.yml` are not changed.
- **UPK-07** — WHEN a difficulty is locked for the chosen character THEN the site SHALL draw "Locked on this character"
  below the difficulty's name, never over it. This replaces the CSS-reading test in `QueuePanel.test.tsx` (#80 review)
  with a browser check of the two boxes.
- **UPK-08** — `scripts/agent/reading-modules.json` SHALL stay a list or an object with a `modules` or `files` list, and
  the nightly report SHALL read it. A unit test SHALL fail when the committed file has neither shape or yields no path.
- **UPK-09** — The review items of #77 SHALL be done: ADR 017 SHALL list the difficulty codes `n`, `m` and `h`, and the
  `match-refused` branch of `app.ts` SHALL have a direct test (the error log and the `lobby.match-refused` span event).
- **UPK-10** — The review items of #81 SHALL be done in the acceptance support:
  - `openSiteFor` SHALL fail with a message naming the missing account when it has no `accountId`;
  - the traced stack's retry on a taken port SHALL reuse the telemetry site instead of rebuilding it;
  - the game-name drift test SHALL cover every activity the game-name module issues, not only `pvp`.
- **UPK-11** — Every Dependabot PR open at kickoff (#13–#18, #36, #38, #39, #42, #78) SHALL end merged-by-equivalent or
  closed with its reason. The bumps SHALL land on this branch grouped as in `dependabot.yml`, each group with the gates
  green (`pnpm check` families named in tasks.md). A bump that cannot go green in two attempts, or that touches the
  release flow, SHALL be deferred with a written reason in `decisions.md`, and its PR closed with that reason.

## Sources

| ID     | Source                                                                                                     |
| ------ | ---------------------------------------------------------------------------------------------------------- |
| UPK-01 | ADR 009, ADR 020; agent post-close item b (`sse.rs` hand-written `StageChanged`); `ARL-01`                 |
| UPK-02 | F1 post-close "API"; FR-05; AD-032 (sliding window), `shared-kernel/sliding-window.ts`; ADR 006 (no Redis) |
| UPK-03 | F1 review and security review of #52 (low): per-account limit on the ready-check routes; FR-12; NFR-06     |
| UPK-04 | Orchestrator backlog (`stream-projection.ts`); design.md § Platform, stream projection                     |
| UPK-05 | Orchestrator backlog (nightly report); NGT-04, NGT-05 of `nightly-report`; NFR-14                          |
| UPK-06 | Orchestrator backlog (load job); ADR 035; NGT-08                                                           |
| UPK-07 | #80 review (`F1/post-close.md` "Site"); FR-09, NFR-13; `QUE-15`                                            |
| UPK-08 | Orchestrator backlog; OCP-02 (`ocr-protection`); `report.mjs` `readingModulesFrom`                         |
| UPK-09 | #77 review (`F1/post-close.md` "API"); ADR 017; FR-14; NFR-09                                              |
| UPK-10 | #81 review (`F1/post-close.md` "CI and harness"); `tests/acceptance/support/{stack,ports}.ts`              |
| UPK-11 | F2 brief exit criterion "Upkeep"; `F1/post-close.md` "CI and harness"; `.github/dependabot.yml`; ADR 029   |

## Requirement Traceability

| Requirement ID | Story          | Proof                                                                                           |
| -------------- | -------------- | ----------------------------------------------------------------------------------------------- |
| UPK-01         | Generated type | Rust unit tests (adapters) + `xtask` `contracts_are_current` test                               |
| UPK-02         | Runaway client | API unit test of the limiter + API integration + acceptance `@UPK-02`                           |
| UPK-03         | Runaway client | API unit test of the limiter + API integration + acceptance `@UPK-03`                           |
| UPK-04         | Stream         | `stream-projection.test.ts` (order, and concurrency with a gated lookup)                        |
| UPK-05         | Nightly        | `scripts/test/nightly-report.test.mjs`                                                          |
| UPK-06         | Nightly        | `scripts/test/load-scripts.test.mjs` (the skip rule) + `scripts/test/nightly-workflow.test.mjs` |
| UPK-07         | Locked label   | acceptance `@UPK-07` (Playwright bounding boxes); the CSS-reading unit test is removed          |
| UPK-08         | Nightly        | `scripts/test/nightly-report.test.mjs` reading the committed file                               |
| UPK-09         | Review items   | API unit test of `app.ts`; ADR 017 text checked by the docs link check                          |
| UPK-10         | Review items   | acceptance support unit tests (`ports.test.ts`, `stack.test.ts`, drift test)                    |
| UPK-11         | Dependabot     | `pnpm check` per group; the PR list (every PR closed, reasons in `decisions.md`)                |

## Decisions (conservative defaults)

- **"Per session" is keyed by the account.** The session guard does not expose a session id, and a person may hold
  several sessions; the account is the stricter key, adds no schema and needs no new column. An agent token is keyed by
  the account it belongs to, so the agent and the site share the ready-check window.
- **The window lives in memory, in the one API instance** (ADR 006, no Redis). A restart resets it; that is acceptable
  for a hardening limit, not a quota. 60 requests per minute is about 20 times what the site and the agent send in
  normal use (one read on load and one on each stream reconnect).
- **429 is added to the three routes' documented responses**, so `openapi.json` is regenerated and committed (rule 2).
  The ready-check answer routes keep their idempotent behaviour; the limit counts every request, allowed or refused.
- **UPK-02, UPK-03 and UPK-07 are the only acceptance scenarios.** The rest is CI, refactor or test infrastructure,
  proved by the unit and contract tests named in the table above, and carries `# not-scenario:` lines in
  `acceptance.feature` (ADR 023).
- **Dependabot grouping.** One task per group of `dependabot.yml`, on this branch, so a red group does not block the
  others: (1) actions used by CI and the nightly (`upload-artifact` 7, `download-artifact` 8, `github-script` 9);
  (2) npm minor and patch (`import-in-the-middle`, `instrumentation-pg`, the dev-tooling group); (3) OpenTelemetry
  (`exporter-metrics-otlp-http` 0.301); (4) ESLint majors; (5) Playwright with `playwright-bdd` as a pair (ADR 023).
- **Closed with a reason, not bumped**: `tauri-apps/tauri-action` 1.0.0 (#14) and `googleapis/release-please-action`
  5.0.0 (#15). Both change the release flow, which only a real release proves (lessons: "Proofs only possible on the
  next real release"), and `agent-release` owns it. The same task closes #15's Node 20 warning with it. The reason goes in
  `decisions.md` and in the PR comment when the orchestrator closes them.
- **Dependabot PRs are closed by the orchestrator after this feature merges**, naming the upkeep PR; the worker does not
  close PRs. `pnpm/action-setup` 6 and `actions/setup-node` 7 have branches but no open PR and are already pinned in
  the workflows; nothing to do.
- **Not included, written for the review**: the ClockScheduler next-due short-circuit (performance only, no observable
  defect), the load harness "rooms" reading 0 and the egress regression (`stream-egress`), the site-stream reconnect
  investigation and the Dismiss persistence (`agent-room-lifecycle`, ARL-05 and ARL-06), SignPath, and the preview
  redirect alias (`delivery-platform`).
