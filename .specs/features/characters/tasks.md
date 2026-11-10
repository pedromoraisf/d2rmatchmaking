# Characters read by the agent — Tasks

Spec: `spec.md` (CHR-01 … CHR-14) · Design: `design.md` · Scenarios: `acceptance.feature` · Branch:
`feat/F1-characters` → `phase/F1`

Rules for the worker:

- Layers (AGENTS.md rule 1, ADR 027): the agent domain crate gets no I/O, clock or randomness; capture and OCR live in
  the app crate's `src/adapters/`; the API's Identity module owns characters and reads the agent's account only through
  `AgentsPort`.
- Contracts first (rule 2): a schema change ends with `pnpm contracts:openapi` and `cargo run -p xtask -- contracts`
  (in `apps/agent/src-tauri`), and the regenerated files committed in the same task.
- ADR 010: capture only the D2R window, only after consent, nothing captured leaves the process. `unsafe` only in
  `window_capture.rs` and `windows_ocr.rs`.
- Rust gates run from `apps/agent/src-tauri`; every other gate from the repository root. `acceptance.feature` is not
  edited. Tests are never weakened. One Conventional Commit per task (`feat(identity): …`, `feat(agent): …`,
  `feat(web): …`, `feat(contracts): …`, `test(acceptance): …`).

## Batch 1 — no screenshots needed

- [x] T1 — Contracts of `design.md § Contracts` with unit tests (the name rule, level bounds, the three allowed
      difficulty lists, 1 to 24 unique names), the `characters.updated` site stream event; regenerate OpenAPI, AsyncAPI
      and the Rust types — gate:
      `pnpm --filter @d2rmm/contracts exec vitest run && pnpm contracts:openapi && (cd apps/agent/src-tauri && cargo run -q -p xtask -- contracts && cargo nextest run -p d2rmm-agent-adapters)`
- [x] T2 — API domain and application: `domain/character/character.ts`, port `CharacterRepository`, use cases
      `recordCharacters` (upsert by account + name, newest reading wins, one unit of work, `CharactersRecorded` in the
      outbox) and `listMyCharacters`, in-memory fakes, unit tests for every rule of CHR-09 and CHR-10 — gate:
      `pnpm --filter @d2rmm/api exec vitest run src/modules/identity/domain src/modules/identity/application`
- [x] T3 — API persistence and routes: migration `identity.characters` (next free number after the existing ones),
      Postgres repository, `POST /v1/me/characters` (agent token guard → 204 / 400 / 401) and `GET /v1/me/characters`
      (session guard), spans `identity.record-characters` / `identity.list-characters` with counts only (CHR-13),
      stream projection `CharactersRecorded` → `characters.updated`; add the migration to `migrate.int.test.ts`;
      regenerate the OpenAPI — gate:
      `pnpm --filter @d2rmm/api exec vitest run src/platform/stream-projection.test.ts && pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/main/__tests__/migrate.int.test.ts src/main/__tests__/identity-routes.int.test.ts && pnpm contracts:openapi && git diff --exit-code packages/contracts/openapi.json packages/contracts/asyncapi.json`
- [x] T4 — Site: `CharacterList` (list, empty-state message, read time), labels for class, ladder, era, difficulties and
      the two new screens, refetch on `characters.updated`, en + pt-BR, component tests including keyboard focus —
      gate: `pnpm --filter @d2rmm/web exec vitest run && pnpm --filter @d2rmm/web lint`
- [x] T5 — Agent domain: `characters.rs` with `Card` and the title table of CHR-07 (classic SC Sir/Dame, Lord/Lady,
      Baron/Baroness; classic HC Count/Countess, Duke/Duchess, King/Queen; expansion SC Slayer, Champion,
      Patriarch/Matriarch; expansion HC Destroyer, Conqueror, Guardian; no title → Normal), unit tests for every title
      — gate: `cd apps/agent/src-tauri && cargo nextest run -p d2rmm-agent-domain --lib`
- [x] T6 — Agent core: ports `FrameSource` and `ConsentStore`, the `watch_screen` loop of `design.md` (1 s tick; no
      capture without consent or without the game running; shared current screen read by `beat`, which sends one
      immediate heartbeat on a screen change; posts characters only when the card set changed), gateway method
      `post_characters` with its HTTP adapter, span `agent.vision.read-characters` without names; unit tests with
      fakes for CHR-01, CHR-02 and the posting rule — gate:
      `cd apps/agent/src-tauri && cargo nextest run -p d2rmm-agent-core --lib && cargo nextest run -p d2rmm-agent-adapters`
- [x] T7 — Agent window and app crate: consent stored in the local settings file, Tauri commands `get_consent` /
      `set_consent`, `ConsentView` (en + pt-BR, keyboard), and `src/adapters/window_capture.rs` (`PrintWindow` with
      `PW_RENDERFULLCONTENT` on the D2R process's top-level window, client area only, `None` when minimized or not
      found) with unit tests on the pure parts (client-area rectangle, BGRA → RGBA) — gate:
      `pnpm --filter @d2rmm/agent exec vitest run && pnpm --filter @d2rmm/agent lint && cd apps/agent/src-tauri && cargo clippy --all-targets -- -D warnings && cargo nextest run`

