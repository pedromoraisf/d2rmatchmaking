# D2R Match Making agent

The read-only Windows desktop agent. Architecture: ADR 027. Releases: `docs/engineering/releases.md`.

## Checking the installed version

The agent window does not show its version. On Windows, open Settings → Apps → Installed apps and find `D2RMatchMaking`.

## Checking the self-update

The agent looks for an update when it starts and every 6 hours (AD-049). With an older version installed and a newer
release published, restart the agent, wait a moment, and check the installed version again.

## Testing a pull request's installer (maintainer, Windows)

The CI `agent-build` job of a pull request that changes `apps/agent` uploads the artifact `agent-installer-windows` (14
days). It is a test build: unsigned, with no updater artifacts, and it talks to the API of the repository variable
`API_BASE_URL`, like a release.

- The artifact is a zip (GitHub zips every artifact). Run the `.exe` in its `nsis` folder; the `msi` folder holds the
  same app as an MSI.
- Windows 11 Smart App Control blocks any unsigned app, with no way to run it: turn it off to test (Settings → Privacy &
  security → Windows Security → App & browser control), or wait for signed releases. SmartScreen then warns once: "More
  info" → "Run anyway".
- If the installed agent closes at once, run it from PowerShell with
  `Start-Process <exe> -RedirectStandardError $env:TEMP\d2rmm-err.txt -Wait` and read the file: a release build has no
  console, so a startup error is otherwise silent.
- With Smart App Control on, the unsigned uninstaller cannot run either. Remove the agent by hand: close it, delete
  `%LOCALAPPDATA%\D2RMatchMaking` and the registry key
  `HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Uninstall\D2RMatchMaking`.

## Assisted typing (FR-28)

While the agent holds a room, **Ctrl+Shift+F** types the room's game name (for example `mmbaalh-12`) into the game. The key is
changeable in the agent window, as is the accept key (Ctrl+Shift+A by default).

What it does:

- Types only the game name of your room, as Unicode characters (`a`–`z`, `0`–`9` and `-`), one down and up each.
- Only while Diablo II: Resurrected has the focus, and not while the agent reads the in-game screen or the automap.
- Waits up to 1 second for you to let go of the hotkey's keys, then types. It stops if the game loses focus, the room ends or
  you press the key again.

What it never does (ADR 010): press Enter, Tab, Space, Escape or Backspace, send any other key, a modifier, a mouse event or
a clipboard paste, or type anything but the game name. It does not clear the field: open the Game Creator with an empty name
field, press the hotkey, and press Enter yourself. The agent window says what the last press did.

### Maintainer's check on a preview installer (Windows)

Install the preview channel's installer (see above), pair it, and hold a room. On normal, nightmare and hell names:

1. Open the Game Creator, click the name field and press Ctrl+Shift+F: the name appears and nothing is confirmed.
2. Press Enter yourself and create the game.
3. Try the refusals: press the hotkey with another window in front, with the keys held for more than a second, and in a game.
   Each must type nothing and the window must say why.
4. Change the fill key in the window (for example Alt+G), press the new key, and check the old one no longer types.

## The Party panel check (maintainer, Windows)

The Windows OCR reading of the Party panel and the selection screen is checked on the maintainer's own screenshots. They
are not in the repository (the game's UI art, and other players' names): copy the five files into one folder, named
exactly:

- `maintainer-party-revealed.png`: the Party panel with the game name revealed (the room's name is `DUEL NK LOCKS`)
- `maintainer-party-revealed-tooltip.png`: the same, with the eye's tooltip open
- `maintainer-party-masked.png`: the panel with the masked name (`xxxxxxxxx`)
- `maintainer-select-screen.png`: the character selection screen
- `maintainer-select-difficulty.png`: the selection screen with the difficulty popup open

Any number of extra Party frames of a **generated** game name may sit in the same folder, named
`maintainer-party-<gamename>.png`, where `<gamename>` is the name exactly as typed in game (`maintainer-party-mmbaalh-19.png`
expects `mmbaalh-19`). Each is checked like `maintainer-party-revealed.png` (panel open, field revealed and matched) against
its own name, and gets its own PASS or FAIL; the variations job reads them too. A name that is empty or holds `/` or `\`
is ignored, and so is any other file. Generated game names are not personal data, so a failure may name the edits against
that file's expected name (`field-other-1-edit:sub(8>o)@2`).

Recommended set, whose names together cover every glyph the API can generate (the letters of `baal chaos cows tz heralds
pvp`, the difficulty codes `n m h`, the dash and the digits 0 to 9): seven files,

- `maintainer-party-mmbaalh-19.png`
- `maintainer-party-mmchaosh-20.png`
- `maintainer-party-mmcowsh-38.png`
- `maintainer-party-mmtzh-47.png`
- `maintainer-party-mmheraldsh-56.png`
- `maintainer-party-mmpvpn-10.png`
- `maintainer-party-mmbaalm-99.png`

### In CI (recommended)

The five screenshots live in the repository as one AES-256 encrypted zip, `apps/agent/ocr-lab/real-prints.zip`
(`apps/agent/ocr-lab/README.md`: the exception, its limits, how to replace it). On every pull request that changes the
agent, the `ocr-real` workflow opens it on a Windows runner with the repository secret `OCR_PRINTS_PASSWORD`, runs
`ocr-check.exe` on it and deletes the extracted files. Read its log in the pull request's checks: PASS or FAIL per file,
the diagnostics for every region, and the job's status is the tool's exit code. Fork pull requests do not run it.

### Without installing anything

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
