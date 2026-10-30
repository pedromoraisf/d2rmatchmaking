# D2R Match Making

Community matchmaking for **Diablo II: Resurrected** on PC — like the CS community platforms, for D2R.

- **PvP** queues (1v1, 2v2, 6-player arena; GM or BM rules) with ELO per character and difficulty.
- **Leveling** queues (Baal, Chaos, Cows, Terror Zones, Heralds) that guarantee a teleporter and a BO.
- **Live rooms** you can browse and join, filtered by mode, difficulty, region, ladder and era.
- A **read-only desktop agent** (Windows, Tauri) that confirms presence by reading the game window — no memory access,
  no injection, no network interception.

The game itself is created **manually in-game** by the host, with a generated name (`mmbaalh-12`) and no password.

> Status: **pre-foundation**. The repository holds the harness (guides, sensors, hooks, workflow) and the product and
> architecture docs. Phase F0 (walking skeleton) builds the first code. See [`.specs/phases/ROADMAP.md`](.specs/phases/ROADMAP.md).

## Docs

| | |
| --- | --- |
| Product requirements | [`docs/product/prd.md`](docs/product/prd.md) |
| Design doc | [`docs/architecture/design-doc.md`](docs/architecture/design-doc.md) |
| Architecture decisions | [`docs/adr/`](docs/adr/) |
| Domain model | [`docs/domain/`](docs/domain/) |
| Engineering rules | [`docs/engineering/`](docs/engineering/) |
| Agent & contributor guide | [`AGENTS.md`](AGENTS.md) |

## Stack

Cloudflare Pages (web) · Render (API) · Neon Postgres · Cloudflare R2 · GitHub Actions/Releases ·
Node.js 26 + TypeScript + Fastify 5 + Kysely · React 19 + Vite + TanStack · Tauri 2 + Rust · OpenTelemetry → Grafana Cloud.

## Getting started

```sh
nvm use            # Node 26
corepack enable    # pnpm 10
pnpm install       # also installs git hooks (Lefthook)
pnpm check         # everything CI runs
```

## Not affiliated

Diablo II: Resurrected is a trademark of Blizzard Entertainment, Inc. This is a community project and is not affiliated
with or endorsed by Blizzard. No Blizzard assets are used.

## License

[MIT](LICENSE). Third-party notices in [NOTICE](NOTICE).
