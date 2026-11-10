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
- [ ] T5 — Agent domain: `characters.rs` with `Card` and the title table of CHR-07 (classic SC Sir/Dame, Lord/Lady,
      Baron/Baroness; classic HC Count/Countess, Duke/Duchess, King/Queen; expansion SC Slayer, Champion,
      Patriarch/Matriarch; expansion HC Destroyer, Conqueror, Guardian; no title → Normal), unit tests for every title
      — gate: `cd apps/agent/src-tauri && cargo nextest run -p d2rmm-agent-domain --lib`
- [ ] T6 — Agent core: ports `FrameSource` and `ConsentStore`, the `watch_screen` loop of `design.md` (1 s tick; no
      capture without consent or without the game running; shared current screen read by `beat`, which sends one
      immediate heartbeat on a screen change; posts characters only when the card set changed), gateway method
      `post_characters` with its HTTP adapter, span `agent.vision.read-characters` without names; unit tests with
      fakes for CHR-01, CHR-02 and the posting rule — gate:
      `cd apps/agent/src-tauri && cargo nextest run -p d2rmm-agent-core --lib && cargo nextest run -p d2rmm-agent-adapters`
- [ ] T7 — Agent window and app crate: consent stored in the local settings file, Tauri commands `get_consent` /
      `set_consent`, `ConsentView` (en + pt-BR, keyboard), and `src/adapters/window_capture.rs` (`PrintWindow` with
      `PW_RENDERFULLCONTENT` on the D2R process's top-level window, client area only, `None` when minimized or not
      found) with unit tests on the pure parts (client-area rectangle, BGRA → RGBA) — gate:
      `pnpm --filter @d2rmm/agent exec vitest run && pnpm --filter @d2rmm/agent lint && cd apps/agent/src-tauri && cargo clippy --all-targets -- -D warnings && cargo nextest run`

## Batch 2 — starts when the maintainer's screenshots are in `apps/agent/fixtures/characters/`

- [ ] T8 — Reading regions per fixture resolution in `vision.rs`, the screen classifier (CHR-04) and the card parser
      (CHR-06, CHR-08: English and Portuguese dictionaries, diacritic-insensitive), unit tests on the sidecar text of
      every fixture — gate: `cd apps/agent/src-tauri && cargo nextest run -p d2rmm-agent-domain --lib && cargo nextest run -p d2rmm-agent-core --lib`
- [ ] T9 — Windows OCR on the real fixtures: a Windows-only test that reads every fixture and matches its `.txt`
      (runs in the Windows CI job) — gate: CI job `agent (windows)` green on the branch
- [ ] T10 — Headless example: `--consent`, stdin `consent on|off` and `show <png>`, sidecar `<png>.json` per region;
      acceptance steps for every step of `acceptance.feature` in `tests/acceptance/steps/characters.steps.ts` — gate:
      `pnpm exec turbo run test:acceptance -- --grep @CHR-`
- [ ] T11 — Whole-repo sensors on the branch — gate:
      `pnpm typecheck && pnpm lint && pnpm arch && pnpm specs:check && cd apps/agent/src-tauri && cargo clippy --all-targets -- -D warnings`
