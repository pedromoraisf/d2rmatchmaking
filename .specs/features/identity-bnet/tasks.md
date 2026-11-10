# Identity with Battle.net — Tasks

Spec: `spec.md` (IDB-01 … IDB-13) · Scenarios: `acceptance.feature` · Branch: `feat/F1-identity-bnet` → `phase/F1`

Rules for the worker:

- Layers (AGENTS.md rule 1): the OAuth HTTP calls live in `apps/api/src/modules/identity/adapters/bnet/`; the
  application sees only a `BattleNetOAuth` port. Only `main/` reads `BNET_*` settings (via `main/config.ts`).
- Contracts first (rule 2): every route or schema change ends with `pnpm contracts:openapi` and the regenerated
  `openapi.json` / `asyncapi.json` committed in the same task.
- Never print, log or commit a secret; the client secret, code, tokens, state, verifier and BattleTag never reach a
  log, a span attribute or an error body (IDB-11). Do not touch `.env*` files.
- `acceptance.feature` is not edited. Tests are never weakened or skipped.
- Each gate runs from the repository root. One Conventional Commit per task (`feat(identity): …`, `feat(agents): …`,
  `feat(web): …`, `test(acceptance): …`).

## Batch 1

- [x] T1 — Migration `0004_account_bnet_sub` (additive: nullable `bnet_sub text` with a unique index on
      `identity.accounts`), repository methods `findByBnetSub`, `insertBattleNetAccount`, `updateBattletag` on
      `AccountRepository`, and `delete(tokenHash)` on `SessionRepository` (Postgres + in-memory fakes); add the new
      migration to the list in `migrate.int.test.ts` — gate:
      `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/modules/identity/adapters/postgres/identity-repositories.int.test.ts src/main/__tests__/migrate.int.test.ts`
- [x] T2 — Domain and application: `newBattleNetAccount(id, sub, battletag)` and `displayNameOf(battletag)` in
      `domain/account.ts`; port `BattleNetOAuth` (`authorizeUrl({state, codeChallenge, redirectUri})`,
      `exchange({code, verifier, redirectUri}) → Result<{sub, battletag}, 'exchange-failed' | 'userinfo-failed'>`);
      use cases `signInWithBattleNet` (find by sub, create on first sign-in, update a changed BattleTag, open a 7-day
      session — IDB-02, IDB-03) and `signOut` (delete by token hash — IDB-05); unit tests with fakes for every branch —
      gate:
      `pnpm --filter @d2rmm/api exec vitest run src/modules/identity/domain src/modules/identity/application`
- [x] T3 — Pure OAuth state rules in `application/oauth-state.ts`: create a state (random `state`, PKCE verifier and
      S256 challenge from the injected `RandomSource`, expiry now + 10 min), encode it for the cookie, and
      `checkCallback(cookieValue, query, now) → Result<{code, verifier}, 'missing-state' | 'state-mismatch' |
'state-expired' | 'provider-error'>`; unit tests on every boundary (exactly 10 min, wrong state, missing cookie,
      malformed cookie, `error=access_denied`) — gate:
      `pnpm --filter @d2rmm/api exec vitest run src/modules/identity/application/oauth-state.test.ts`
- [x] T4 — Adapter `adapters/bnet/fetch-battle-net-oauth.ts` implementing `BattleNetOAuth` over an injected `fetch`
      and base URL: `<base>/authorize`, `POST <base>/token` (HTTP Basic client auth, `grant_type=authorization_code`,
      `code_verifier`), `GET <base>/userinfo` (Bearer) reading `sub` and `battletag`; unit tests with a stub `fetch`
      for success, non-2xx, malformed JSON and network error, asserting no secret, code or token in any returned error
      or thrown message (IDB-11) — gate:
      `pnpm --filter @d2rmm/api exec vitest run src/modules/identity/adapters/bnet`
- [x] T5 — Config and routes: `BNET_CLIENT_ID`, `BNET_CLIENT_SECRET`, `BNET_OAUTH_BASE_URL` (default
      `https://oauth.battle.net`; https, or http on a loopback host; never echoed in errors) in `main/config.ts` with
      tests; `GET /v1/auth/bnet/login` (302 + `__Host-d2rmm_oauth` cookie), `GET /v1/auth/bnet/callback` (session
      cookie + 302 to `<SITE_ORIGIN>/`, or 302 to `<SITE_ORIGIN>/?signin=failed`), both 404 when the credentials are
      unset (IDB-06); `POST /v1/auth/logout` (requireSession + requireSameOrigin, 204, expires the cookie);
      `/v1/config` gains `bnetSignIn: boolean`; spans `identity.bnet-login`, `identity.bnet-callback`,
      `identity.sign-out` with an `outcome` attribute only (IDB-12, unit-tested with an in-memory exporter); wire it in
      `main/app.ts`; regenerate and commit the OpenAPI — gate:
      `pnpm --filter @d2rmm/api exec vitest run src/main/config.test.ts && pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/main/__tests__/identity-routes.int.test.ts && pnpm contracts:openapi && git diff --exit-code packages/contracts/openapi.json packages/contracts/asyncapi.json`
