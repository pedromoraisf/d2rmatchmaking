# Agent trust — Tasks

Spec: `spec.md` · Scenarios: `acceptance.feature` · Branch: `feat/F2-agent-trust` → `phase/F2`

Placement (no design.md, Medium). No new route, contract, migration or Rust crate: the work is tests, source rules, two
test controls for the acceptance stack and one span change.

Where each part goes:

- API (AGT-01, AGT-02): a route-inventory test beside the guards (`apps/api/src/platform/http/`) and an integration test
  that lists every route the app registers with the guard it uses (Fastify `onRoute`). Revocation tests live with the
  agents module's integration tests.
- Agent (AGT-03 to AGT-06): unit tests in `core` and `adapters` beside the code they pin; the rules that must fail on a
  future change go in `scripts/test/agent-source-rules.test.mjs`. The existing rules there (clippy disallow lists,
  `deny.toml` bans) are not touched.
- Span (AGT-07): `core/src/party.rs::apply_reading` and its span test (`READ_SPAN`, `only(...)`). Only the span changes.
- Acceptance steps: `tests/acceptance/steps/agent-trust.steps.ts`. The headless agent is the real core, and
  `support/agent-proxy.ts` records its requests (use it for AGT-05).

Rules:

- Do not touch `look_of`, `read_panel_field`, thresholds, boxes, glyph tables or anchors (AGT-07 is span-only; if a
  reading-modules guard lists `party.rs`, record the span-only reason in the PR).
- The agent sends no input to the game (ADR 010). `acceptance.feature` is never edited, and no test is weakened.
- No task adds a route or a crate; if one must, stop and return it (the lessons gates for routes and crates then apply).
- If the acceptance stack has no way to inject a stream event (AGT-04) or to withdraw consent (AGT-06), return the task
  with the reason instead of weakening the scenario: the orchestrator moves it to a `not-scenario` line.
- In a fresh checkout run `pnpm --filter @d2rmm/agent build` once before the first push (lessons).

## Batch 1

- [x] T1 — API: a test that lists every route the app registers with its guards and fails when a route outside the eight
      of AGT-01 uses the agent guard, plus a test that the agent token is refused on a sample of site routes and the
      session cookie alone on every agent route. Gate:
      `pnpm --filter @d2rmm/api exec vitest run && pnpm --filter @d2rmm/api test:integration`
- [x] T2 — API: revoking, and pairing a new agent, makes the old token answer `401` on every agent route and ends its open
      stream; the token cache holds nothing for it (AGT-02). Gate:
      `pnpm --filter @d2rmm/api exec vitest run && pnpm --filter @d2rmm/api test:integration`
- [x] T3 — Agent: the token never leaks (AGT-03). Unit tests that `Secret`'s `Debug` and `Display` hide the value, that a
      failed request's error text and spans hold no token, and that the gateway sends `Authorization` only to the
      configured API base; a source rule that the token's `expose()` is called only by the gateway and the store. Gate:
      `cargo nextest run --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent-core -p d2rmm-agent-adapters --lib && node --test scripts/test/agent-source-rules.test.mjs`
- [x] T4 — Agent: data only (AGT-04). Parser tests: an unknown event type, an unknown field, a malformed frame and an
      oversized frame change nothing; a source rule that lists the `StreamItem` variants and fails on a new one. Gate:
      `cargo nextest run --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent-core -p d2rmm-agent-adapters --lib && node --test scripts/test/agent-source-rules.test.mjs`
- [x] T5 — Agent: structured data only (AGT-05). A unit test per request body (heartbeat, observation, characters,
      telemetry) that its keys equal the contract's; a source rule that `adapters/src/http` imports no frame, pixel or
      capture type and has no multipart or binary upload. Gate:
      `cargo nextest run --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent-adapters --lib && node --test scripts/test/agent-source-rules.test.mjs`
- [x] T6 — Agent: no capture without consent or without the game, and consent withdrawn stops capture within one tick
      (AGT-06). Core tests with the fake frame source counting its calls; confirm the existing window-capture source
      rules still cover "the game window only" and cite them in the test comment. Gate:
      `cargo nextest run --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent-core --lib && node --test scripts/test/agent-source-rules.test.mjs`
- [x] T7 — Agent: the Party span records `panel_open` and `field` (one of `notRead`, `empty`, `masked`, `text`), with no
      text and no name; the span test pins the four fields and fails on any other (AGT-07, post-close item j). Gate:
      `cargo nextest run --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent-core --lib && cargo clippy --manifest-path apps/agent/src-tauri/Cargo.toml --all-targets -- -D warnings`

## Batch 2

- [x] T8 — Acceptance steps for `@AGT-01` and `@AGT-02`: the agent asks for an action on the site with its token, the
      session cookie alone calls each agent route, and the revoked or replaced agent calls each agent route (reuse the
      steps of `agents.steps.ts`; the stream-closed step exists for IDB-08). Gate:
      `pnpm exec turbo run test:acceptance -- --grep "@AGT-01|@AGT-02"`
- [x] T9 — Acceptance steps for `@AGT-04`, `@AGT-05` and `@AGT-06`: an unknown stream event reaches the headless agent
      through the stack's test control, the recording proxy shows each request's keys and no image data, and the
      headless agent runs with and without consent. Gate:
      `pnpm exec turbo run test:acceptance -- --grep "@AGT-04|@AGT-05|@AGT-06"`
- [x] T10 — Close the feature: every scenario of the feature passes together, and the spec checks are green. Gate:
      `pnpm exec turbo run test:acceptance -- --grep @AGT- && pnpm acceptance:check && pnpm specs:check`
