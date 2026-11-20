# Screen recognition — Design

Short. The agent keeps its hexagonal shape (ADR 027): `adapters → core → domain`. Nothing here adds a crate, a route or
a contract field. The heartbeat's `screen` values are unchanged.

## Principle

A screen is recognised by **finding its words in a wide area of the client**, then remembering where they were. A fixed
box is only ever the first, cheapest guess. D2R does not scale its panels linearly across window, borderless and full
screen, nor across client heights (1033, 1045, 1056, 1080), so a box measured on one client misses on another (lessons,
"Agent reading").

## Modules and layers

| Layer   | File (`apps/agent/src-tauri/…`)                                      | Change                                                                                                          |
| ------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| domain  | `domain/src/layout.rs`                                               | `ScreenRegion::HudBand` (resumed), an automap area and a wider Party area; `screen_region` resolves them        |
| domain  | `domain/src/anchors.rs`                                              | `find_hud`, `find_hud_in_variants` (resumed); `find_automap`; the Party search over the wider area              |
| domain  | `domain/src/hud_track.rs` (new, resumed)                             | `HudTracker`: pure search-then-track state machine; generalised to a `Tracker` for the HUD and the automap line |
| domain  | `domain/src/character_screen.rs`                                     | `read_screen` order: automap, fixed Life, list marker, band search; the band is read only without the list      |
| domain  | `domain/src/language.rs`, `resources/lang/en.json`                   | `MANA` word (resumed); `brazilian_party()`: the pt-BR Party words, tried when the English ones find no panel    |
| core    | `core/src/screen_reader.rs`                                          | owns the trackers behind a `Mutex`; asks `TextReader::read_line_variants` for the planned area                  |
| core    | `core/src/party.rs`                                                  | finds the panel in the wider area (SCR-04)                                                                      |
| adapter | `adapters/…` (Windows OCR), `xtask/src/*_fixture.rs`                 | no change to OCR; `xtask` draws the per-mode fixtures                                                           |
| tests   | `tests/acceptance/steps/screen-recognition.steps.ts`, headless agent | fixture screens with a sidecar, as `characters-reading` does                                                    |

All of these are reading modules (`scripts/agent/reading-modules.json`) except `hud_track.rs`, which is new. `hud_track.rs`
decides what is read, so it joins the list. That edit touches the sensor file `scripts/agent/reading-modules.json`, so
the gate asks the maintainer (see tasks.md, "Gate prompts").

## Ports

No new port. `TextReader` already has `read`, `read_lines` and `read_line_variants`; the tracker only decides the area
passed to them. The domain stays pure: `HudTracker::next(width, height) → Search(area) | Track(area) | None` and
`record(found, width, height)`. No clock, no randomness, no I/O. The core holds the mutable state behind a `Mutex`
(`PoisonError::into_inner`), as the work-in-progress branch does.

## Data

- Regions are fractions of the reference client (1920×1033), scaled with the client height; the band spans the full
  client width (`HUD_BAND_TOP` = 775 of 1033, the bottom quarter). A tracked box pads the found line by `TRACK_PAD`
  (24 reference pixels), clamped to the client.
- The tracker forgets a find made at another client size (resize, mode change) and searches again.
- No persistence. Nothing about a frame or a line of text is stored or sent; the heartbeat carries the `screen` enum only.

## Search order per frame (cheap first)

1. Automap: tracked box, else the wider area (SCR-03).
2. In game: the fixed "Life:" box (kept), else the tracked box, else the band (SCR-01, SCR-02).
3. Character list marker "Create New"; then the popup and cards as today (SCR-05).
4. Otherwise `Unknown`.

The band is not read while the list marker is present (the list never shows the HUD), which keeps the selection screen
from reading the band and removes a false positive source.

## Proof strategy

- **Unit tests** in each module, written first and pinning the current behaviour before any change (rule 14).
- **Drawn fixtures** by `xtask` (`draw-fixture`): in-game and automap at 1920×1033, 1920×1045, 1920×1056 and 1920×1080
  with the HUD at the positions measured on the maintainer's prints, per mode. They carry a sidecar (`hudBand`), so the
  headless agent reads them on Linux. No capture is ever committed.
- **Real prints**: `ocr-real` (12 prints once #87 is in) and `ocr-variations`, in CI on Windows. Real prints are read from
  a local path on the Mac with `ocr-lab` / `xtask`; they are never extracted into the repository.
- **Field**: the maintainer's matrix on the 0.3.0 agent (brief input 8d).

## Telemetry (rule 10, SCR-09)

Spans and counters with fixed vocabulary only; the existing `agent.vision.read` span gains attributes:

| Attribute           | Values                                              |
| ------------------- | --------------------------------------------------- |
| `vision.screen`     | `in_game`, `automap`, `character_select`, `unknown` |
| `vision.search`     | `track`, `band`, `fixed`, `none`                    |
| `vision.area_class` | `box`, `band`, `panel` (never coordinates)          |

A counter `agent.vision.screen_reads` with `screen` and `search`. No read text, no pixel, no coordinates. Adding
attributes changes the existing span tests by adding assertions, never loosening one (brief input 6).

## ADRs

ADR 010 (read-only capture), ADR 027 (hexagonal agent), ADR 026 (mutation scope; no mutation in gates) and AGENTS.md
rule 14. No new ADR: a choice against one of them is an escalation.
