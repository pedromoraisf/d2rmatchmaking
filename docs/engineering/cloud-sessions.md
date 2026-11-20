# Cloud sessions

How a `feature-worker` runs in a Claude Code cloud session (Linux container, outbound traffic through an egress proxy).
Measured on a pilot session; times are wall clock on a cold container.

## Setup that works

Run as root from the directory that holds the checkout (`d2rmatchmaking`).

| Step               | What                                                                                                                                                                                                                                      | Time        |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| Node 26            | The image ships Node 22. Unpack the official tarball to `/opt/node26` and put `/opt/node26/bin` first on `PATH`                                                                                                                           | 5 s         |
| pnpm 10            | Already present (10.28, in the Node 22 prefix); works with Node 26 on `PATH`. Corepack ships only with Node 22                                                                                                                            | 0 s         |
| `pnpm install`     | `--frozen-lockfile`; installs Lefthook                                                                                                                                                                                                    | 6 s         |
| Full git history   | The clone is shallow; `git fetch --unshallow origin` (a harness test needs commit `b1519d6`)                                                                                                                                              | 2 s         |
| `cargo-nextest`    | `cargo install cargo-nextest --locked` (Rust 1.97 is preinstalled)                                                                                                                                                                        | 4 min       |
| Docker daemon      | `dockerd` is installed but not running; start it in the background. Pull with an empty `DOCKER_CONFIG`                                                                                                                                    | 8 s + pulls |
| Playwright browser | The repo pins Playwright 1.61 (chromium revision 1228); the image has revision 1243. `cdn.playwright.dev` is blocked, so symlink `/opt/pw-browsers/chromium_headless_shell-1243` to `~/.cache/ms-playwright/chromium_headless_shell-1228` | 0 s         |

Prefix every Node command with `PATH=/opt/node26/bin:$PATH`; an exported `PATH` does not survive between Bash calls.

## What runs in the cloud

| Gate                                                            | Result           | Time       |
| --------------------------------------------------------------- | ---------------- | ---------- |
| `pnpm lint`                                                     | pass             | 14 s       |
| `pnpm typecheck`                                                | pass             | 13 s       |
| `pnpm test` (unit + harness)                                    | pass             | 16 s       |
| `pnpm test:harness`                                             | pass             | 13 s       |
| `cargo nextest run -p d2rmm-agent-{domain,core,adapters} --lib` | pass (455 tests) | 8 s (warm) |
| `cargo clippy` on the same three crates (`-D warnings`)         | pass             | 33 s       |
| `pnpm test:integration` (Testcontainers Postgres)               | pass (186 tests) | 67 s       |
| `pnpm test:acceptance -- --trace off`                           | pass (237 tests) | 6 min 18 s |

Claude Code hooks (`.claude/settings.json`) run in the session: the feedback hook formatted a throwaway markdown edit
with prettier right after the edit.

## What does not run in the cloud

- **App crate `d2rmm-agent`** (Tauri, Windows target): `cargo check -p d2rmm-agent` fails in the `gdk-sys` build script
  (no GTK system libraries). CI builds it on Windows.
- **`ocr-real`** (needs the encrypted prints) runs in CI only.
- **Real prints and the game**: capture, OCR calibration and anything that reads the D2R window stay on the
  maintainer's machine (AGENTS.md: never commit a screenshot).
- **Mutation** runs in the nightly only (ADR 026, ADR 029).

## GitHub from the session

- `gh auth status` reports an invalid `GH_TOKEN`, yet REST calls work: `gh run list`, `gh workflow list`, `gh api
repos/<owner>/<repo>/pulls` and `gh run view <id> --log-failed` all succeeded.
- GraphQL is blocked: `gh pr list` and `gh pr create` fail with HTTP 403. Open a pull request with the GitHub MCP tools
  or `gh api repos/<owner>/<repo>/pulls -f title=… -f head=… -f base=… -F draft=true`.
- Never dispatch workflows or merge from a pilot; delivery follows ADR 028.

## Pitfalls

- A worker that skips `git fetch --unshallow` fails `agent-test-preservation.test.mjs` for a reason unrelated to its change.
- The preinstalled Chromium is a different revision than the pinned Playwright; if acceptance fails with
  `Executable doesn't exist`, the symlink above is missing.
