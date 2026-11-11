# Journeys end to end — Tasks

Spec: `spec.md` · Scenarios: `acceptance.feature` · Branch: `feat/F1-journeys-e2e` → `phase/F1` (last feature of F1)

Placement (no design.md, Medium): test code under `tests/acceptance/` (steps, support), the load journey under
`scripts/load/`, CSS, markup and locale strings of the site where a screen fails a check. No new route, contract or
agent capability. Rules: `acceptance.feature` is not edited; no scenario, test or sensor weakened; an accessibility
violation is fixed in the screen, never excluded; a gap that is not CSS, markup or a locale string is recorded as a
blocker on the feature that owns it; never commit a game screenshot (the Party fixtures are drawn).

## Batch 1

- [x] T1 — The scenario checker accepts the PRD journey tags `@J<n>` as foreign IDs (`scripts/lib/acceptance.mjs`,
      exact pattern `^@J\d+$`), with a harness test for an accepted `@J1` and a refused `@J1a` — gate:
      `pnpm test:harness && node scripts/acceptance-check.mjs journeys-e2e`
- [x] T2 — JRN-08: `theme.test.ts` checks the `gold-dim` and `bad` button borders and their hover states against AA
      (3:1 for boundaries), and `.sr-only` gets `margin: -1px; padding: 0` — gate:
      `pnpm --filter @d2rmm/web exec vitest run && pnpm --filter @d2rmm/web lint`
- [x] T3 — JRN-07 (unit half): a test that the pt-BR catalogue holds exactly the keys of the English one, for the site
      and the agent window — gate: `pnpm --filter @d2rmm/web exec vitest run && pnpm --filter @d2rmm/agent exec vitest run`
- [x] T4 — JRN-05 and JRN-07: `@axe-core/playwright` in `tests/acceptance`; a step that reaches each F1 screen by its
      name (signed out, signed in home, pairing, characters, queue panel, searching, ready-check overlay, room panel,
      revoke agent); the scan with tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa` and no rule disabled; the pt-BR check
      (no translation key shown, no English catalogue string shown that differs from its pt-BR value); fix every
      violation in the screen — gate: `pnpm exec turbo run test:acceptance -- --grep "@JRN-05|@JRN-07"`
- [x] T5 — JRN-01 and JRN-03: the J1 steps (sign-in through the fake Battle.net server, agents paired and registering
      characters, PvP queue, accept on the site and by the agent's hotkey, room with host, `mmpvph-` name (ADR 017) and "No
      password", host's and member's Party readings), each stage on both pages within 2 s of the observation request
      on the real clock — gate: `pnpm exec turbo run test:acceptance -- --grep @JRN-01`
- [x] T6 — JRN-06: J1's site steps by keyboard alone with visible focus on every control reached, and the copied game
      name equal to the room's (clipboard permission granted to the browser context) — gate:
      `pnpm exec turbo run test:acceptance -- --grep @JRN-06`

## Batch 2

- [x] T7 — JRN-02 and JRN-03: the J2 steps with eight players (the host and one member on browser pages, six holding
      the site stream as stream clients), a teleporter and a BO, the group of eight, every accept, the teleporter as
      host, all eight Party readings to Active, the next run, the next name of the sequence on every site and agent within 2 s, and
      run 2 Active — gate: `pnpm exec turbo run test:acceptance -- --grep @JRN-02`
- [x] T8 — JRN-04: the k6 journey drives the real journey (queue join, ready-check accept by the agent token, room
      assignment, host and member observations to `active`) for ≥ 100 players; the existing load unit tests and the
      smoke profile pass — gate: `pnpm test:harness && pnpm test:load:smoke`
- [ ] T9 — The whole acceptance suite, the traced scenarios alone, then the sensors — gate:
      `pnpm exec turbo run test:acceptance -- --grep-invert @OBS- && pnpm exec turbo run test:acceptance -- --grep @OBS- --workers=1 && pnpm typecheck && pnpm lint && pnpm arch && pnpm specs:check`

The full load run (`pnpm test:load`, NFR-14) is the phase review's proof, run once by the orchestrator on `phase/F1`.
