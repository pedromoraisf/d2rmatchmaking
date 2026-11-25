# Incident 2026-11-24 — a pt-BR client cannot add characters

Status: open (closed by the F3 item `pt-br-select-screen`).

## Impact

With the game in pt-BR, the agent never recognises the character selection screen ("Tela: não reconhecida" in
window, borderless and full screen), so it reads no character cards and the site shows none: a new player with a
pt-BR client cannot queue. English works (the maintainer, 2026-11-24). No user was affected (nothing is launched).

## How it was found

The staging database was recreated empty (schema only) after a separate staging database incident handled in another
session. Testing the journey from the start, the character list stayed empty. Tempo agreed: in the 25 hours before, the
agent's `agent.vision.read` spans read `in_game`, `automap` and `unknown`, and never `character_select`.

## Causes

1. **No real pt-BR selection print.** `real-prints.zip` holds an English selection screen only, so `ocr-real` and
   `ocr-variations` (green on every reading PR) never saw a pt-BR one; the pt-BR words of the pack were added from
   other prints (`ddafd258`).
2. **Persisted data hid the failure.** Every earlier test used characters saved in the old staging database by
   earlier builds, so no journey needed the selection screen to be read again.
3. **The field step that covered it was waived.** The F2 runbook's step 6 (SCR-05, the pt-BR selection screen) was cut
   with the rest of the field runbook on 2026-11-24.

## Actions

| Action                                                                                                        | Owner      | State   |
| ------------------------------------------------------------------------------------------------------------- | ---------- | ------- |
| Two pt-BR selection prints (cards listed; difficulty popup) added to `real-prints.zip`                        | maintainer | pending |
| `ocr-check` takes a pt-BR selection print; fix under rule 14 (drawn fixture first, then the real-print proof) | runner     | F3      |
| Every journey check of a phase starts from an empty database (lesson)                                         | runner     | lesson  |
| Until fixed: play with the client in English                                                                  | maintainer | now     |