## Batch 1b — catch up with phase/F1 (identity-bnet merged)

- [x] T12 — Merge `origin/phase/F1` into this branch (a merge commit, never a rebase or force push), resolving the
      conflicts by keeping both sides; rename the migration `0005_identity_characters` to `0006_identity_characters`
      (identity-bnet's `0005_battletag_not_unique` ran first on staging) in the file name, `migrator.ts` and the
      migration lists of `migrate.int.test.ts` and `migrator.int.test.ts`; regenerate the OpenAPI — gate:
      `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/main/__tests__/migrate.int.test.ts src/platform/postgres/migrator.int.test.ts src/main/__tests__/identity-routes.int.test.ts && pnpm contracts:openapi && git diff --exit-code packages/contracts/openapi.json packages/contracts/asyncapi.json && pnpm typecheck && pnpm lint && pnpm arch`

## Batch 2 — after the split (maintainer, 2026-11-10)

The screen reading (old T8 regions/classifier/parser, T9 Windows OCR on fixtures, T10 headless reading) moved to
`.specs/features/characters-reading/`, which waits for the screenshots.

- [x] T8 — Acceptance steps in `tests/acceptance/steps/characters.steps.ts` for every step of `acceptance.feature`: the
      agent client sends heartbeats with the new screens and `POST /v1/me/characters` with its token; reuse the
      existing sign-in, pairing, heartbeat and stream steps (`agents.steps.ts`, `identity.steps.ts`, `site.steps.ts`,
      `support/agent-client.ts`, `support/world.ts`) and do not add near-duplicates of existing phrasings — gate:
      `pnpm exec turbo run test:acceptance -- --grep @CHR-`
- [x] T9 — Whole-repo sensors on the branch — gate:
      `pnpm typecheck && pnpm lint && pnpm arch && pnpm specs:check && cd apps/agent/src-tauri && cargo clippy --all-targets -- -D warnings`

## Batch 3 — review fixes (PR #44)

- [ ] T10 — Tighten the agent's FFI sensor (both reviews): in `scripts/test/agent-source-rules.test.mjs`, the
      `window_capture.rs` entry lists the exact symbols the file uses (as the `toolhelp.rs` entry does) instead of whole
      module paths; add a test that a `PostMessageW`, `SendMessageW`, `SetWindowsHookExW`, `BitBlt` or `GetPixel` use in
      that file fails the rule; add those and `SetWindowsHookExA`, `SetWinEventHook`, `StretchBlt`, `GetWindowDC` to
      `disallowed-methods` in every agent `clippy.toml`; fix the "only two adapters may allow unsafe" wording in
      `window_capture.rs` and `design.md` (three adapters) — gate:
      `pnpm test:harness && cd apps/agent/src-tauri && cargo clippy --all-targets -- -D warnings && node ../../../scripts/agent/win-check.mjs`
- [ ] T11 — Bound the stored characters (security finding 2): an account holds at most 60 characters; a batch that
      would take it past 60 new names answers 400 `too-many-characters` and stores nothing; application unit test and a
      route integration test — gate:
      `pnpm --filter @d2rmm/api exec vitest run src/modules/identity && pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/main/__tests__/identity-routes.int.test.ts`
- [ ] T12 — Character names are case-insensitive, as in D2R (security finding 3): the contract's unique-name check
      compares lowercased names; a new migration `0007_characters_name_ci` replaces the `(account_id, name)` unique
      constraint with a unique index on `(account_id, lower(name))`; the upsert matches by lowercased name and stores the
      newest spelling; tests for `Abc` then `abc` (one row) and for a batch with both (400) — gate:
      `pnpm --filter @d2rmm/contracts exec vitest run && pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/main/__tests__/migrate.int.test.ts src/platform/postgres/migrator.int.test.ts src/main/__tests__/identity-routes.int.test.ts src/modules/identity/adapters/postgres && pnpm contracts:openapi && git diff --exit-code packages/contracts/openapi.json packages/contracts/asyncapi.json`
- [ ] T13 — Window choice and device context (security findings 4, 5): among the visible top-level windows of the D2R
      processes, capture the one with the largest client area; take the template DC from `GetDC(window)` (released on
      every path) instead of the screen's `GetDC(None)`, and return `None` on a null handle; unit tests on the pure
      window-choice function — gate:
      `cd apps/agent/src-tauri && cargo nextest run && cargo clippy --all-targets -- -D warnings && node ../../../scripts/agent/win-check.mjs`
- [ ] T14 — The shared acceptance step "the API answers <status>" throws a clear error when the scenario made no
      request (neither the relay answer nor `world.last`) — gate:
      `pnpm exec turbo run test:acceptance -- --grep "@CHR-|@OBS-|@AWS-|@IDB-"`
