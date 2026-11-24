---
name: staging-bots
description: Start synthetic players (staging bots) that queue with the maintainer on the staging site, so a lone tester reaches a ready check, a room and the agent's confirmation. Use when the user says "sobe os bots", "bots", "/staging-bots", "quero testar uma sala", or asks to validate a PvP or Leveling journey on staging. Never for production.
---

# Staging bots

Runs `scripts/staging/bots.mjs` (spec `.specs/features/staging-bots/spec.md`, guide `docs/engineering/staging-bots.md`)
with the bucket the maintainer is about to queue in. Speak the user's language (pt-BR with the maintainer); keep each
message to what they do next.

## 1. Ask for the bucket (one message, only what is missing)

| Input       | Values                                       | Notes                                                               |
| ----------- | -------------------------------------------- | ------------------------------------------------------------------- |
| mode        | `pvp` / `leveling`                           | PvP is a duel (1 bot); Leveling is a group of 8 (7 bots)            |
| difficulty  | `normal` / `nightmare` / `hell`              |                                                                     |
| region      | `americas` / `europe` / `asia`               | default `americas`                                                  |
| ladder, era | `ladder` / `non-ladder`; `rotw` / `lod`      | must match the user's character, or the bots land in another bucket |
| hardcore    | `true` / `false`                             | default `false`                                                     |
| rules       | `gm` / `bm`                                  | PvP only, default `gm`                                              |
| activity    | `baal` / `chaos` / `cows` / `tz` / `heralds` | Leveling only, required; `heralds` needs `hell` and `rotw`          |
| minutes     | 1 … the script's maximum                     | default 20; the bots leave after it                                 |

Tell the user, for Leveling: pick the role **Teleporter** (bots never take it, so the user hosts) and a minimum level
**≤ 90** (bots are level 90; the hell floor 70 is the simple choice). The site never lets the minimum exceed the user's
own character level (FR-07/FR-09).

## 2. Start the bots

From the repository root, in the background, with a log in the scratchpad:

```bash
NODE_USE_ENV_PROXY=1 \
STAGING_API_URL=https://d2rmm-api.onrender.com SITE_ORIGIN=https://staging.d2rmatchmaking.pages.dev \
BOTS_MODE=<mode> BOTS_DIFFICULTY=<difficulty> BOTS_REGION=<region> BOTS_LADDER=<ladder> BOTS_ERA=<era> \
BOTS_HARDCORE=<hardcore> BOTS_RULES=<rules> BOTS_ACTIVITY=<activity> BOTS_COUNT=<1 for pvp, 7 for leveling> \
BOTS_MINUTES=<minutes> nohup node scripts/staging/bots.mjs > <scratchpad>/bots-<label>.log 2>&1 &
```

- `NODE_USE_ENV_PROXY=1` is for a cloud session (the egress proxy); harmless elsewhere. Leave `BOTS_ACTIVITY` out for PvP
  and `BOTS_RULES` out for Leveling.
- Keep `BOTS_HUMAN_FIRST` at its default (`true`): the bots wait until a human is in the bucket, so the user hosts.
- The script refuses any API whose `/v1/config` does not say `stagingEndpoints: true`. Never point it anywhere else, never
  at `https://d2rmatchmaking.pages.dev` (production), and never set a production URL to "try".
- Wait until the log shows one `bot.queued` per bot (an until-loop on `grep -c bot.queued`), then tell the user "bots no
  ar" and the steps: open the game at the character select screen, **ENCONTRAR PARTIDA**, accept the ready check, create
  the game with the exact name the site shows (public, no password), open the **Party** panel, watch for "Confirmado
  pelo agente".

## 3. Follow and report

- Read the log's JSON lines (skip the `UNDICI` warning): `bot.accepted` → `bot.assigned` (room id) → stages `formed`,
  `awaiting_host`, `created`, `active`, `closed`. The gap from `awaiting_host` to `created` is the host's time to create
  the game and be confirmed.
- With "Enviar diagnósticos" on, the room's traces are in Tempo (`grafanacloud-traces`):
  `{ span.d2r.room.id = "<room id>" && resource.d2r.telemetry.tier = "full" }`.

## 4. When it goes wrong

- **The user declined the ready check, or a ready check failed**: the bots stay in that attempt and do not requeue. Stop
  the run (`pkill -INT -f scripts/staging/bots.mjs`; if it does not exit within a few seconds, `pkill -KILL`), start a
  fresh one, and tell the user to stay in the queue. The queue count on the site drops while the old bots leave: expected.
- **No ready check**: compare the bucket (ladder, era, hardcore, region, activity, minimum level ≤ 90) with the user's.
- **`/v1/config` refused or the API sleeps**: the free API wakes in 30–60 s; `curl -s https://d2rmm-api.onrender.com/healthz`
  first.
- Stop all bots when the user is done (`pkill -INT -f scripts/staging/bots.mjs`).

## Rules

- Staging only. No game screenshot goes into the repository, an issue or a PR; results are text.
- The workflow `staging-bots.yml` does the same once it is on `main` (GitHub → Actions → staging-bots → Run workflow).
