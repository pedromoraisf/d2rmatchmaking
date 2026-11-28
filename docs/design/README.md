# Design canvas (source)

The source of the design canvas drawn on 2026-11-28, before F3. It is the visual reference for the product described
in [`docs/product/direction-2026-11.md`](../product/direction-2026-11.md). Nothing under `apps/` or `packages/` imports
these files; they are a record, not a build input.

- Live canvas: <https://claude.ai/artifact/NSA2uCwtGDwJGDP8tgU7DG> (private to the maintainer).
- Format: a Claude Design canvas. `canvas/project/canvas.json` is the index (one frame per artboard) and each
  `*.dc.html` is one artboard, a self-contained page with its own small script.
- State: what was published on 2026-11-28 (version `1795888885-d15a`).

## Artboards

| File              | Screen                                                                   |
| ----------------- | ------------------------------------------------------------------------ |
| `Main.dc.html`    | 01 Brand board: mascot, variations, palette, type                        |
| `Home.dc.html`    | 02 Home (landing)                                                        |
| `Rooms.dc.html`   | 03 Open rooms with filters: D2RMM rooms and rooms spotted in game        |
| `Room.dc.html`    | 03b Room, after Join or after accepting a quick match                    |
| `Match.dc.html`   | 04 Ready check, quick match only (mounts `Rooms.dc.html` blurred behind) |
| `InGame.dc.html`  | 05 In game: a run in progress                                            |
| `Ranking.dc.html` | 06 Ranking                                                               |
| `Profile.dc.html` | 07 Profile and characters                                                |

`canvas/variants/Home.with-video.dc.html` is the Home with a `<video>` in the hero instead of the still image and the
animated overlay. It was never published.

## Assets

The artboards point at files stored in the canvas by address (`/_blob/<id>`). The files themselves are not here:
`scripts/check-images.mjs` allows raster images only where the product owns them, and three of these files are made
from official Diablo II art, which this repository never carries (`AGENTS.md`, "Never do"). All of them are kept on
the maintainer's machine, outside the repository, in `d2rmm-design/canvas/assets/`.

| Address in the artboards                  | File                             | Made from                                      |
| ----------------------------------------- | -------------------------------- | ---------------------------------------------- |
| `/_blob/9cd99226fca0d8adc6528c37fac72fe2` | `d2rmm-mascot-primary-1024.png`  | `docs/brand/logo/svg/d2rmm-mascot-primary.svg` |
| `/_blob/5c5fbf763163410258c30bcaaa382e35` | `d2rmm-mascot-wink-512.png`      | `d2rmm-mascot-wink.svg`                        |
| `/_blob/bdb3a9ca576992e5b68a37ec651cd570` | `d2rmm-mascot-rage-512.png`      | `d2rmm-mascot-rage.svg`                        |
| `/_blob/0cbeefca3fb5591f2fca72e17270a7cf` | `d2rmm-mascot-gold-512.png`      | `d2rmm-mascot-gold.svg`                        |
| `/_blob/11d9289375f06dad07c575c69eeaa255` | `d2rmm-mascot-nosticker-512.png` | `d2rmm-mascot-nosticker.svg`                   |
| `/_blob/2b8f0e835bc2931d48cc642742093bc3` | `d2rmm-mark-mono-cream-512.png`  | `d2rmm-mark-mono-cream.svg`                    |
| `/_blob/989226a4eb04c1f813eb0658ac1ad0e6` | `d2rmm-app-icon-512.png`         | `d2rmm-app-icon.svg`                           |
| `/_blob/b54cc6322a65ac5ca3511cc30976420c` | `hero-still-wide.jpg`            | Official Sorceress and Druid class art         |
| `/_blob/47f897dcf920d0c53b075f210f558ef7` | `d2rmm-hero-poster.jpg`          | Same, first frame of the loop (variant only)   |
| `/_blob/5772d4f0a084834f34480026b7a690b8` | `d2rmm-hero-loop-1280.webm`      | Same, 10 s loop (variant only)                 |

To rebuild the canvas somewhere else: create a new Design canvas, upload the asset files, replace each address above
with the one the upload returns, and publish the files of `canvas/project/` under `project/`.

## Logo

`docs/brand/logo/svg/` holds the eight vector masters of the mascot (version 0, not yet approved as the identity):
primary, wink, rage, gold, no sticker border, one colour in cream and in black, and the app icon. PNG exports up to
4096 px, the lockups with the wordmark and the script that generates the variations stay on the maintainer's machine.
