# D2R Match Making agent

The read-only Windows desktop agent. Architecture: ADR 027. Releases: `docs/engineering/releases.md`.

## Checking the installed version

The agent window does not show its version. On Windows, open Settings → Apps → Installed apps and find `D2RMatchMaking`.

## Checking the self-update

The agent looks for an update when it starts and every 6 hours (AD-049). With an older version installed and a newer
release published, restart the agent, wait a moment, and check the installed version again.

## The Party panel check (maintainer, Windows)

The Windows OCR reading of the Party panel and the selection screen is checked on the maintainer's own screenshots. They
are not in the repository (the game's UI art, and other players' names): copy the five files into one folder, named
exactly:

- `maintainer-party-revealed.png`: the Party panel with the game name revealed (the room's name is `DUEL NK LOCKS`)
- `maintainer-party-revealed-tooltip.png`: the same, with the eye's tooltip open
- `maintainer-party-masked.png`: the panel with the masked name (`xxxxxxxxx`)
- `maintainer-select-screen.png`: the character selection screen
- `maintainer-select-difficulty.png`: the selection screen with the difficulty popup open

### Without installing anything (recommended)

The Windows CI build of the agent makes a standalone `ocr-check.exe` (statically linked, no Node, Rust or build tools).

1. Open the pull request's CI run on GitHub (Actions), and under Artifacts download `ocr-check-windows`. It is kept for 14 days.
2. Unzip it into its own new folder.
3. Put the five screenshots in another folder, then open a terminal in the unzipped folder and run:

```text
ocr-check.exe C:\d2r-prints
```

The check prints `PASS` or `FAIL` for each file, with what the engine read, names any file that is missing, and exits
non-zero when a file fails. If the en-US Windows OCR language is not installed, it says so and says how to add it.

### With Node (a repository checkout on Windows)

From the repository root on Windows, with Node and the Rust toolchain installed:

```text
node scripts/agent/ocr-check.mjs <folder>
```

It runs the same check (the `ocr_check` test). It needs the en-US Windows OCR engine.
