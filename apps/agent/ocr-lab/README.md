# OCR lab: the real screenshots

This folder holds exactly one file, `real-prints.zip`: the maintainer's five real Diablo II: Resurrected screenshots (and
any `maintainer-party-<gamename>.png` of a generated game name) that the OCR check reads (`apps/agent/README.md`, "The Party panel check"). The zip is **AES-256 encrypted**. Its
password is the repository secret `OCR_PRINTS_PASSWORD`, never written anywhere in the repository.

## Why this exists

The reading of the Party panel and the selection screen must be proven on real screenshots, and the maintainer's PC
cannot run the check (Windows App Control blocks the unsigned tool; Windows Sandbox failed to install). The `ocr-real`
workflow (`.github/workflows/ocr-real.yml`) opens the zip on a Windows runner, runs `ocr-check.exe` on it and deletes the
extracted files.

## The exception and its limits

The rule is "never commit a game screenshot" (`AGENTS.md`, `scripts/check-images.mjs`). The maintainer allowed one
exception on 2026-11-11 (`.specs/phases/F1/decisions.md`): the encrypted zip, and nothing else.

- `scripts/check-encrypted-zip.mjs` (Lefthook pre-commit and the harness tests in CI) refuses any zip here with an
  entry that is not AES-256 encrypted, and any file here other than a zip and this README.
- No PNG/JPG capture is ever committed; `check-images.mjs` is unchanged.
- The workflow never runs for a fork's pull request, gives the password to the extract step only, never uploads the
  extracted folder and deletes it at the end.
- The Actions log is public: `ocr-check` prints, per file, `PASS` or `FAIL` with a reason that names no character name
  and no game name (counts, and whether each card field settled). `--show-reads` prints those reads too; it is for
  local runs only (`ocr-check.exe --show-reads <folder>`, or `D2RMM_OCR_SHOW_READS=1` with `scripts/agent/ocr-check.mjs`)
  and the workflow never passes it.
- Never decrypt the zip into the repository or paste a screenshot, or what it shows, in an issue or a PR.

## The variations job

The second job of the workflow, `ocr-variations`, measures how robust the reading is. For each of the five screenshots it
makes about 500 deterministic variations in memory (seed fixed in `ocr_variations::run::SEED`), reads each one with the same
production reading and verdict rules as the check above, and classifies the result: **correct**, **refused** (the agent said
it could not read it, so it posts nothing) or **wrong** (a false read, the worst outcome). The families are: `scale` (ten
heights from 720 to 2160), `aspect` (4:3 crop, 21:9 pad), `tone` (gamma, brightness, contrast, saturation, colour
temperature), `blur` (gaussian and unsharp), `jpeg` (quality 90 to 30), `noise`, `quantise` (RGB565), `shift` (1 to 3 px),
`border` (cropped or added edges) and `combo` (seeded mixes of two or three families). Run locally on Windows with
`ocr-check.exe --variations [--combos N] [--summary out.md] [--json out.json] <folder>`.

- It is held to the quality ratchet (context `ocr`): after the run the job copies the JSON to `reports/ocr-variations.json`
  and runs `quality-collect` and `quality-ratchet --context ocr`. The metrics `ocr.variations.wrong` (ceiling) and
  `ocr.variations.correct` (floor) read `/supported/wrong` and `/supported/correct`, the totals without the
  `unsupported-size` refusals (the log's `Supported totals:` line). More wrong reads or fewer correct ones fail the job; the
  five-file `ocr-real` check is untouched.
- Privacy limits: a variation lives in memory only while it is read, then it is dropped; none is written to disk, uploaded or
  committed. The log, the job summary and the JSON hold counts, family names, variant ids (`gamma-0.8`, `combo-017`),
  screenshot file names, outcome classes and reason classes only: no pixel and no read text beyond what follows. The summary
  lists the reason classes of the refused and of the wrong reads per screenshot, most frequent first.
- What a reason may print, because it is public already: a card read that differs names the value read for its title,
  class and level (game vocabulary: `card0-title=None`, `card0-level=86`); a name is only `name=card0`, `name=card1` (it
  equals an expected card's name, committed in `src/ocr_check.rs`) or `name=other`, never the text. A Party field one or
  two edits from the room name appends the edit operations against the Party room name `PARTY_ROOM_NAME` (committed in the
  same file), `field-other-1-edit:sub(o>0)@9`, with characters outside `[a-z0-9 ]` printed as `?`. For the Party frames
  the JSON also has `field_variants`, the class of each OCR variant's reading in reader order (nearest 3x, bilinear 3x,
  nearest 4x, bilinear 4x, nearest 5x, bilinear 5x): `match`, `masked`, `blank`, `1-edit`, `2-edits` or `far`; the summary
  counts them per variant for the revealed screenshots. Nothing else read is ever printed. The selection screens have no
  per-variant card results (`FrameReading` holds only the settled cards), so they have no such table.
- The only artifact is `ocr-variations.json` (14 days). The extracted screenshots are never uploaded and are deleted at the
  end of the job.

## Replacing the zip (maintainer)

1. Put the five screenshots, named as in `apps/agent/README.md`, in a folder (no subfolders), plus the optional
   `maintainer-party-<gamename>.png` frames of generated game names (recommended: `mmbaalh-19`, `mmchaosh-20`,
   `mmcowsh-38`, `mmtzh-47`, `mmheraldsh-56`, `mmpvpn-10`, `mmbaalm-99`, which cover every glyph the API can generate). Each
   is checked against the name in its file name; the variations job counts them in the same totals and tables, and a
   reason's edit operations are then printed against that file's expected name (a generated name is public).
2. With 7-Zip, add them to an archive: format **zip**, encryption method **AES-256**, password = the value of the
   repository secret `OCR_PRINTS_PASSWORD` (change the secret and the zip together if you want a new password). Tick
   nothing else; do not use ZipCrypto.
3. Name it `real-prints.zip` and commit it at `apps/agent/ocr-lab/real-prints.zip` (the pre-commit sensor checks it).
