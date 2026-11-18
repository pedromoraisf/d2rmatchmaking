# OCR lab: the real screenshots

This folder holds exactly one file, `real-prints.zip`: the maintainer's five real Diablo II: Resurrected screenshots
that the OCR check reads (`apps/agent/README.md`, "The Party panel check"). The zip is **AES-256 encrypted**. Its
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
makes about 150 deterministic variations in memory (seed fixed in `ocr_variations::run::SEED`), reads each one with the same
production reading and verdict rules as the check above, and classifies the result: **correct**, **refused** (the agent said
it could not read it, so it posts nothing) or **wrong** (a false read, the worst outcome). The families are: `scale` (ten
heights from 720 to 2160), `aspect` (4:3 crop, 21:9 pad), `tone` (gamma, brightness, contrast, saturation, colour
temperature), `blur` (gaussian and unsharp), `jpeg` (quality 90 to 30), `noise`, `quantise` (RGB565), `shift` (1 to 3 px),
`border` (cropped or added edges) and `combo` (seeded mixes of two or three families). Run locally on Windows with
`ocr-check.exe --variations [--combos N] [--summary out.md] [--json out.json] <folder>`.

- It is informational: the job does not fail on a wrong read, and the five-file `ocr-real` check is untouched.
- Privacy limits: a variation lives in memory only while it is read, then it is dropped; none is written to disk, uploaded or
  committed. The log, the job summary and the JSON hold counts, family names, variant ids (`gamma-0.8`, `combo-017`),
  screenshot file names and outcome classes only: no character name, no game name, no pixel.
- The only artifact is `ocr-variations.json` (14 days). The extracted screenshots are never uploaded and are deleted at the
  end of the job.

## Replacing the zip (maintainer)

1. Put the five screenshots, named as in `apps/agent/README.md`, in a folder (no subfolders).
2. With 7-Zip, add them to an archive: format **zip**, encryption method **AES-256**, password = the value of the
   repository secret `OCR_PRINTS_PASSWORD` (change the secret and the zip together if you want a new password). Tick
   nothing else; do not use ZipCrypto.
3. Name it `real-prints.zip` and commit it at `apps/agent/ocr-lab/real-prints.zip` (the pre-commit sensor checks it).
