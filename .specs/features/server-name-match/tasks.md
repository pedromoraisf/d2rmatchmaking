# Server name match — Tasks

Spec: `spec.md` · Design: `design.md` · Scenarios: `acceptance.feature` · Branch: `feat/F2-server-name-match` → `phase/F2`

Order: the contract and the API half (batch 1) do not need `game-name-reading`. The agent half (batch 2) starts after
`game-name-reading` is merged into `phase/F2`: T7 merges it in and checks that `domain/src/chat.rs` and
`core/src/chat_step.rs` exist. If they do not, return T7 with that reason.

Rules:

- No reading module is edited (rule 14). `chat_post.rs` is a new file; it only calls what `game-name-reading` exposes.
- A read player name is never stored, logged, put in a span, a metric label, an event or an error (SNM-04). Tests use a
  distinctive name (`Zzyzx`) and scan for it.
- Every task that touches the observation route, its use case or `record-characters` runs the whole API integration
  suite (`openapi.int.test.ts` pins every route). If Docker Hub answers 429, retry with backoff; if the gate still
  cannot run, write "not run here" in the commit and the report.
- The contract task regenerates and commits `openapi.json`, `asyncapi.json`, the JSON schemas and `generated.rs`.
- `acceptance.feature` is never edited; a step that cannot be built is returned with the reason.
- No mutation in a gate. No screenshot is ever committed.
- In a fresh checkout run `pnpm --filter @d2rmm/agent build` once before the first push (lessons).

## Batch 1 — contract and API

- [x] T1 — Contract: document `value` per type, export `PlayerNameValue` (SNM-01), regenerate and commit `openapi.json`,
      `asyncapi.json`, the JSON schemas and `generated.rs`. Contract tests for the schema. Gate:
      `pnpm --filter @d2rmm/contracts test && pnpm contracts:check && cargo run --manifest-path apps/agent/src-tauri/Cargo.toml -p xtask -- contracts && cargo nextest run --manifest-path apps/agent/src-tauri/Cargo.toml -p xtask --test contracts_are_current`
- [x] T2 — API shared kernel: `matchCharacterName` (SNM-02) with a unit test for every fold of the agent's `glyph_key`,
      each of `g`, `e`, `b` for `o`, uppercase and lowercase, the reverse direction refused, ambiguity, length. Gate:
      `pnpm --filter @d2rmm/api exec vitest run src/shared-kernel && pnpm --filter @d2rmm/api lint`
- [x] T3 — Identity: reconcile a misread card to the stored character it stands for, with the guards of SNM-07 and the
      `d2r.characters.reconciled` count; `storedNames` carries class, mode and level. Unit tests with the in-memory
      repository and an integration test on Postgres. Gate:
      `pnpm --filter @d2rmm/api exec vitest run && pnpm --filter @d2rmm/api test:integration`
- [x] T4 — Lobby Room: refuse a player observation with a value outside the reading rule; match the others to the room's
      members through the new `MemberNames` port (implemented in `main/` over Identity) and store only the join order
      (SNM-03, SNM-08); `d2r.observation.match` on the span. Unit tests with fakes (matched, none, ambiguous, repeat,
      non-member, stage unchanged, no outbox row) and an integration test. Gate:
      `pnpm --filter @d2rmm/api exec vitest run && pnpm --filter @d2rmm/api test:integration`
- [x] T5 — Privacy test (SNM-04, API half): a distinctive name sent through the observation and the characters routes
      appears in no span, span event, metric label, log line, outbox row, table row or response. Use the in-memory
      exporter, the log sink and a scan of the new rows; scan every attribute key, not only the ones the spec names
      (lessons). Done for the characters path (harness `name-leak-scan.ts`); the observation path joins it with T4. Gate: `pnpm --filter @d2rmm/api exec vitest run && pnpm --filter @d2rmm/api test:integration`
