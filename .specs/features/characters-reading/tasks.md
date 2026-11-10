# Characters read from the screen — Tasks

Spec: `spec.md` · Design: `../characters/design.md` (Agent rows) · Branch: `feat/F1-characters-reading` → `phase/F1`,
created from `phase/F1` once `characters` has merged. Starts when the screenshots are in
`apps/agent/fixtures/characters/`.

## Batch 1

- [ ] T1 — Reading regions per fixture resolution in `vision.rs`, the screen classifier (CHR-04) and the card parser
      (CHR-06, CHR-08: English and Portuguese dictionaries, diacritic-insensitive), unit tests on the sidecar text of
      every fixture — gate:
      `cd apps/agent/src-tauri && cargo nextest run -p d2rmm-agent-domain --lib && cargo nextest run -p d2rmm-agent-core --lib`
- [ ] T2 — Windows OCR on the real fixtures: a Windows-only test that reads every fixture and matches its `.txt` (runs
      in the Windows CI job) — gate: CI job `agent` green on the branch
- [ ] T3 — Headless example: `--consent`, stdin `consent on|off` and `show <png>`, sidecar `<png>.json` per region;
      acceptance steps for every step of `acceptance.feature` — gate:
      `pnpm exec turbo run test:acceptance -- --grep "@CHR-(04|06|15)"`
- [ ] T4 — Whole-repo sensors — gate:
      `pnpm typecheck && pnpm lint && pnpm arch && pnpm specs:check && cd apps/agent/src-tauri && cargo clippy --all-targets -- -D warnings`
