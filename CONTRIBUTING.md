# Contributing

Thanks for helping! The short version:

1. Read [`AGENTS.md`](AGENTS.md) — it is the guide for humans and coding agents alike.
2. `pnpm install` (Node 26, pnpm 10). This installs the Lefthook git hooks.
3. Work happens through specs: see `.specs/` and the phase workflow in `AGENTS.md`. Small fixes can go straight to a PR.
4. Before pushing: `pnpm check`.
5. Commits follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat(lobby-room): …`).
6. PRs fill in the template, including which spec criteria they prove.

Using an AI coding agent is welcome. The harness (hooks, sensors, ratchet) applies to everyone equally, and a PR that
loosens a sensor, a threshold or a test needs a maintainer's explicit approval and a reason.

By contributing you agree that your contributions are licensed under the MIT License.