- [x] T6 — Docs: write ADR 036 as **Proposed** (a chat name may leave the PC to be matched and dropped; matching on the
      API, not the agent), add the new spans and counters to `docs/engineering/telemetry.md`, and note the two player
      observations in `docs/domain/glossary.md`. Never write an `Accepted` or `Approved` line. Gate:
      `pnpm exec prettier --check docs && pnpm specs:check`

## Batch 2 — agent (after `game-name-reading` is merged)

- [ ] T7a — **[R14]** Name-carrying chat events. `ChatTracker::next` and `chat_step::look` drop the player name, so first pin
      both at the points to be touched with tests (values from the drawn chat fixtures), then, in one commit, add
      `ChatTracker::next_named -> Vec<(ChatEvent, String)>` (with `next` mapping over it) and `chat_step::look_named`.
      The existing behaviour stays identical: same events, same order, same already-seen logic. The real-print proof
      (`ocr-real`, `ocr-variations`, ratchet) runs in CI on the PR. Gate:
      `cargo nextest run --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent-domain -p d2rmm-agent-core --lib`
- [ ] T7 — `origin/phase/F2` already holds `ChatEvent` and the chat step (branch cut from it). Add `PlayerObservation`
      and its reading-rule check (`domain/src/player_observation.rs`, no generated types) to the agent's messages, the
      `ApiGateway::post_player_observation` port with its fake and adapter, and `player_observation_to_contract` to
      the adapters, validating the reading rule before a body is built (SNM-05, SNM-06). Unit tests on the body keys and on every refusal. Gate:
      `cargo nextest run --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent-core -p d2rmm-agent-adapters --lib && cargo clippy --manifest-path apps/agent/src-tauri/Cargo.toml --all-targets -- -D warnings`
- [ ] T8 — Agent core: `chat_post.rs` posts one observation per new joined or left event while an assignment is held for
      the current run, through a clock-injected 20-a-minute bucket, with the span and counter of the design (fixed
      words only). It does not use `post_observation::send` (it retries) or `confirm_run`, and never retries. Tests: no
      assignment, other run, line already posted, bad name, bucket full, post failed. Wire it in the screen loop
      (`watch_screen.rs`) through `chat_step::look_named`. Gate:
      `cargo nextest run --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent-core --lib && node --test scripts/test/agent-source-rules.test.mjs`
- [ ] T9 — Agent privacy rules: a unit test with the in-memory span subscriber that no span or counter of the chat post
      holds the name; extend the AGT-05 source rule so `chat_post.rs` and the adapters name no frame type and send no
      raw body; a fixture that the rule must reject. Gate:
      `cargo nextest run --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent-core --lib && node --test scripts/test/agent-source-rules.test.mjs`

## Batch 3 — acceptance

- [x] T10 — Acceptance steps for `@SNM-01`, `@SNM-02`, `@SNM-03`, `@SNM-04`, `@SNM-07` and `@SNM-08` (simulated agents;
      the room and characters come from the existing queue and room steps; reuse `agents.steps.ts` for "the API answers").
      Gate: `pnpm exec turbo run test:acceptance -- --grep "@SNM-01|@SNM-02|@SNM-03|@SNM-04|@SNM-07|@SNM-08"`
- [ ] T11 — First put the three scenarios of `@SNM-05` and `@SNM-06` back into `acceptance.feature` **verbatim from commit `f1f6c78`**
      (T10 left them out and gave each requirement a `not-scenario` line; delete those two lines). Then write the acceptance steps for `@SNM-05` and `@SNM-06` with the headless agent, the drawn chat fixture of
      `game-name-reading` (it draws "Bob": the step rewrites the sidecar line to "Hammer", as the Party steps do; if the
      headless example does not read the chat sidecar, stop and report) and the recording proxy (`support/agent-wire.ts`: add `@SNM-05 or @SNM-06` to its `Before`
      and `After` tags and to the headless cleanup tags). If the fixture does not exist, return the task. Then close the
      feature. Gate:
      `pnpm exec turbo run test:acceptance -- --grep @SNM- && pnpm acceptance:check && pnpm specs:check`