- [x] T6 — Revoke (FR-04): use case `revokeAgent({accountId, agentId})` in the Agents application — revokes only the
      account's current, unrevoked agent and publishes `AgentRevoked` the way pairing a second agent does (AD-037), else
      `not-found` (IDB-08, IDB-09); route `DELETE /v1/agents/:id` (requireSession + requireSameOrigin; 204 or 404);
      span `agents.revoke`; unit tests and a route integration test proving the revoked token answers 401 on the next
      heartbeat; regenerate and commit the OpenAPI — gate:
      `pnpm --filter @d2rmm/api exec vitest run src/modules/agents/application && pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/main/__tests__/agents-routes.int.test.ts && pnpm contracts:openapi && git diff --exit-code packages/contracts/openapi.json packages/contracts/asyncapi.json`
- [x] T7 — Site: "Sign in with Battle.net" link to `/api/v1/auth/bnet/login` when `config.bnetSignIn` (next to the
      test sign-in on staging), the failure message when the URL has `?signin=failed` (then removed from the URL),
      a "Sign out" button, and a "Revoke agent" button with a confirmation step in the presence panel that returns
      to the pairing form; every string in `en` and `pt-BR` locale files; component tests for each state and for
      keyboard use — gate:
      `pnpm --filter @d2rmm/web exec vitest run src/features/identity src/features/agents && pnpm --filter @d2rmm/web lint`

## Batch 2

- [x] T8 — Unique-index fix (Batch 1 finding A): migration `0005_battletag_not_unique` (identity-bnet merges first;
      `characters` renumbers its migration after it) drops the unique constraint on
      `identity.accounts.battletag` and adds a unique index on `test_key` where it is not null, so a freed BattleTag
      re-used by another Battle.net account signs in (IDB-02) and test accounts stay unique by their key (IDB-07);
      `signInWithBattleNet` turns a unique violation on `bnet_sub` (two first sign-ins of one account at once) into
      reading the account that won, never a 500; integration tests for both cases — gate:
      `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/modules/identity/adapters/postgres/identity-repositories.int.test.ts src/main/__tests__/migrate.int.test.ts src/main/__tests__/identity-routes.int.test.ts`
- [x] T9 — Acceptance: a fake Battle.net provider in `tests/acceptance/support/fake-battle-net.ts` (`/authorize`
      redirects back to the given `redirect_uri` with a code or an `error`, `/token`, `/userinfo`; scriptable per
      scenario, records the last authorize request), started by the stack; the staging API gets `BNET_*` pointing at
      it, the plain API gets none (IDB-06); steps in `tests/acceptance/steps/identity-bnet.steps.ts` for every step of
      `acceptance.feature`, reusing the existing pairing and heartbeat steps — gate:
      `pnpm exec turbo run test:acceptance -- --grep @IDB-`
- [x] T10 — Whole-repo sensors on the branch — gate:
      `pnpm typecheck && pnpm lint && pnpm arch && pnpm specs:check`

## Batch 3 — review fixes (PR #43)

- [x] T11 — Security review finding 1 (IDB-11): the Fastify request log records `req.url`, so the callback's `code` and
      `state` reach the logs. Give `appLoggerOptions` a `req` serializer that logs the path without its query string,
      for every route; add a test that captures the log output of a callback request and asserts that neither `code=`
      nor `state=` (nor their values) appears — gate:
      `pnpm --filter @d2rmm/api exec vitest run src/main/app.test.ts && pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/main/__tests__/identity-routes.int.test.ts`
- [x] T12 — Security review finding 2: the loopback rule of `config.ts` accepts any hostname starting with `127.`
      (`http://127.evil.example`). Accept only `localhost`, `[::1]` and a full IPv4 `127.a.b.c` (each part 0 to 255),
      for both `OTEL_EXPORTER_OTLP_ENDPOINT` and `BNET_OAUTH_BASE_URL`; tests for `127.evil.example`, `127.0.0.1.nip.io`,
      `127.0.0.1` and `127.1.2.3` — gate: `pnpm --filter @d2rmm/api exec vitest run src/main/config.test.ts`
- [ ] T13 — Security review finding 5 (IDB-04): if `signInWithBattleNet` throws (database error), the callback ends in a
      500 without clearing the state cookie. Catch it in the callback route, record the outcome, clear the state cookie
      and redirect to `/?signin=failed`; a test with a failing repository — gate:
      `pnpm --filter @d2rmm/api exec vitest run -c vitest.integration.config.ts src/main/__tests__/identity-routes.int.test.ts`
