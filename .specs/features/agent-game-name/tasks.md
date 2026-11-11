# Agent reads the game name — Tasks

Spec: `spec.md` · Design: `design.md` · Scenarios: `acceptance.feature` · Branch: `feat/F1-agent-game-name` → `phase/F1`

Rules: ADR 010 (pixels of the game window only, nothing captured leaves the process); the domain has no I/O; `unsafe`
only where `agent-source-rules.test.mjs` allows it; Rust gates from `apps/agent/src-tauri`; the maintainer's
screenshots are at `/private/tmp/claude-501/-Users-pedromoraisf-www-d2rmatchmaking/cd8375af-9732-521d-a5e8-10743a3481ae/scratchpad/prints-in/Prints D2RMM/`
(read-only; never committed unblurred).

## Batch 1

- [x] T1 — Domain `layout.rs` (relative regions, aspect-ratio range) and `language.rs` (pack type, English built in,
      parsed from JSON), unit tests at 1920×1033 and 1920×1080 and outside the range — gate:
      `cd apps/agent/src-tauri && cargo nextest run -p d2rmm-agent-domain --lib`
- [x] T2 — Domain `game_name_match.rs`: AGN-03 (trim, no case; before the last `-` `0`/`Ø`/`⊕` → `o`; after it
      `O`/`o`/`Ø`/`⊕` → `0`) and AGN-04 (masked), unit tests including `mmcowsh-1` vs `MMC⊕WSH-1`, `mmchaosn-10` vs
      `MMCHA⊕SN-1Ø`, `mmcowsh-10` vs `MMCOWSH-1O`, `mmcowsh-1` vs `mmcowsh-7` (no match), `xxxxxxxxx` (masked) — gate: `cd apps/agent/src-tauri && cargo nextest run -p d2rmm-agent-domain --lib`
- [x] T3 — Core: the Party step in `watch_screen` (AGN-01, AGN-03, AGN-05; once per run; "needs reveal" state), span of
      AGN-07; unit tests with fakes — gate:
      `cd apps/agent/src-tauri && cargo nextest run -p d2rmm-agent-core --lib && cargo nextest run -p d2rmm-agent-adapters`
- [x] T4 — App crate: the real Party reader on live frames with Windows OCR and the English pack resource, wired in
      `main.rs` (AGN-06); agent window hint (AGN-04, en + pt-BR) — gate:
      `pnpm --filter @d2rmm/agent exec vitest run && pnpm --filter @d2rmm/agent lint && cd apps/agent/src-tauri && cargo nextest run && cargo clippy --all-targets -- -D warnings && node ../../../scripts/agent/win-check.mjs`
- [x] T5 — Fixtures: `xtask draw-fixture party` (revealed name, masked, another name; JSON sidecars), and the
      maintainer's Party screenshots with the member rows blurred under `apps/agent/fixtures/party/`; a Windows-only
      test that reads the blurred screenshots' Game Name field with Windows OCR (`DUEL NK LOCKS`, masked) — gate:
      `cd apps/agent/src-tauri && cargo nextest run -p xtask && cargo nextest run && node ../../../scripts/agent/win-check.mjs`

## Batch 2

- [x] T6 — Headless example reads the drawn Party fixtures; acceptance steps for `acceptance.feature` — gate:
      `pnpm exec turbo run test:acceptance -- --grep @AGN-`
- [x] T7 — Whole-repo sensors — gate:
      `pnpm typecheck && pnpm lint && pnpm arch && pnpm specs:check && cd apps/agent/src-tauri && cargo clippy --all-targets -- -D warnings`

## Batch 3 — review fixes (PR #48)

- [x] T8 — Layout model (architecture finding 1): a `PanelRegion` declares its anchor (left, right or centre) and is
      resolved by scaling x, y, width and height with the client height relative to the 1033 reference (D2R scales its
      UI with the height), x measured from its anchor edge; the doc comment says exactly that; tests at 1920×1033,
      1920×1080, 2560×1440 and 1680×1050 assert the Party field's pixel box, not only that it lies inside the frame —
      gate: `cd apps/agent/src-tauri && cargo nextest run -p d2rmm-agent-domain --lib`
- [x] T9 — Party step (findings 2, 3): `look` returns before any OCR once the run has matched; OCR runs through
      `tokio::task::spawn_blocking`; the claim names the run (`claim(&RunKey)`) and refuses when the followed run
      differs; core unit tests for each — gate:
      `cd apps/agent/src-tauri && cargo nextest run -p d2rmm-agent-core --lib && cargo nextest run -p d2rmm-agent-adapters`
- [ ] T10 — `windows_ocr.rs` scaled sizes with `checked_mul` (security low); a `node:test` file for
      `scripts/agent/ocr-check.mjs`'s `folderProblems` and `nextestArgs` (finding 4) — gate:
      `pnpm test:harness && cd apps/agent/src-tauri && cargo clippy --all-targets -- -D warnings && node ../../../scripts/agent/win-check.mjs`
