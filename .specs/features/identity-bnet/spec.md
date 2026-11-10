# Identity with Battle.net — Specification

**Phase**: F1 (covered by the brief's approval, ADR 029) · **Size**: Medium · **Security review**: yes

## Problem

F0 signs players in through a staging-only test sign-in (AD-029). F1 needs the real thing: a Battle.net account, a
session cookie that reaches the API through the Pages proxy (ADR 012), a way to sign out, and a way to revoke a paired
agent from the site (FR-04). F0 already revokes the previous agent when a new one is paired (AD-037), evicts a revoked
token from the cache and closes its stream (`AgentRevoked`); the agent already drops its token on a 401 and shows a new
pairing code (AGS-08). What is missing is the player's own revoke action.

## Goals

- A player signs in with Battle.net on staging and production, stays signed in for 7 days and can sign out.
- The same Battle.net account always maps to the same platform account, even when its BattleTag changes.
- A player revokes their paired agent on the site and that agent's token stops working at once.
- CI proves all of it against a fake Battle.net; production waits only on the maintainer's OAuth credentials.

## Out of scope

| Item                                             | Why                                                                                      |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Removing the test sign-in                        | Other features and the acceptance suite still use it on staging (brief, AD-029)          |
| Battle.net China (`oauth.battlenet.com.cn`)      | Separate issuer; the MVP serves the global regions                                       |
| Reading characters or regions from Battle.net    | The D2R API does not exist; characters come from the agent (FR-02, feature `characters`) |
| Account deletion, multiple sessions management   | Not in the PRD                                                                           |
| What a revoked agent's rooms or queue tickets do | Queues and rooms do not exist yet; FR-32 (`lobby-rooms`) covers members who drop         |

## Requirements

Each line is one EARS requirement. "The site" is the browser app on Cloudflare Pages; it reaches the API only at
`/api/*` (ADR 012).

- **IDB-01** — WHEN a visitor chooses "Sign in with Battle.net" THEN the API SHALL redirect the browser to Battle.net's
  authorize endpoint with the configured client id, the redirect URI `<SITE_ORIGIN>/api/v1/auth/bnet/callback`, scope
  `openid`, a fresh random `state` and a PKCE `S256` code challenge, and SHALL bind that `state` and its verifier to
  the visitor's browser for 10 minutes in an HttpOnly, Secure, `SameSite=Lax`, `__Host-` cookie.
- **IDB-02** — WHEN Battle.net redirects back to the callback with a `code` and the `state` bound to that browser within
  its 10 minutes THEN the API SHALL exchange the code with the PKCE verifier, read the Battle.net `sub` and BattleTag
  from the userinfo endpoint, find the account by `sub` or create it on the first sign-in, open a 7-day session, set
  the session cookie (`__Host-d2rmm_session`, HttpOnly, Secure, `SameSite=Lax`, `Path=/`), clear the state cookie and
  redirect to the site's home page, where the player sees their name.
- **IDB-03** — WHEN an account signs in again with the same Battle.net `sub` and a different BattleTag THEN the API SHALL
  keep the same account id and store the new BattleTag and display name.
- **IDB-04** — IF the callback has no `state`, a `state` that does not match the browser's state cookie, an expired or
  already used `state`, an `error` from Battle.net (for example `access_denied`), or the code exchange or the userinfo
  call fails THEN the API SHALL open no session, clear the state cookie and redirect to the site's home page with a
  sign-in failure that the site shows as a translated message.
- **IDB-05** — WHEN a signed-in player signs out THEN the API SHALL delete the session, expire the session cookie and
  answer 204, and the old session token SHALL answer 401 on every route that requires a session.
- **IDB-06** — IF the Battle.net client id or secret is not configured THEN the login and callback routes SHALL answer
  404 and the site SHALL not offer "Sign in with Battle.net".
- **IDB-07** — WHILE staging endpoints are on, the test sign-in (AD-029) SHALL keep working next to the Battle.net
  sign-in; a test account and a Battle.net account are never the same account.
- **IDB-08** — WHEN a signed-in player revokes their paired agent on the site THEN the API SHALL revoke it, every request
  that agent's token makes afterwards SHALL answer 401, the agent's open stream SHALL close, and the site SHALL show
  that no agent is paired and offer the pairing form.
- **IDB-09** — IF the agent to revoke is unknown, already revoked or paired to another account THEN the API SHALL answer
  404 and change nothing.
- **IDB-10** — Sign-out and revoke SHALL require a session and the site's exact origin (`requireSameOrigin`); without a
  session they answer 401, from another origin 403.
- **IDB-11** — The API SHALL keep the authorization code, access token, `state`, PKCE verifier, client secret and
  BattleTag out of logs, span attributes, error bodies and redirect URLs it builds for the site.
- **IDB-12** — The login, callback, sign-out and revoke paths SHALL each run in a span (`identity.bnet-login`,
  `identity.bnet-callback`, `identity.sign-out`, `agents.revoke`) whose attributes carry the outcome (`ok` or the
  failure reason of IDB-04) and no personal data.
- **IDB-13** — Every new user-facing string SHALL come from the translation files, in English and pt-BR (NFR-12), and the
  new controls SHALL be reachable and usable by keyboard (NFR-13).

## Sources

| ID     | Source                                                                                         |
| ------ | ---------------------------------------------------------------------------------------------- |
| IDB-01 | FR-01; Design Doc § Contratos (`GET /auth/bnet/login`); ADR 012                                |
| IDB-02 | FR-01; Design Doc § Modelo de dados (`identity.accounts.bnet_sub`); session lifetime of AD-029 |
| IDB-03 | FR-01; Design Doc § Modelo de dados (`bnet_sub` is the stable OAuth identifier)                |
| IDB-04 | FR-01; NFR-06 (security)                                                                       |
| IDB-05 | FR-01 ("manter sessão" implies ending it)                                                      |
| IDB-06 | FR-01; brief "What I need from you" item 2 (credentials arrive later)                          |
| IDB-07 | Brief notes (AD-029 until `identity-bnet` merges, and staging after it)                        |
| IDB-08 | FR-04; ADR 011 (revocable token); NFR-06                                                       |
| IDB-09 | FR-04; NFR-06                                                                                  |
| IDB-10 | ADR 012; F0 `requireSameOrigin`                                                                |
| IDB-11 | NFR-06; Design Doc § Observabilidade (never BattleTag in telemetry); AGENTS.md rule 6          |
| IDB-12 | AGENTS.md rule 10; `docs/engineering/telemetry.md`                                             |
| IDB-13 | NFR-12, NFR-13; AGENTS.md rule 9                                                               |

## Requirement Traceability

| Requirement ID | Story                     | Proof                                                 |
| -------------- | ------------------------- | ----------------------------------------------------- |
| IDB-01         | Sign in with Battle.net   | acceptance `@IDB-01` + unit test of the authorize URL |
| IDB-02         | Sign in with Battle.net   | acceptance `@IDB-02`                                  |
| IDB-03         | Sign in with Battle.net   | acceptance `@IDB-03` + unit test of the use case      |
| IDB-04         | Sign in with Battle.net   | acceptance `@IDB-04` + unit tests of each failure     |
| IDB-05         | Sign out                  | acceptance `@IDB-05`                                  |
| IDB-06         | Sign in with Battle.net   | acceptance `@IDB-06`                                  |
| IDB-07         | Sign in with Battle.net   | acceptance `@IDB-07`                                  |
| IDB-08         | Revoke an agent           | acceptance `@IDB-08`                                  |
| IDB-09         | Revoke an agent           | acceptance `@IDB-09`                                  |
| IDB-10         | Sign out, revoke an agent | acceptance `@IDB-10`                                  |
| IDB-11         | Privacy                   | unit tests on the adapter, routes and span attributes |
| IDB-12         | Telemetry                 | unit tests with an in-memory span exporter            |
| IDB-13         | Accessibility and i18n    | i18n lint + keyboard steps in `@IDB-02`/`@IDB-08`     |

## Decisions (conservative defaults)

- **OAuth client**: a small `fetch`-based adapter behind an application port (`BattleNetOAuth`: authorize URL, code
  exchange, userinfo), instead of `openid-client` named in the Design Doc's stack table. The userinfo call over TLS gives
  `sub` and BattleTag, so no ID-token validation is needed, and the fake provider in CI stays three plain endpoints.
  Reversible: swap the adapter. → `decisions.md → To confirm`.
- **State storage**: in the `__Host-d2rmm_oauth` cookie (state + verifier + expiry), single-use; no server memory, so an
  API restart does not break a sign-in in flight. The cookie is `SameSite=Lax` because the callback is a top-level GET
  from Battle.net.
- **After sign-in** the API always redirects to the site's `/`; there is no `returnTo` parameter (no open redirect).
- **Battle.net base URL** is configurable (`BNET_OAUTH_BASE_URL`, default `https://oauth.battle.net`), https only except
  on a loopback host, so CI can point it at the fake provider. Client id and secret come from `BNET_CLIENT_ID` and
  `BNET_CLIENT_SECRET`, set by the maintainer in GitHub/Render secrets (brief item 2); `.env.example` lines are left to
  the maintainer (lesson: the Write tool refuses that file).
- **Account display name** is the BattleTag's name part (`Name#1234` → `Name`); the full BattleTag is stored, never
  sent to telemetry.
- **Revoke asks for a confirmation** on the site before the request (one extra click, no data at risk otherwise).

## Edge cases

- Two tabs start a sign-in: the second overwrites the state cookie, so the first tab's callback fails with IDB-04 and
  shows the failure message; signing in again works.
- The callback is opened twice (back button): the state cookie was cleared on first use, so the second answers IDB-04;
  the session of the first stays.
- A player signed in with a test account on staging who then signs in with Battle.net gets the Battle.net account; the
  test session is replaced by the new cookie.
- Revoking while the agent is mid-heartbeat: the heartbeat answered before the revoke succeeds, the next answers 401.
- Revoking an agent that never claimed its token: it is revoked the same way and `GET /v1/agents/me` answers `none`.
