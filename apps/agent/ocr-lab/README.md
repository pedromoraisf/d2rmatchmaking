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
- Never decrypt the zip into the repository or paste a screenshot, or what it shows, in an issue or a PR.

## Replacing the zip (maintainer)

1. Put the five screenshots, named as in `apps/agent/README.md`, in a folder (no subfolders).
2. With 7-Zip, add them to an archive: format **zip**, encryption method **AES-256**, password = the value of the
   repository secret `OCR_PRINTS_PASSWORD` (change the secret and the zip together if you want a new password). Tick
   nothing else; do not use ZipCrypto.
3. Name it `real-prints.zip` and commit it at `apps/agent/ocr-lab/real-prints.zip` (the pre-commit sensor checks it).
