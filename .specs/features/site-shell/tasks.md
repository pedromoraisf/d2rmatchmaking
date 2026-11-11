# Site shell from the prototype — Tasks

Spec: `spec.md` · Scenarios: `acceptance.feature` · Branch: `feat/F1-site-shell` → `phase/F1`, from `phase/F1` after
`characters` merged. The prototype's HTML is given to the worker by the orchestrator (it is not committed).

## Batch 1

- [x] T1 — Theme: `apps/web/src/app/theme.css` with the prototype's tokens (colours, fonts, panel, button, tag, focus
      styles) adjusted for AA, imported once in `main.tsx`; fonts link in `index.html`; a unit test that computes the
      contrast of every text token on its surface token (≥ 4.5:1, or ≥ 3:1 for tokens used only for large text and UI
      borders) — gate: `pnpm --filter @d2rmm/web exec vitest run src/app`
- [x] T2 — Header and layout: `Layout` becomes the prototype's sticky header (brand, `nav` with existing sections,
      agent state pill, Battle.net name with sign-out, or the sign-in controls), the two-column home with the agent
      panel in the status column, the footer notice and agent download; en + pt-BR strings; component tests — gate:
      `pnpm --filter @d2rmm/web exec vitest run && pnpm --filter @d2rmm/web lint`
- [x] T3 — Restyle the existing components to the prototype (sign-in, pairing form, presence/agent panel, revoke,
      character cards with difficulty tags, room panel, start-test-match), keeping their visible texts and roles so
      the existing acceptance scenarios still pass; component tests — gate:
      `pnpm --filter @d2rmm/web exec vitest run && pnpm --filter @d2rmm/web lint`
- [x] T4 — Acceptance steps in `tests/acceptance/steps/site-shell.steps.ts` for every step of `acceptance.feature`,
      reusing existing steps — gate: `pnpm exec turbo run test:acceptance -- --grep @SHL-`
- [x] T5 — The existing site scenarios still pass on the new markup, and the whole-repo sensors — gate:
      `pnpm exec turbo run test:acceptance -- --grep "@AWS-|@IDB-|@CHR-" && pnpm typecheck && pnpm lint && pnpm arch && pnpm specs:check`
