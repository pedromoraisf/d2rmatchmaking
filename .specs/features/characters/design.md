# Characters read by the agent — Design

Short by intent (ADR 029). Relies on ADR 003/004 (layers), 007 (SSE), 009/020 (contracts), 010 (read-only agent),
011 (agent token), 027 (agent hexagonal crates).

## Flow

```text
agent: consent? ─no→ nothing
        └─yes→ every 1 s while D2R runs: FrameSource.capture() → classify screen
                 ├─ CHARACTER_SELECT → read cards → derive difficulties → POST /v1/me/characters (only when changed)
                 └─ screen kept for the next heartbeat (15 s, plus one immediate heartbeat when the screen changes)
API:   POST /v1/me/characters (agent token) → Identity.recordCharacters → identity.characters
                 → outbox CharactersRecorded → stream hub → site event `characters.updated`
site:  GET /v1/me/characters on load and on `characters.updated`
```

## Contracts (`packages/contracts`, then `pnpm contracts:openapi` and `cargo run -p xtask -- contracts`)

- `Screen`: `UNKNOWN | CHARACTER_SELECT | IN_GAME | AUTOMAP_OPEN` (additive).
- `CharacterClass`: `amazon | assassin | barbarian | druid | necromancer | paladin | sorceress | warlock`.
- `Era`: `classic | lod | rotw` (glossary). `Ladder`: `sc-ladder | sc-nonladder | hc-ladder | hc-nonladder` (glossary).
- `CharacterName`: 2 to 15 characters, letters with at most one `-` or `_`, not first or last (D2R's rule).
- `CharacterReading`: `{ name, class, level (1..99), ladder, era, unlockedDifficulties }`, where
  `unlockedDifficulties` is exactly `[normal]`, `[normal, nightmare]` or `[normal, nightmare, hell]`.
- `RecordCharactersRequest`: `{ characters: CharacterReading[] }`, 1 to 24 items, names unique within the request.
- `CharacterView`: a `CharacterReading` plus `readAt`. `MyCharactersResponse`: `{ characters: CharacterView[] }`.
- Site stream event `characters.updated` (no body beyond the type; the site refetches). AsyncAPI regenerated.

## API (Identity module)

| Layer       | What                                                                                                                                                                                                                    |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| domain      | `domain/character/character.ts`: `Character` value with the rules above; `unlockedDifficulties` checked                                                                                                                 |
| application | port `CharacterRepository` (`upsertMany(accountId, characters, readAt)`, `listByAccount`); use cases `recordCharacters` (one unit of work, emits `CharactersRecorded {accountId}` to the outbox) and `listMyCharacters` |
| adapters    | `postgres/postgres-character-repository.ts`; `http/routes.ts`: `POST /v1/me/characters` behind the agent guard (accountId from `AgentsPort`), `GET /v1/me/characters` behind the session guard                          |
| platform    | stream projection maps `CharactersRecorded` to `characters.updated` for that account's site stream                                                                                                                      |
| migration   | `0006_identity_characters` (after identity-bnet's `0004` and `0005`): `identity.characters (id, account_id, name, class, level, ladder, era, unlocked_difficulties text[], read_at, unique (account_id, name))`         |

Spans: `identity.record-characters` (attributes `d2r.characters.count`), `identity.list-characters`. No names.

## Site

`features/identity/CharacterList.tsx` (list + empty state), labels for class, ladder, era and difficulties in
`shared/labels.ts`, refetch on `characters.updated`. `PresencePanel` gains the two new screen labels.

## Agent (ADR 027 crates)

| Crate            | What                                                                                                                                                                                                                                                                                                                                   |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| domain           | `characters.rs`: `Card`, `Title` table → unlocked difficulties (CHR-07); `screen.rs`: screen rules from region reads; layout regions per resolution in `vision.rs` (Batch 2)                                                                                                                                                           |
| core             | ports `FrameSource` (`capture() -> Option<Rgba>`) and `ConsentStore` (`load() -> bool`, `save(bool)`); loop `watch_screen` (1 s tick, consent and game-running gates, screen state shared with `beat`, char-select reading, post only when the set of cards changed); gateway method `post_characters`                                 |
| adapters         | HTTP: `post_characters`; regenerated contract types                                                                                                                                                                                                                                                                                    |
| app (src-tauri)  | `adapters/window_capture.rs`: find the top-level window of the D2R process id, `PrintWindow(PW_RENDERFULLCONTENT)` of its client area into an in-memory RGBA buffer (with `toolhelp.rs` and `windows_ocr.rs`, the only three files allowed `unsafe`); consent in the local settings file; Tauri commands `get_consent` / `set_consent` |
| ui               | `views/ConsentView.tsx`: what is captured, what is sent, what never leaves the PC; Allow / Withdraw; en + pt-BR                                                                                                                                                                                                                        |
| headless example | `--consent on                                                                                                                                                                                                                                                                                                                          | off`, stdin `consent on | off`and`show <png>`; the text reader returns the sidecar `<png>.json` (`{ "<region>": "<text>" }`) |

OCR language: Windows OCR `en-US` stays the engine; parsing is diacritic-insensitive and uses English and Portuguese
dictionaries for classes, titles and markers (Batch 2, pinned by the fixtures).

## Safety (ADR 010)

The capture names only the D2R window by its process id; it never captures the screen, another window or the desktop,
never sends a frame or a crop, and starts only after consent. `scripts/test/agent-architecture.test.mjs` keeps the
domain free of I/O; the security reviewer reads `window_capture.rs`.
