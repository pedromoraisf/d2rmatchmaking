# D2R Match Making agent

The read-only Windows desktop agent. Architecture: ADR 027. Releases: `docs/engineering/releases.md`.

## Checking the installed version

The agent window does not show its version. On Windows, open Settings → Apps → Installed apps and find `D2RMatchMaking`.

## Checking the self-update

The agent looks for an update when it starts and every 6 hours (AD-049). With an older version installed and a newer
release published, restart the agent, wait a moment, and check the installed version again.

## The Party panel check (maintainer, Windows)

The Windows OCR reading of the Party panel is checked on the maintainer's own screenshots. They are not in the repository
(the game's UI art, and other players' names): copy the three files into one folder, named exactly:

- `maintainer-party-revealed.png`: the Party panel with the game name revealed (the room's name is `DUEL NK LOCKS`)
- `maintainer-party-revealed-tooltip.png`: the same, with the eye's tooltip open
- `maintainer-party-masked.png`: the panel with the masked name (`xxxxxxxxx`)

Then, from the repository root on Windows:

```text
node scripts/agent/ocr-check.mjs <folder>
```

The check prints `PASS` or `FAIL` for each file, with the title, the label and the field text the engine read, and exits
non-zero when a file fails. It needs the en-US Windows OCR engine.
