# Staging bots — Notes (T0, verified 2026-11-21)

## A1 — Who is host

`apps/api/src/modules/matchmaking/domain/matcher.ts:245,257` (`toFormedGroup`):

- **PvP**: the host is the first ticket in join order (`compareJoinOrder`).
- **Leveling**: the member whose role is `teleporter`; when nobody is, the first in join order.

So the human hosts when they queued first and no bot has the `teleporter` role. Bots therefore never take the
`teleporter` role (the plan rejects it). If the human is not a teleporter and joined first, they host; if a bot still
ends up host (the human joined after the first bot), that bot follows `bot-reports`.

**The count the site shows** ("1 jogadores nesta fila", `queue.searching.pool`, `SearchingPanel.tsx:65`) is
`ticket.poolSize` of `GET /v1/queue/tickets/me`. It is answered only to an account that holds a ticket. The API has no
route that counts a bucket without one. So the first bot is a **sentinel**: it joins, reads `poolSize`, and the other
bots join only once `poolSize − (bots of this run already queued) ≥ 1`, that is, a non-bot waits in the bucket. The
sentinel is first in join order only when it joined before the human; for the human to host, they queue first and
dispatch the run after.

## A2 — The `bot-` marker

`displayNameOf` (`identity/domain/account.ts:34`) cuts a BattleTag at `#`. Blizzard's published BattleTag rules allow
letters and digits only, so `-` never appears in a Battle.net display name and `bot-…` cannot be one (not stated in
this repository; stated by Blizzard). `PlayerName` allows `-` only for test accounts.

## A3 — Rate limits for 7 bots from one IP

- Join: 10 per minute per account (`queue-limits.ts`), each bot has its own account.
- Pair: 10 code submissions per 5 minutes per account (`sliding-window.ts:9`), one per bot.
- **Pairing codes: 10 per hour per IP** (`IP_CODE_REQUESTS`, `sliding-window.ts:12`). A run of N bots uses N. A run of
  7 fits; a second Leveling run from the same runner IP within the hour would not (429 `rate-limited`).
- Observations: 20 per minute per agent, 40 per room (`observation-limit.ts`): the bots post one.
- The `X-Forwarded-For` value is not trusted beyond the platform's proxy hops (`trustProxyHops`), so the harness's
  per-player addresses do not apply to a runner.

This is not a refusal for a run, so the limits stay as they are. The script reads a 429 on pairing as "wait for the
hour" and fails with that reason before it queues anyone. The runbook says so: a Leveling run costs 7 of the hour's
10 codes.

## A4 — `/v1/config`

`GET /v1/config` has no guard (`main/app.ts:490`): it answers without a session on any environment.
