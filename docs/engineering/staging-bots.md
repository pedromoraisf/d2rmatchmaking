# Staging bots

Synthetic players for **staging only**. A ready check needs a full group (2 players in a PvP duel, 8 in Leveling), and a
lone tester has no one to play with. The bots queue with you, accept the ready check and confirm presence through fake
agents, so you reach a ready check, a room and the agent's "Confirmed" on your own site and agent.

Spec: `.specs/features/staging-bots/spec.md` (SBT-01 to SBT-13, with the threat model). Script: `scripts/staging/bots.mjs`
(an admin task, ADR 032 XII). Workflow: `.github/workflows/staging-bots.yml`.

## Never production

- The workflow takes the API from the `staging` environment's variable `STAGING_API_URL`, never from an input.
- The script calls `GET /v1/config` first and stops unless the API says `stagingEndpoints: true`. It also stops on
  `D2RMM_ENV=production` and on a URL that is not an https origin. The gate is `/v1/config` saying `stagingEndpoints: true`,
  not the name of the host. It makes no write before these checks.
- The server has no bot route. Bots use the staging-only test sign-in (`POST /v1/auth/test-login`), which a production API
  answers with 404; `staging-bots-production.int.test.ts` proves it, and fails if a staging-only route is added unlisted.
- Bots never sign in through Battle.net and hold no secret. The `staging` environment needs two **variables** (not secrets):
  `STAGING_API_URL` (today `https://d2rmm-api.onrender.com`) and `SITE_ORIGIN` (today `https://d2rmatchmaking.pages.dev`).

## How to run

1. **Queue first, then dispatch.** Open the staging site, join the queue yourself with the bucket you want (mode, difficulty, region, ladder, era; in
   Leveling the activity). The human hosts only if they queued before the bots, and with `human_first` the bots wait until you are in the queue.
2. In GitHub (the phone app works), run **staging-bots** with the same bucket.
3. The first bot queues and reads the pool (the number the site shows as "N jogadores nesta fila"). When another player waits,
   the others queue, the group forms, and the ready check opens on your site. Accept it.
4. Open the game as the host, create the game named in the room, and your agent confirms it. The bots confirm the same
   name as members would.
5. The bots leave when the room ends, after `minutes`, or when you cancel the run.

## Run it from your PC

The workflow lives on `phase/F2` until that phase reaches `main`, and GitHub shows no "Run workflow" button for a workflow
that is not on the default branch. Meanwhile run the script yourself, from a checkout of a branch that has it. It needs only
Node 18 or newer and no `pnpm install`.

Set the same variables the workflow sets, then run it. `STAGING_API_URL` and `SITE_ORIGIN` are required; the `BOTS_*`
variables are the inputs of the table under "Inputs", and an empty one takes its default: `BOTS_MODE`, `BOTS_DIFFICULTY`,
`BOTS_REGION`, `BOTS_LADDER`, `BOTS_ERA`, `BOTS_HARDCORE`, `BOTS_ACTIVITY`, `BOTS_ROLE`, `BOTS_RULES`, `BOTS_MIN_LEVEL`,
`BOTS_COUNT`, `BOTS_MINUTES`, `BOTS_HUMAN_FIRST` and `BOTS_HOST_POLICY`.

```powershell
$env:STAGING_API_URL="https://d2rmm-api.onrender.com"; $env:SITE_ORIGIN="https://d2rmatchmaking.pages.dev"; $env:BOTS_MODE="pvp"; $env:BOTS_MINUTES="15"; node scripts/staging/bots.mjs
```

Queue yourself first, as in "How to run". Ctrl+C makes the bots leave before the script ends. The safety is the same: the
script refuses any API whose `/v1/config` does not say `stagingEndpoints: true`.

## Inputs

| Input                  | Meaning                                                                                                                                                                     |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mode`                 | `pvp` (a duel, 1 bot) or `leveling` (a group of 8, up to 7 bots)                                                                                                            |
| `difficulty`, `region` | The bucket's difficulty and game region                                                                                                                                     |
| `ladder`, `era`        | What the bots' characters declare, so they fall in your bucket; match your own character's declaration                                                                      |
| `hardcore`             | Whether the bots' characters are hardcore                                                                                                                                   |
| `rules`                | PvP rules, `gm` or `bm`                                                                                                                                                     |
| `activity`, `role`     | Leveling only. The bots take `killer`, `bo` or `leech`, never `teleporter`, so the match names you host                                                                     |
| `min_level`            | Leveling only. Empty is the difficulty's floor                                                                                                                              |
| `bots`                 | How many. Empty is the group size minus one, which is also the maximum (at most 7)                                                                                          |
| `minutes`              | How long they stay, 1 to 60. The default is 15                                                                                                                              |
| `human_first`          | On (default): the bots queue only after another player waits in the bucket                                                                                                  |
| `host_policy`          | If the match still names a bot host: `bot-reports` (default; the room advances without a real game) or `bot-silent` (it posts nothing and the room expires after 3 minutes) |

## What a run does and does not do

- Each bot is a test account named `bot-<run tag>-<n>` with a `Bot…` character at level 90 and a paired fake agent. The
  agent speaks the real contract: heartbeat every 15 s, a site stream and an agent stream, ready-check accept after 2 to 10 s,
  and one `GAME_NAME_SEEN` with the room's name. It sends no screenshot and nothing a real agent would not.
- The job summary lists the bucket, the bots' names, the room and its stages, and how each bot left. It prints no token or cookie.
- At the end each bot leaves the room or queue, deletes its agent (which revokes its token) and signs out.
- A run of N bots spends N of the 10 pairing codes one IP may ask per hour. A second large run from the same runner IP inside
  the hour can be refused with `rate-limited`; wait for the hour. The limit is not raised for the bots.
- A second dispatch waits for the first to finish; it never cuts a cleanup.

## Telling a bot from a player

The site shows no other player's name, so there is no badge. A bot is named `bot-<tag>-<n>` in the job summary and in every log
line, and its character is `Bot…` at level 90.

## To stop one

Cancel the run in GitHub: the cancel sends SIGTERM and the bots leave before the job ends.
