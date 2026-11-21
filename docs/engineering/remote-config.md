# Remote configuration of the desktop agent

How the agent's remote configuration is served, what it may contain, and how to change or roll it back. The rules are
`.specs/features/remote-config/spec.md` (RCF-01…RCF-12). Every number below comes from the code named next to it.

## The file and where it lives

- **The served file**: `apps/api/src/modules/agents/config/agent-config.json`, one JSON document in the repository.
- **The schema**: `AgentConfig` (Zod) in `packages/contracts/src/http/agent-config.ts`, generated to
  `packages/contracts/json-schema/agent-config.json` and `openapi.json`.
- **The route**: `GET /v1/agents/config`. It answers an agent token only (a cookie, an unknown or revoked token, or no
  credential answers `401`). The body is the same for every agent and carries an `ETag` made of the version and a digest of
  the served bytes; a request with a matching `If-None-Match` answers `304`.
- **Validation**: the API reads and validates the file once at start (`loadAgentConfig`). A file that fails stops the
  start; it is also checked in CI. The file is closed (`.strict()`): an unknown field is refused. It is at most
  64 KiB (`AGENT_CONFIG_MAX_BYTES` = 65536).
- **Data only**: no field is a command, a path, a URL, a script, a key or a pattern (AGT-04).

## Fields and ranges

The API validates these ranges (`AGENT_CONFIG_RANGES`); the agent never reads them from the server. It clamps every number
into its own identical range (`Ranges` in `apps/agent/src-tauri/domain/src/remote_config.rs`). Every section and field is
optional; an absent or unreadable one keeps the built-in default.

| Field                     | Range (inclusive)   | Built-in default | Meaning                                                        |
| ------------------------- | ------------------- | ---------------- | -------------------------------------------------------------- |
| `version`                 | whole, 1…2147483647 | `0` (no file)    | Only grows. A served document starts at 1.                     |
| `cadence.demoteAfter`     | whole, 1…10         | 3                | Looks without a reading before the capture method is demoted   |
| `cadence.probeEvery`      | whole, 60…600       | 60               | Looks between two probes of the better capture method          |
| `cadence.rateWindow`      | whole, 10…600       | 60               | Window of looks the read rate is measured over                 |
| `cadence.lookIntervalMs`  | whole, 1000…10000   | 1000             | Milliseconds between two looks at the game                     |
| `thresholds.trackPad`     | whole, 8…48         | 24               | Padding in pixels of the reference client around the HUD track |
| `regions.hudBand`         | a region (below)    | built-in area    | Reading area of the HUD band                                   |
| `regions.automapArea`     | a region (below)    | built-in area    | Reading area of the automap                                    |
| `regions.partyArea`       | a region (below)    | built-in area    | Reading area of the Party panel                                |
| `phrases.<lang>.party`    | phrase (below)      | built-in word    | The Party panel's word; `<lang>` is `en` or `pt-BR`            |
| `phrases.<lang>.gameName` | phrase (below)      | built-in word    | The "Game Name" word                                           |
| `phrases.<lang>.password` | phrase (below)      | built-in word    | The "Password" word                                            |

- **A region** is `x`, `y`, `width`, `height`, fractions of the client. `x` and `y` are in 0…1; `width` and `height` are
  in 0.02…1; `x + width` and `y + height` must be at most 1. The agent takes a region only when all four are present, finite
  and inside the client with each side at least 0.02 (`REGION_MIN_SIDE`).
- **A phrase** is 1…40 characters (`AGENT_CONFIG_PHRASE_MAX`, `PHRASE_MAX_CHARS`) of ASCII letters, digits, spaces and the
  Latin-1 letters `À-ÖØ-öø-ÿ`, with at least one character that is not a space. No punctuation, so no pattern can be written.
- The built-in defaults equal the constants the agent had before the configuration existed (RCF-07), and they are pinned by
  tests. Today's file serves the same values, as `version` 1.

The agent's list of fields (`FIELDS` in the domain) is checked by a source-rule test: adding a field fails it until the
change is reviewed.

## A region never reads more than its default

A configured region is used only when it lies inside the client and covers no more pixels than the built-in area at that
client size; otherwise the built-in area is used (`configured_or` in `domain/src/layout.rs`, RCF-05 and RCF-09). The
comparison is integer arithmetic on pixel counts, so the boundary is exact. The look interval never goes under 1000 ms and
the probe cadence never under 60 looks, so no configuration makes the agent look more often or capture more than today.

## Raising the version

1. Edit `apps/api/src/modules/agents/config/agent-config.json`: change the fields **and** raise `version`. A version that
   does not grow is ignored by every agent that already holds it (equal: `unchanged`; lower: `stale`), even though the
   changed bytes change the `ETag`.
2. Run `pnpm test` (the API validates the file) and `pnpm format:check`.
3. Open a reviewed pull request. The change goes live with the API's next deploy, never by editing a server (ADR 032,
   factors III and V).

## Rolling back

There is no live switch. A rollback is a new commit and a release:

1. `git revert` the commit that changed the file, **then raise `version` above the one in production**. An agent never
   goes back to a lower or equal version, so a revert that restores the old version number is not applied.
2. Merge and deploy as above. Agents fetch the new document within six hours.

## What the agent does

- It fetches once it is paired and at start, then every six hours (`CHECK_EVERY`), and after an update that follows a
  `426`, with `If-None-Match` and the same bounded backoff as its other loops (1 s doubling to 60 s while the API does not
  answer; `RECONNECT_MIN`, `RECONNECT_MAX`).
- A newer valid version is applied at the next look of each loop with no restart, and kept as the last good one in
  `remote-config.json` in the agent's configuration directory (written whole or not at all).
- **When the API is down or answers badly, the agent keeps the last good configuration**: an unreachable API, a body that
  is not JSON, over 64 KiB or without a whole `version`, and a version that is not greater than the one it holds change
  nothing. With none stored it runs on the built-in defaults.
- At start it validates the stored file again; one that fails is deleted and the defaults apply. A stored file never
  outranks the server: the first valid document of a run is applied whatever its version.
- Each fetch is one span `agent.config.fetch` with `config.outcome` (`applied`, `unchanged`, `invalid`, `stale`,
  `unreachable`) and `config.version` only. The agent window and the heartbeat show the version it runs (`0` is the
  built-in defaults).
