# Agent Skeleton Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, the walk, check_proofs, the Verifier and the screens sub-agent).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

Project rules for every task of this feature:

- Execute starts only after `api-web-skeleton` is merged into `phase/F0` and this branch is rebased on it (AD-035), and
  only on a machine with a stable Rust toolchain (`rustup`), `cargo-nextest` and `cargo-deny`. Until then this file is
  approved and waiting.
- Run each task's gate as its own Bash call, with nothing before or after it:
  `node scripts/attempt.mjs run --feature agent-skeleton --step T<n> -- "<gate command>"`.
- `$M` in a gate stands for `--manifest-path apps/agent/src-tauri/Cargo.toml`; write it out in full.
- Code under `#[cfg(windows)]` (toolhelp, OCR, keyring) is checked locally with `node scripts/agent/win-check.mjs`,
  which runs `cargo clippy --locked --manifest-path apps/agent/src-tauri/Cargo.toml --target x86_64-pc-windows-msvc --all-targets --all-features -- -D warnings` inside the Linux container
  `apps/agent/src-tauri/win-check.Dockerfile` (clang-cl, lld, llvm tools and the Windows SDK/CRT headers from `xwin`;
  check only, nothing installed on the host — AD-071). Its tests run in the CI `agent` job on `windows-latest`, and its
  checks cite that job.
- Editing `.github/workflows/*`, `packages/config/eslint.mjs`, `CODEOWNERS` and the sensor configs named in a task's
  `Where` is the task itself, under the phase delegation `harness-edits`; it only adds rules.
- The updater key pair, the `release` environment and its secrets (`TAURI_SIGNING_PRIVATE_KEY`,
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, `SIGNPATH_API_TOKEN`), the variables `API_BASE_URL` and `SIGNPATH_ENABLED`, and
  importing `.github/rulesets/agent-tags.json` are maintainer actions: T26 and T30 raise them as escalations with these
  exact names and continue with what does not need them.

---

**Design**: `.specs/features/agent-skeleton/design.md`
**Status**: Approved
**Approved**: 2026-10-31 - user: "aprovo specs e tasks da F0 que passarem nos gates automáticos; delego sub-agents, harness-edits e local-merge-phase-branch" (delegated via .specs/phases/F0/brief.md)
**Mutations**: 3
**Build**: `pnpm --filter @d2rmm/agent build; cargo clippy --locked --manifest-path apps/agent/src-tauri/Cargo.toml --all-targets -- -D warnings; pnpm typecheck; pnpm lint`

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec - confirm before Execute. Guidelines found: `AGENTS.md` (How to test, Rust conventions), `docs/engineering/testing.md` (`cargo nextest`, `insta`, `cargo-mutants` on agent core), `docs/adr/014-testing-and-mutation.md`, `docs/adr/023-bdd-acceptance.md`, `.github/workflows/ci.yml` (`agent` job), `.github/workflows/nightly.yml` (`agent-mutation`). The maintainer confirmed the `# not-scenario` exemptions (decisions.md, "Ponto 2: A").

| Code Layer                                                                                               | Required Test Type                                                            | Coverage Expectation                                                                                                       | Location Pattern                                                      | Run Command                                                                                      |
| -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Core rules (pairing, heartbeat, stream, fusion, observations, updates, api_client, view, secret, config) | unit + integration (`cargo nextest`, paused Tokio clock, fake API) + mutation | All branches, 1:1 to the ACs, every boundary (2 s, 15 s, 45 s n/a, 6 h, 1–60 s backoff, 2 unused codes, Retry-After clamp) | `core/src/**` (`#[cfg(test)]`), `core/tests/*.rs`                     | `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent-core` |
| Contract generator                                                                                       | unit (`cargo nextest`)                                                        | Generated file current; secret fields typed `Secret`                                                                       | `xtask/tests/*.rs`                                                    | `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -p xtask`            |
| App crate, portable parts (config, fixture flag, version)                                                | unit (`cargo nextest`)                                                        | Each rule and its rejection                                                                                                | `src/**` (`#[cfg(test)]`)                                             | `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent`      |
| App crate, Windows adapters (toolhelp, OCR, keyring)                                                     | unit, `#[cfg(windows)]`, CI `agent` job                                       | Round-trip or real read per adapter; never skipped on Windows                                                              | `src/adapters/*.rs`                                                   | CI `agent` job (`windows-latest`)                                                                |
| Contracts (TypeScript)                                                                                   | unit (Vitest)                                                                 | File set, dialect, version                                                                                                 | `packages/contracts/src/*.test.ts`                                    | `pnpm --filter @d2rmm/contracts test`                                                            |
| Agent UI                                                                                                 | unit (Vitest + Testing Library, jsdom)                                        | Each `AgentView` state's text in en and pt-BR; key parity; language rule                                                   | `apps/agent/src/**/*.test.ts(x)`                                      | `pnpm --filter @d2rmm/agent test`                                                                |
| Harness scripts, static config and workflow tests                                                        | harness unit (`node:test`)                                                    | Each rule fails on its fixture; clean passes                                                                               | `scripts/test/*.test.mjs`                                             | `pnpm test:harness`                                                                              |
| Read-only boundary fixtures                                                                              | CI steps through `expect-failure.mjs`                                         | Each fixture fails with its specific id                                                                                    | `apps/agent/src-tauri/boundary-fixtures/*`                            | CI `agent` job                                                                                   |
| Site note                                                                                                | unit (Vitest) + acceptance (playwright-bdd)                                   | Both languages                                                                                                             | `apps/web/src/app/*.test.tsx`, `tests/acceptance/steps/site.steps.ts` | `pnpm --filter @d2rmm/web test`; acceptance with `--tags "@AGS-30"`                              |
| Cargo/Tauri configuration files, workflows' YAML                                                         | none                                                                          | - (covered by the static tests above)                                                                                      | -                                                                     | build gate                                                                                       |

## Gate Check Commands

> Generated from codebase - confirm before Execute.

| Gate Level   | When to Use                       | Command                                                                                                                                                                                                                                                          |
| ------------ | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rust quick   | Core / xtask / portable app tasks | `cargo fmt --manifest-path apps/agent/src-tauri/Cargo.toml --all -- --check && cargo clippy --locked --manifest-path apps/agent/src-tauri/Cargo.toml --all-targets -- -D warnings && cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml` |
| Rust Windows | `#[cfg(windows)]` adapter tasks   | `node scripts/agent/win-check.mjs` (AD-071)                                                                                                                                                                                                                      |
| TS quick     | Contracts / UI / web tasks        | `pnpm --filter <workspace> typecheck && pnpm --filter <workspace> test`                                                                                                                                                                                          |
| Harness      | Static tests, workflows, scripts  | `pnpm test:harness`                                                                                                                                                                                                                                              |
| Build        | Config-only tasks and at the end  | `pnpm --filter @d2rmm/agent build && cargo clippy --locked --manifest-path apps/agent/src-tauri/Cargo.toml --all-targets --all-features -- -D warnings && pnpm typecheck && pnpm lint && pnpm format:check`                                                      |

---

## Execution Plan

Phases run in order; tasks within a phase run in order. Batches: 1 = Phases 1–2, 2 = Phase 3, 3 = Phase 4,
4 = Phase 5, 5 = Phases 6–7.

### Phase 1: Contracts, workspace and shells

```
T1 → T2 → T3 → T4
```

### Phase 2: Read-only boundary and CI

```
T5 → T6 → T7 → T8
```

### Phase 3: Core foundations

```
T9 → T10 → T11 → T12 → T13
```

### Phase 4: Core behaviours

```
T14 → T15 → T16 → T17 → T18 → T19 → T20
```

### Phase 5: App adapters

```
T21 → T22 → T23 → T24 → T25 → T26 → T27
```

### Phase 6: Agent window

```
T28
```

### Phase 7: Release and site

```
T29 → T30 → T31 → T32 → T33
```

---

## Task Breakdown

#### Phase 1: Contracts, workspace and shells

### T1: Emit the agent JSON Schemas for typify

**What**: In `documents.ts` emit the agent JSON Schemas with `z.toJSONSchema(schema, { target: 'draft-7' })`, add `claim-request.json` (`ClaimRequest`) and `agent-event-room-assigned.json`, drop `agent-stream-event.json`, bump `@d2rmm/contracts` to `0.1.0`, regenerate with `pnpm contracts:openapi` and commit every output (design.md § Contracts changes, AD-060).
**Where**: `packages/contracts/src/documents.ts`
**Depends on**: None
**Reuses**: api-web-skeleton's generator and `documents.test.ts`
**Requirement**: AGS-03, AGS-23

**Done when**:

- [x] `documents.test.ts`: every agent schema declares `http://json-schema.org/draft-07/schema#`; the file set is exactly `pairing-code`, `claim-request`, `claim`, `heartbeat`, `assignment`, `observation`, `agent-event-room-assigned` (test `writes the draft-07 agent schemas`); the observation schema has no field holding image data
- [x] Gate check passes: `pnpm --filter @d2rmm/contracts typecheck && pnpm --filter @d2rmm/contracts test && pnpm contracts:check`
- [x] Test count: no existing contracts test removed; ≥ 2 new tests

**Tests**: unit
**Gate**: quick

---

### T2: Create the Cargo workspace with core and xtask

**What**: `apps/agent/src-tauri/Cargo.toml` (workspace members `.`, `core`, `xtask`; `exclude = ["boundary-fixtures"]`; package `d2rmm-agent`), `core/` (`d2rmm-agent-core`, `#![forbid(unsafe_code)]`, no features, no Tauri dependency), `xtask/` (lib + bin), committed `Cargo.lock`, `.gitignore` for `target/`.
**Where**: `apps/agent/src-tauri/Cargo.toml`
**Depends on**: T1
**Reuses**: CI `agent` job detection (`Cargo.toml` present)
**Requirement**: AGS-01

**Done when**:

- [x] `core/src/lib.rs` has a smoke test `core_builds`; `cargo metadata` shows no `tauri*` package in `d2rmm-agent-core`'s dependency closure
- [x] Gate check passes: `cargo fmt --manifest-path apps/agent/src-tauri/Cargo.toml --all -- --check && cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent-core -p xtask`

**Tests**: unit
**Gate**: quick

---

### T3: Bootstrap the agent window UI with i18n

**What**: Vite + React 19 in `apps/agent` (`index.html`, `src/main.tsx`, `vite.config.ts`, Vitest with jsdom), `src/shared/language.ts` (pt-BR when `navigator.language` starts with `pt`, else en), `src/shared/locales/{en,pt-BR}.json` with every agent string of the spec, `build` into `apps/agent/dist`; extend the `i18next/no-literal-string` `files` glob in `packages/config/eslint.mjs` to `apps/agent/src/**/*.tsx` with a case in `packages/config/test/rules.test.ts`.
**Where**: `apps/agent/src/shared/language.ts`
**Depends on**: T2
**Reuses**: `apps/web` i18n bootstrap (api-web-skeleton T38), T5 ESLint rule of api-web-skeleton
**Requirement**: AGS-31, AGS-32

**Done when**:

- [x] Tests: `en` and `pt-BR` hold the same keys (test `agent en and pt-BR hold the same keys`); `pt-BR`, `pt` → pt-BR, `fr-FR`, `en-US` → en (test `follows the Windows display language`); `rules.test.ts` reports a literal in `apps/agent/src/views/x.tsx` (test `reports a literal string in an agent component`)
- [x] Gate check passes: `pnpm --filter @d2rmm/agent typecheck && pnpm --filter @d2rmm/agent test && pnpm --filter @d2rmm/agent build && pnpm --filter @d2rmm/config test`
- [x] Test count: ≥ 5 tests pass

**Tests**: unit
**Gate**: quick

---

### T4: Create the hardened Tauri app shell

**What**: `tauri.conf.json` (`version: "../package.json"`, `frontendDist: "../dist"`, empty `beforeBuildCommand`, no `build.features`, CSP of design.md, `withGlobalTauri: false`, one window `main`), `build.rs` (`AppManifest::commands(&["get_new_code"])`), `capabilities/main.json` and `permissions/` (design.md § App shell), `src/main.rs` with `#![deny(unsafe_code)]`, `on_navigation` allow-list, location-only panic hook; `scripts/test/agent-source-rules.test.mjs` with the `tauri.conf.json` and capability rules; `CODEOWNERS` entries of design.md § Data Models.
**Where**: `apps/agent/src-tauri/tauri.conf.json`
**Depends on**: T3
**Reuses**: T3 `dist`
**Requirement**: AGS-01, AGS-04

**Done when**:

- [x] `agent-source-rules.test.mjs`: version path, CSP, `withGlobalTauri: false`, empty `beforeBuildCommand`, no `build.features` (test `tauri.conf.json keeps the hardened shell`); capability `main` lists exactly the three permissions (test `the window gets only listen, unlisten and get_new_code`); `d2rmm-agent-core` has no Tauri dependency (test `core has no tauri dependency`)
- [x] App test `version_comes_from_package_json`: the generated context's version equals `apps/agent/package.json`'s
- [x] Gate check passes: `pnpm --filter @d2rmm/agent build && pnpm test:harness && cargo clippy --locked --manifest-path apps/agent/src-tauri/Cargo.toml --all-targets -- -D warnings && cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent`
- [x] Test count: ≥ 4 new tests pass

**Tests**: unit
**Gate**: quick

---

#### Phase 2: Read-only boundary and CI

### T5: Write the deny and clippy configuration and expect-failure

**What**: `deny.toml` (`[bans]` list and `wildcards = "deny"`, `[sources]`, `[advisories]`, `[licenses]` allow-list of design.md § Read-only boundary), `clippy.toml` (`disallowed-types` both `Command`s; `disallowed-methods` `Toolhelp32ReadProcessMemory`, `danger_accept_invalid_certs`, `danger_accept_invalid_hostnames`), and `scripts/agent/expect-failure.mjs <id> -- <cmd>` with `scripts/test/expect-failure.test.mjs`.
**Where**: `apps/agent/src-tauri/deny.toml`
**Depends on**: T4
**Reuses**: harness `node:test` conventions, `scripts/lib/count-reporter.mjs`
**Requirement**: AGS-21, AGS-22

**Done when**:

- [x] `expect-failure.test.mjs`: passes when the command fails and prints the id (test `expect-failure passes only on the named failure`); fails when the command succeeds; fails when it fails without the id (a build error)
- [x] `cargo deny --locked check` and clippy are green on the clean workspace (the task records in tasks.md any ban adjusted after `cargo tree` shows a transitive need)
- [x] Gate check passes: `pnpm test:harness && cargo deny --manifest-path apps/agent/src-tauri/Cargo.toml --locked check && cargo clippy --locked --manifest-path apps/agent/src-tauri/Cargo.toml --all-targets -- -D warnings`
- [x] Test count: ≥ 3 new harness tests pass

**Tests**: unit
**Gate**: quick

---

### T6: Add the boundary fixtures

**What**: Standalone crates (own `[workspace]`) under `boundary-fixtures/`: `banned-dep` (depends on `sysinfo`), `unsafe-ffi` (an `extern "system"` call, with the app's lint header), `command-new` (`std::process::Command::new`), `toolhelp-read` (`Toolhelp32ReadProcessMemory`), each run against the real `deny.toml`/`clippy.toml` (design.md § Read-only boundary).
**Where**: `apps/agent/src-tauri/boundary-fixtures/`
**Depends on**: T5
**Reuses**: T5 configs and `expect-failure.mjs`
**Requirement**: AGS-21, AGS-22

**Done when**:

- [x] Locally, `expect-failure.mjs` passes for `banned-dep` (`banned`), `unsafe-ffi` (`unsafe_code`) and `command-new` (`disallowed_types`); `toolhelp-read` is checked with `--target x86_64-pc-windows-msvc` (`disallowed_methods`)
- [x] Gate check passes: `node scripts/agent/expect-failure.mjs banned -- cargo deny --config apps/agent/src-tauri/deny.toml --manifest-path apps/agent/src-tauri/boundary-fixtures/banned-dep/Cargo.toml check bans && node scripts/agent/expect-failure.mjs unsafe_code -- cargo clippy --manifest-path apps/agent/src-tauri/boundary-fixtures/unsafe-ffi/Cargo.toml -- -D warnings && node scripts/agent/expect-failure.mjs disallowed_types -- cargo clippy --manifest-path apps/agent/src-tauri/boundary-fixtures/command-new/Cargo.toml -- -D warnings`

**Tests**: unit
**Gate**: quick

---

### T7: Add the source rules

**What**: Extend `scripts/test/agent-source-rules.test.mjs`: the app's `windows` features equal the allow-list; `allow(unsafe_code)` appears only in `src/adapters/toolhelp.rs` and `src/adapters/windows_ocr.rs`; those two files reference only their allow-listed `windows::` paths; `#[instrument]` always has `skip_all`; no `fixture-read` in any `default` feature — each rule with a failing fixture under `scripts/test/fixtures/agent-rules/`.
**Where**: `scripts/test/agent-source-rules.test.mjs`
**Depends on**: T6
**Reuses**: T4 test file
**Requirement**: AGS-15, AGS-21, AGS-22, AGS-33

**Done when**:

- [x] Tests named `windows features stay on the allow-list`, `unsafe is allowed only in the two adapters`, `unsafe adapters reference only allowed windows paths`, `instrument always skips arguments`, `fixture-read is never a default feature` — each fails on its fixture and passes on the repo
- [x] Gate check passes: `pnpm test:harness`
- [x] Test count: ≥ 10 new harness tests pass (rule + fixture each)

**Tests**: unit
**Gate**: quick

---

### T8: Extend the CI agent job

**What**: The `agent` job of `ci.yml` per design.md § CI `agent` job (SHA-pinned new steps, UI build, pinned `cargo-nextest` and `cargo-deny`, clippy and nextest with default and `--all-features`, `cargo deny --locked check`, the four fixtures through `expect-failure.mjs`), plus `scripts/test/agent-ci.test.mjs` asserting it.
**Where**: `.github/workflows/ci.yml`
**Depends on**: T7
**Reuses**: existing `agent` job, `detect` outputs
**Requirement**: AGS-02, AGS-21, AGS-22

**Done when**:

- [x] `agent-ci.test.mjs`: the steps in order, both feature sets, `--locked`, the four fixture ids, every `uses:` of the job pinned by a 40-char SHA (test `the agent job runs fmt, clippy, nextest, deny and the fixtures`)
- [x] Gate check passes: `pnpm test:harness`
- [x] Test count: ≥ 3 new harness tests pass

**Tests**: unit
**Gate**: quick

---

#### Phase 3: Core foundations

### T9: Generate the Rust contract types

**What**: `xtask` library generating `core/src/contracts/generated.rs` with `typify` + `prettyplease` from `packages/contracts/json-schema/*.json`, the secret-field post-processing to `Secret` (design.md § Contracts), `core/src/secret.rs` (`Secret`: `***` Debug/Display, `Zeroize`, `expose`, `serialize_with` helper), and `xtask/tests/contracts_are_current.rs`.
**Where**: `apps/agent/src-tauri/xtask/src/lib.rs`
**Depends on**: T8
**Reuses**: T1 schemas
**Requirement**: AGS-03, AGS-09

**Done when**:

- [x] Tests: `contracts_are_current` (regenerated == committed); `secret_fields_are_redacted` (`ClaimRequest`, `PairingCodeResponse`, `ClaimResponse` print `***` with `{:?}`); `secret_serializes_only_where_sent`
- [x] Gate check passes: `cargo fmt --manifest-path apps/agent/src-tauri/Cargo.toml --all -- --check && cargo clippy --locked --manifest-path apps/agent/src-tauri/Cargo.toml --all-targets -- -D warnings && cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -p xtask -p d2rmm-agent-core`
- [x] Test count: ≥ 3 new tests pass

**Tests**: unit
**Gate**: quick

---

### T10: Write the ports, clocks, ids, API base and view

**What**: `core/src/ports.rs` (all ports of design.md § Ports), `PausedWallClock`, `SequentialIds`, `core/src/config.rs` (`ApiBase::parse(url, AllowLoopbackHttp)`, `Config { version, api_base }`), `core/src/view.rs` (`AgentView` and its enums, serde camelCase).
**Where**: `apps/agent/src-tauri/core/src/ports.rs`
**Depends on**: T9
**Reuses**: T9 contracts
**Requirement**: AGS-04, AGS-12

**Done when**:

- [x] Tests: `https://` accepted; `http://127.0.0.1` accepted only with `AllowLoopbackHttp`, `http://example.com` always refused (test `api base must be https outside loopback`); `PausedWallClock` advances with `tokio::time::advance` (test `wall clock follows paused time`); `AgentView` serialises in camelCase
- [x] Gate check passes: `cargo fmt --manifest-path apps/agent/src-tauri/Cargo.toml --all -- --check && cargo clippy --locked --manifest-path apps/agent/src-tauri/Cargo.toml --all-targets -- -D warnings && cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent-core`
- [x] Test count: ≥ 5 new tests pass

**Tests**: unit
**Gate**: quick

---

### T11: Write telemetry init and the capture support

**What**: `core/src/telemetry.rs` (`init(Mode)`: one subscriber, OpenTelemetry layer with W3C propagator and no exporter, release filter) and `core/tests/support/capture.rs` (log and span capture for tests).
**Where**: `apps/agent/src-tauri/core/src/telemetry.rs`
**Depends on**: T10
**Reuses**: none
**Requirement**: AGS-12

**Done when**:

- [x] Tests: a span opened under `init(Mode::Test)` yields a valid W3C `traceparent` (test `spans produce a traceparent`); the capture layer records span names and fields
- [x] Gate check passes: `cargo fmt --manifest-path apps/agent/src-tauri/Cargo.toml --all -- --check && cargo clippy --locked --manifest-path apps/agent/src-tauri/Cargo.toml --all-targets -- -D warnings && cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent-core`
- [x] Test count: ≥ 2 new tests pass

**Tests**: unit
**Gate**: quick

---

### T12: Write the fake API server

**What**: `core/tests/support/fake_api.rs`: an `axum` server implementing pairing code, claim, heartbeat, assignment, observations and the SSE stream in memory, validating every request body against its JSON Schema (`jsonschema` dev-dependency), with scripted answers (202, 410, 429 with or without `Retry-After`, 401, 426, 5xx, refused connection) and a request log (headers included).
**Where**: `apps/agent/src-tauri/core/tests/support/fake_api.rs`
**Depends on**: T11
**Reuses**: T1 schemas
**Requirement**: AGS-23

**Done when**:

- [x] `core/tests/fake_api.rs`: a body that breaks a schema is answered 400 and logged as invalid; scripted answers come back in order; the SSE endpoint streams events with ids
- [x] Gate check passes: `cargo fmt --manifest-path apps/agent/src-tauri/Cargo.toml --all -- --check && cargo clippy --locked --manifest-path apps/agent/src-tauri/Cargo.toml --all-targets -- -D warnings && cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent-core`
- [x] Test count: ≥ 3 new tests pass

**Tests**: integration
**Gate**: quick

---

### T13: Write the API client

**What**: `core/src/api_client.rs` per design.md § API client: operations, `ApiError` mapping, child span `agent.http.<operation>` with `traceparent` and `X-Agent-Version`, sensitive `Authorization`, contract bodies only, `Retry-After` clamped to [1 s, 60 min], room ids as UUID.
**Where**: `apps/agent/src-tauri/core/src/api_client.rs`
**Depends on**: T12
**Reuses**: T10 config, T11 telemetry, T12 fake API
**Requirement**: AGS-12, AGS-23, AGS-35

**Done when**:

- [x] `core/tests/api_client.rs` against the fake API: every request carries `X-Agent-Version` equal to the config version and a valid `traceparent` (test `every_request_carries_version_and_traceparent`); each status maps to its `ApiError`; `Retry-After: 0` → 1 s and `999999` → 60 min (test `retry_after_is_clamped`); request bodies validate against their schemas and are only the four request types (test `sends_only_contract_request_types`)
- [x] Gate check passes: `cargo fmt --manifest-path apps/agent/src-tauri/Cargo.toml --all -- --check && cargo clippy --locked --manifest-path apps/agent/src-tauri/Cargo.toml --all-targets -- -D warnings && cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent-core`
- [x] Test count: ≥ 8 new tests pass

**Tests**: integration
**Gate**: quick

---

#### Phase 4: Core behaviours

### T14: Write the pairing state machine

**What**: `core/src/pairing.rs` per design.md § Pairing (AD-050, AD-058).
**Where**: `apps/agent/src-tauri/core/src/pairing.rs`
**Depends on**: T13
**Reuses**: T13 client, T10 ports and fakes
**Requirement**: AGS-05, AGS-06, AGS-07, AGS-08, AGS-34, AGS-35

**Done when**:

- [x] `core/tests/pairing.rs` (paused clock, fake API, fake token store), tests named: `shows_code_with_minutes_left` (5 → … → 1, rounded up), `claims_every_two_seconds_until_token`, `keeps_claiming_on_202`, `stores_token_and_shows_paired`, `new_code_after_410_or_expiry`, `unauthorized_deletes_token_and_repairs`, `save_failure_requests_a_new_code`, `pauses_after_two_unused_codes` (and "Get a new code" requests one code and resets), `pairing_success_resets_the_unused_count`, `waits_retry_after_on_429` (120 s, and 60 min without the header; no "Get a new code" meanwhile), `retries_code_request_every_15s_when_unreachable`
- [x] Gate check passes: `cargo fmt --manifest-path apps/agent/src-tauri/Cargo.toml --all -- --check && cargo clippy --locked --manifest-path apps/agent/src-tauri/Cargo.toml --all-targets -- -D warnings && cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent-core`
- [x] Test count: ≥ 11 new tests pass

**Tests**: integration
**Gate**: quick

---

### T15: Write the heartbeat loop

**What**: `core/src/heartbeat.rs` per design.md § Heartbeat (AD-031, AD-055).
**Where**: `apps/agent/src-tauri/core/src/heartbeat.rs`
**Depends on**: T14
**Reuses**: T13 client, `ProcessSource` fake
**Requirement**: AGS-10, AGS-11

**Done when**:

- [x] `core/tests/heartbeat.rs`: beats at 15 s and 30 s, none at 14.9 s; body valid against the schema with `running: false`, then `true` when the fake snapshot contains `d2r.EXE` (test `heartbeat_every_15s_with_running_flag`); a 503 and a refused connection show `Unreachable` and the next beat is on schedule, a success shows `Connected` (test `heartbeat_failure_shows_unreachable_then_connected`)
- [x] Gate check passes: `cargo fmt --manifest-path apps/agent/src-tauri/Cargo.toml --all -- --check && cargo clippy --locked --manifest-path apps/agent/src-tauri/Cargo.toml --all-targets -- -D warnings && cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent-core`
- [x] Test count: ≥ 4 new tests pass

**Tests**: integration
**Gate**: quick

---

### T16: Write the stream and assignment handling

**What**: `core/src/stream.rs` per design.md § Stream and assignment (AD-059; `StreamEffect` only; SSE bounds).
**Where**: `apps/agent/src-tauri/core/src/stream.rs`
**Depends on**: T15
**Reuses**: T13 client, T12 fake SSE
**Requirement**: AGS-13, AGS-14, AGS-15

**Done when**:

- [x] `core/tests/stream.rs`: on paired/start/reconnect the assignment is fetched before the stream opens with the token (test `fetches_assignment_then_streams`); reconnect delays 1, 2, 4 … 60 s, reset after 60 s open, `retry:` ignored (test `reconnect_backoff_doubles_to_60s`); latest `room.assigned` wins (test `latest_room_assigned_wins`); unknown event names, invalid payloads, a 33-char game name and a 64 KiB+1 event are ignored or close the connection, the state unchanged (test `unknown_or_invalid_events_are_ignored`); `Last-Event-ID` is sent and bounded
- [x] Gate check passes: `cargo fmt --manifest-path apps/agent/src-tauri/Cargo.toml --all -- --check && cargo clippy --locked --manifest-path apps/agent/src-tauri/Cargo.toml --all-targets -- -D warnings && cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent-core`
- [x] Test count: ≥ 6 new tests pass

**Tests**: integration
**Gate**: quick

---

### T17: Write vision and fusion

**What**: `core/src/vision.rs` (`read_game_name` with the built-in 1920×1080 region, first line, span `agent.vision.read`) and `core/src/fusion.rs` (exact match after trim + lower-case, AD-052).
**Where**: `apps/agent/src-tauri/core/src/fusion.rs`
**Depends on**: T16
**Reuses**: `TextReader` and `IdGenerator` fakes
**Requirement**: AGS-16, AGS-17, AGS-18, AGS-20

**Done when**:

- [x] Tests: the fake reader receives the region for 1920×1080 and the first line is returned (test `reads_first_line_of_region`); `mmbaalh-12` and `MMBAALH-12 ` for expected `mmbaalh-12` yield one `GAME_NAME_SEEN` with normalised value, room, run, clamped confidence, new key, capture time (test `exact_match_yields_one_observation`); `mmbaalh-13`, `mmbaalh-1`, ` mmbaalh-12x` and no assignment yield none (test `other_names_yield_none`); the observation serialises with no image field (test `observation_carries_no_image`)
- [x] Gate check passes: `cargo fmt --manifest-path apps/agent/src-tauri/Cargo.toml --all -- --check && cargo clippy --locked --manifest-path apps/agent/src-tauri/Cargo.toml --all-targets -- -D warnings && cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent-core`
- [x] Test count: ≥ 5 new tests pass

**Tests**: unit
**Gate**: quick

---

### T18: Write the observation sender

**What**: `core/src/observations.rs` per design.md § Vision and fusion, Sender (AD-051; drop on 401/426).
**Where**: `apps/agent/src-tauri/core/src/observations.rs`
**Depends on**: T17
**Reuses**: T13 client, T12 fake API
**Requirement**: AGS-19

**Done when**:

- [x] `core/tests/observations.rs`: 503s retried at 1, 2, 4, 8 s with the same idempotency key, 5 attempts then dropped and counted (test `retries_with_same_key_at_1_2_4_8`); a 401 or 426 drops pending retries; an assignment change keeps them
- [x] Gate check passes: `cargo fmt --manifest-path apps/agent/src-tauri/Cargo.toml --all -- --check && cargo clippy --locked --manifest-path apps/agent/src-tauri/Cargo.toml --all-targets -- -D warnings && cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent-core`
- [x] Test count: ≥ 3 new tests pass

**Tests**: integration
**Gate**: quick

---

### T19: Write the update schedule and the 426 gate

**What**: `core/src/updates.rs` per design.md § Updates (AD-049).
**Where**: `apps/agent/src-tauri/core/src/updates.rs`
**Depends on**: T18
**Reuses**: `UpdateChecker` fake
**Requirement**: AGS-24, AGS-26, AGS-27

**Done when**:

- [x] Tests: checks at start, 6 h, 12 h and right after a 426 (test `update_checks_at_start_every_6h_and_after_426`); signature, download and manifest failures keep the version, show `Failed`, check at the next slot (test `update_failure_keeps_version_and_retries`); after a 426 the fake API receives no heartbeat, claim, stream or observation request until `Installed` (test `upgrade_required_stops_api_loops`)
- [x] Gate check passes: `cargo fmt --manifest-path apps/agent/src-tauri/Cargo.toml --all -- --check && cargo clippy --locked --manifest-path apps/agent/src-tauri/Cargo.toml --all-targets -- -D warnings && cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent-core`
- [x] Test count: ≥ 3 new tests pass

**Tests**: integration
**Gate**: quick

---

### T20: Wire the runtime

**What**: `core/src/runtime.rs` (`Runtime::start`, `Handle::get_new_code`, `Handle::read_once`, `AgentView` published through `StateSink`) and the end-to-end secret test.
**Where**: `apps/agent/src-tauri/core/src/runtime.rs`
**Depends on**: T19
**Reuses**: T14–T19, T11 capture
**Requirement**: AGS-09, AGS-12

**Done when**:

- [x] `core/tests/runtime.rs`: a pair → heartbeat → 401 cycle on the fake API with capture on finds neither the token nor the claim secret in any log line, span name or field, and the token is written only through `TokenStore` (test `no_secret_in_logs_or_spans`); the six loop spans appear with their names (test `loop_spans_are_named`)
- [x] Gate check passes: `cargo fmt --manifest-path apps/agent/src-tauri/Cargo.toml --all -- --check && cargo clippy --locked --manifest-path apps/agent/src-tauri/Cargo.toml --all-targets -- -D warnings && cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent-core`
- [x] Test count: ≥ 2 new tests pass

**Tests**: integration
**Gate**: quick

---

#### Phase 5: App adapters

### T21: Write the app config and HTTP client

**What**: `src/config.rs` (build-time `D2RMM_API_BASE`, release refuses non-HTTPS or missing; version from `package_info`) and `src/adapters/http.rs` (`reqwest` client: `https_only` outside debug loopback, no redirects, timeouts of design.md).
**Where**: `apps/agent/src-tauri/src/config.rs`
**Depends on**: T20
**Reuses**: T10 `ApiBase`
**Requirement**: AGS-04, AGS-12

**Done when**:

- [x] Tests: release-mode config refuses a missing or `http://` base (test `release_requires_https_api_base`); the client follows no redirect (a 302 from a local test server is returned as is); the version passed to core equals `package.json`'s (test `version_comes_from_package_json` extended)
- [x] Gate check passes: `cargo fmt --manifest-path apps/agent/src-tauri/Cargo.toml --all -- --check && cargo clippy --locked --manifest-path apps/agent/src-tauri/Cargo.toml --all-targets -- -D warnings && cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent`
- [x] Test count: ≥ 3 new tests pass

**Tests**: unit
**Gate**: quick

---

### T22: Write the Credential Manager token store

**What**: `src/adapters/token_store.rs`: `KeyringTokenStore` (`keyring` `windows-native`, service `d2rmm-agent`, user `agent-token`) with a `#[cfg(windows)]` round-trip test under a unique service name it removes. First, the Windows check container (AD-071): `win-check.Dockerfile` — base `rust:<the host's stable version>-slim-bookworm` pinned by digest, `apt-get install --no-install-recommends` of only `clang`, `lld`, `llvm` (plus `nasm` only if `aws-lc-sys` asks for it), `clang-cl`/`lld-link`/`llvm-lib` links, the target and `clippy` via rustup, a pinned `xwin` release binary verified by SHA-256 that splats the x86_64 CRT and SDK into `/xwin` (`--accept-license`, AD-071) and is then deleted, `CC_`/`AR_`/`CFLAGS_x86_64_pc_windows_msvc` and the linker set by `ENV`; no other tools, no apt lists or caches left. `scripts/agent/win-check.mjs` builds the image (`d2rmm-win-check`, Docker's cache makes it a no-op once built) and runs the clippy command above in it: the repository mounted at `/work`, `CARGO_TARGET_DIR` and `CARGO_HOME` registry on named volumes (no Linux artefacts in the host `target/`), `--rm`, exit code passed through; its pure argument builder has `node:test` tests in `pnpm test:harness`.
**Where**: `apps/agent/src-tauri/src/adapters/token_store.rs`, `apps/agent/src-tauri/win-check.Dockerfile`, `scripts/agent/win-check.mjs`, `scripts/test/agent-win-check.test.mjs`
**Depends on**: T21
**Reuses**: T9 `Secret`
**Requirement**: AGS-06, AGS-09

**Done when**:

- [ ] Windows test `keyring_round_trip` (save, load, delete) compiles here and runs in the CI `agent` job
- [x] `win-check.mjs` tests (image name, mounts, volumes, the exact clippy command, exit code passed through) pass in `pnpm test:harness`
- [x] Gate check passes: `node scripts/agent/win-check.mjs && pnpm test:harness`

**Tests**: unit
**Gate**: quick

---

### T23: Write the toolhelp process source

**What**: `src/adapters/toolhelp.rs` (`#[allow(unsafe_code)]`, only the allow-listed `windows::` paths) per design.md § Heartbeat and process.
**Where**: `apps/agent/src-tauri/src/adapters/toolhelp.rs`
**Depends on**: T22
**Reuses**: T10 `ProcessSource`
**Requirement**: AGS-10

**Done when**:

- [ ] Windows test `toolhelp_lists_the_current_process` (the test binary's own name is listed) compiles here and runs in CI; the T7 source rules pass on the file
- [x] Gate check passes: `node scripts/agent/win-check.mjs && pnpm test:harness`

**Tests**: unit
**Gate**: quick

---

### T24: Write the OCR reader and the reference image

**What**: `src/adapters/windows_ocr.rs` (fixed en-US engine, `EngineUnavailable`), the fixture generator `xtask` command `draw-fixture` (vendored OFL font `apps/agent/fixtures/fonts/` with its licence) and the committed `apps/agent/fixtures/automap-game-name.png` (1920×1080, AD-047).
**Where**: `apps/agent/src-tauri/src/adapters/windows_ocr.rs`
**Depends on**: T23
**Reuses**: T17 vision, T9 xtask
**Requirement**: AGS-16, AGS-20

**Done when**:

- [ ] Windows test `ocr_reads_the_reference_image` reads `mmbaalh-12` through `read_game_name`; it fails (never skips) when the engine is unavailable; it compiles here and runs in CI
- [x] xtask test `fixture_is_reproducible` regenerates the PNG byte for byte
- [x] Gate check passes: `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -p xtask && node scripts/agent/win-check.mjs && pnpm test:harness`

**Tests**: unit
**Gate**: quick

---

### T25: Write the fixture-read trigger

**What**: `src/fixture_read.rs` behind the app feature `fixture-read` (flag `--read-fixture <png>`, PNG decode with `image`, `Handle::read_once` when an assignment is held); without the feature `main` rejects the flag with exit code 2 before Tauri starts (AD-057).
**Where**: `apps/agent/src-tauri/src/fixture_read.rs`
**Depends on**: T24
**Reuses**: T20 `Handle::read_once`
**Requirement**: AGS-33

**Done when**:

- [x] Test `flag_rejected_without_feature` (`cfg(not(feature = "fixture-read"))`): parsing `--read-fixture x` returns exit code 2; test `fixture_read_reads_once_with_assignment` (`cfg(feature = "fixture-read")`) with fakes
- [x] Gate check passes: `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent && cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent --features fixture-read && pnpm test:harness`
- [x] Test count: 2 new tests pass (one per feature set)

**Tests**: unit
**Gate**: quick

---

### T26: Write the updater adapter

**What**: `src/adapters/updater.rs` (`tauri-plugin-updater` from Rust only, default comparator) and the `plugins.updater` section and `bundle.createUpdaterArtifacts` of `tauri.conf.json`; the public key is the maintainer's — raise the escalation "updater key pair" and, until it arrives, keep `pubkey` as the literal `MAINTAINER_PUBKEY_PENDING`, which the static test reports as pending, not passing.
**Where**: `apps/agent/src-tauri/src/adapters/updater.rs`
**Depends on**: T25
**Reuses**: T19 `UpdateChecker`
**Requirement**: AGS-24, AGS-25

**Done when**:

- [ ] `agent-source-rules.test.mjs`: endpoint exactly `https://github.com/pedromoraisf/d2rmatchmaking/releases/latest/download/latest.json`, no `dangerousInsecureTransportProtocol`, a non-placeholder `pubkey` (test `updater checks the latest release with the embedded key` — red until the key arrives, so this task stays open and is reported as blocked by the escalation)
- [x] Gate check passes: `cargo clippy --locked --manifest-path apps/agent/src-tauri/Cargo.toml --all-targets -- -D warnings && pnpm test:harness`

**Tests**: unit
**Gate**: quick

---

### T27: Wire the app

**What**: `src/main.rs`: telemetry init, config, adapters, `Runtime::start`, `agent-state` event on every `AgentView`, command `get_new_code`.
**Where**: `apps/agent/src-tauri/src/main.rs`
**Depends on**: T26
**Reuses**: T20–T26
**Requirement**: AGS-05, AGS-34

**Done when**:

- [ ] Test `get_new_code_reaches_the_runtime` (command handler with a fake handle); `cargo build --locked` of the app succeeds with the UI built
- [ ] Gate check passes: `pnpm --filter @d2rmm/agent build && cargo clippy --locked --manifest-path apps/agent/src-tauri/Cargo.toml --all-targets --all-features -- -D warnings && cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent`
- [ ] Test count: ≥ 1 new test passes

**Tests**: unit
**Gate**: quick

---

#### Phase 6: Agent window

### T28: Write the pairing and status views

**What**: `views/PairingView.tsx`, `views/StatusView.tsx`, `shared/labels.ts` (`AgentView` → keys), `app/App.tsx` listening to `agent-state` and calling `get_new_code`.
**Where**: `apps/agent/src/views/`
**Depends on**: T27
**Reuses**: T3 i18n
**Requirement**: AGS-05, AGS-31, AGS-32, AGS-34, AGS-35

**Done when**:

- [ ] Tests: `ShowingCode` shows the 6 digits under "Pairing code", "Type this code on the site" and "Expires in 3 min" (test `pairing view shows the code and the minutes left`); `Paused` shows "Pairing paused" and "Get a new code", which calls the command; `RateLimited` shows "Too many codes requested. Try again later." and no button; `Paired`, `Unreachable`, `SaveFailed`, update `Failed`/`Required` and the room line each show their text; pt-BR shows "Código de pareamento" (test `pairing view in pt-BR`)
- [ ] Gate check passes: `pnpm --filter @d2rmm/agent typecheck && pnpm --filter @d2rmm/agent test && pnpm --filter @d2rmm/agent build`
- [ ] Test count: ≥ 8 new tests pass

**Tests**: unit
**Gate**: quick

---

#### Phase 7: Release and site

### T29: Write the release-please workflow

**What**: `.github/workflows/release-please.yml` per design.md § Release workflows (release PR CI dispatch, calling job with the `release_created` guard), `workflow_dispatch` added to `ci.yml`, `.github/rulesets/agent-tags.json`, `docs/engineering/releases.md` (runbook and fallback), and `scripts/test/release-workflows.test.mjs` for it.
**Where**: `.github/workflows/release-please.yml`
**Depends on**: T28
**Reuses**: `release-please-config.json`
**Requirement**: AGS-28

**Done when**:

- [ ] Tests: the guard on the calling job's `if:` with its own `contents: write` (test `release-please calls release-agent only when the agent was released`); the release-PR CI dispatch and `ci.yml` `workflow_dispatch`; SHA-pinned `uses:`; the agent is the only released package
- [ ] Gate check passes: `pnpm test:harness`
- [ ] Test count: ≥ 4 new harness tests pass

**Tests**: unit
**Gate**: quick

---

### T30: Write the release-agent build job

**What**: `.github/workflows/release-agent.yml` job `build` per design.md (three triggers, tag resolved and validated once, tag checkout, `environment: release`, ancestor check, `--ignore-scripts`, `fixture-read` absent before the build, tauri-action with the resolved tag, smoke check exit 2, fixed-name installer and `SHA256SUMS` without `--clobber`); raise the escalation for the `release` environment, its secrets and `API_BASE_URL`; tests in `release-workflows.test.mjs`.
**Where**: `.github/workflows/release-agent.yml`
**Depends on**: T29
**Reuses**: T29 test helpers
**Requirement**: AGS-28, AGS-33

**Done when**:

- [ ] Tests named `release-agent builds on tag push, call and dispatch`, `the tag is validated before use`, `fixture-read cannot reach a release build`, `the installer is published as D2RMatchMaking-setup.exe with SHA256SUMS`, `secrets live only in the release environment`
- [ ] Gate check passes: `pnpm test:harness`
- [ ] Test count: ≥ 5 new harness tests pass

**Tests**: unit
**Gate**: quick

---

### T31: Write the opt-in SignPath job

**What**: Job `sign` of `release-agent.yml` (variable-gated, `environment: release`, official SignPath action, `tauri signer sign`, regenerated `latest.json` signature, fixed-name copy and `SHA256SUMS`) and `scripts/agent/latest-json.mjs` with `node:test` tests.
**Where**: `scripts/agent/latest-json.mjs`
**Depends on**: T30
**Reuses**: T30 workflow
**Requirement**: AGS-29

**Done when**:

- [ ] Tests: `latest-json.mjs` replaces only the Windows signature and keeps the version; the `sign` job runs only when `SIGNPATH_ENABLED == 'true'` (test `SignPath signing runs only when enabled`); `--clobber` only in `sign`
- [ ] Gate check passes: `pnpm test:harness`
- [ ] Test count: ≥ 3 new harness tests pass

**Tests**: unit
**Gate**: quick

---

### T32: Add the SmartScreen note to the site

**What**: The note next to "Download the agent" in `apps/web/src/app/Layout.tsx`, its keys in `en.json` and `pt-BR.json`, and the step "the site shows {string} next to {string}" in `tests/acceptance/steps/site.steps.ts`.
**Where**: `apps/web/src/app/Layout.tsx`
**Depends on**: T31
**Reuses**: api-web-skeleton layout, locales and site steps
**Requirement**: AGS-30

**Done when**:

- [ ] Vitest: the note renders next to the link in en and pt-BR; both `@AGS-30` scenarios pass
- [ ] Gate check passes: `pnpm --filter @d2rmm/web test && pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen test --tags "@AGS-30" && pnpm --filter @d2rmm/acceptance exec playwright test --grep "@AGS-30"`

**Tests**: acceptance
**Gate**: quick

---

### T33: Scope mutation and record the residual risk

**What**: `apps/agent/src-tauri/.cargo/mutants.toml` with the design's `examine_globs`, and the Credential Manager residual risk in `SECURITY.md`.
**Where**: `apps/agent/src-tauri/.cargo/mutants.toml`
**Depends on**: T32
**Reuses**: nightly `agent-mutation`
**Requirement**: AGS-21

**Done when**:

- [ ] `agent-source-rules.test.mjs`: the mutants scope lists the seven core modules (test `mutation covers the core rule modules`)
- [ ] Gate check passes: `pnpm test:harness`
- [ ] Test count: ≥ 1 new harness test passes

**Tests**: unit
**Gate**: quick

---

## Checks

`$M` = `--manifest-path apps/agent/src-tauri/Cargo.toml`; Rust proofs are `cargo nextest run --locked $M -E 'test(<name>)'`, written out in full. Windows-only proofs cite the CI `agent` job.

**C1** - The core crate has no Tauri dependency and the UI builds from `@d2rmm/agent` (AGS-01, AC 1)
Proof: `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="core has no tauri dependency" scripts/test/agent-source-rules.test.mjs`

**C2** - The CI `agent` job runs fmt, clippy (`-D warnings`, both feature sets), nextest and `cargo deny` (AGS-02, AC 2)
Proof: `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="the agent job runs fmt, clippy, nextest, deny and the fixtures" scripts/test/agent-ci.test.mjs`

**C3** - The first `agent` job run on the maintainer's PR is green on `windows-latest` (AGS-02, AC 2)
Proof: walk - the maintainer pushes after the phase review; the PR checks page shows `agent` green (queued in `.specs/phases/F0/review.md`)

**C4** - The committed Rust contract types equal a fresh `typify` generation (AGS-03, AC 3)
Proof: `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -E 'test(contracts_are_current)'`

**C5** - The installed version comes from `apps/agent/package.json` and is the `X-Agent-Version` sent (AGS-04, AC 4)
Proof: `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -E 'test(version_comes_from_package_json)'`

**C6** - With no token the agent shows the 6 digits, the hint and "Expires in N min" rounded up (AGS-05, AC 1)
Proof: `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -E 'test(shows_code_with_minutes_left)'`

**C7** - The pairing view renders the code, the hint and the minutes left (AGS-05, AC 1)
Proof: `pnpm --filter @d2rmm/agent exec vitest run src -t "pairing view shows the code and the minutes left"`

**C8** - The agent claims every 2 s and keeps going on 202 (AGS-06, AC 2)
Proof: `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -E 'test(claims_every_two_seconds_until_token) | test(keeps_claiming_on_202)'`

**C9** - A returned token is stored, claiming stops and the view shows Paired (AGS-06, AC 3)
Proof: `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -E 'test(stores_token_and_shows_paired)'`

**C10** - The Credential Manager adapter saves, loads and deletes the token (AGS-06, AC 3)
Proof: walk - the CI `agent` job log on `windows-latest` shows `keyring_round_trip` passed

**C11** - A 410 claim or a passed expiry requests and shows a new code (AGS-07, AC 4)
Proof: `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -E 'test(new_code_after_410_or_expiry)'`

**C12** - Any 401 deletes the token and returns to a new pairing code (AGS-08, AC 5)
Proof: `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -E 'test(unauthorized_deletes_token_and_repairs)'`

**C13** - Neither the token nor the claim secret appears in any log or span over a pair → heartbeat → 401 cycle (AGS-09, AC 6)
Proof: `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -E 'test(no_secret_in_logs_or_spans)'`

**C14** - Generated secret fields print `***` (AGS-09, AC 6)
Proof: `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -E 'test(secret_fields_are_redacted)'`

**C15** - Heartbeats every 15 s with `running` following `D2R.exe` in the process snapshot (AGS-10, AC 1, 2)
Proof: `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -E 'test(heartbeat_every_15s_with_running_flag)'`

**C16** - The toolhelp adapter lists processes without opening a handle (AGS-10, AC 2)
Proof: walk - the CI `agent` job log shows `toolhelp_lists_the_current_process` passed and the `toolhelp-read` and `unsafe-ffi` fixtures failed with their ids

**C17** - A failed heartbeat shows "Can't reach the server", the next is on schedule, a success shows "Connected" (AGS-11, AC 3)
Proof: `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -E 'test(heartbeat_failure_shows_unreachable_then_connected)'`

**C18** - Every request carries `X-Agent-Version` and a valid `traceparent` (AGS-12, AC 4)
Proof: `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -E 'test(every_request_carries_version_and_traceparent)'`

**C19** - The six loop spans are opened with their names (AGS-12, AC 4)
Proof: `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -E 'test(loop_spans_are_named)'`

**C20** - On pairing, start and reconnect the agent fetches its assignment, then opens the stream (AGS-13, AC 1)
Proof: `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -E 'test(fetches_assignment_then_streams)'`

**C21** - Reconnects wait 1 s doubling to 60 s and reset after 60 s open (AGS-13, AC 1)
Proof: `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -E 'test(reconnect_backoff_doubles_to_60s)'`

**C22** - `room.assigned` becomes the current assignment and the latest wins (AGS-14, AC 2)
Proof: `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -E 'test(latest_room_assigned_wins)'`

**C23** - Unknown or invalid stream events leave the state unchanged (AGS-15, AC 3)
Proof: `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -E 'test(unknown_or_invalid_events_are_ignored)'`

**C24** - No code path can start a process or run FFI outside the two adapters (AGS-15, AC 4)
Proof: `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="unsafe is allowed only in the two adapters" scripts/test/agent-source-rules.test.mjs`

**C25** - The vision step reads the first line of the built-in region (AGS-16, AC 1)
Proof: `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -E 'test(reads_first_line_of_region)'`

**C26** - Windows OCR reads `mmbaalh-12` from the reference image (AGS-16, AC 1)
Proof: walk - the CI `agent` job log on `windows-latest` shows `ocr_reads_the_reference_image` passed

**C27** - An exact match after trim and lower-case yields one `GAME_NAME_SEEN` with its fields (AGS-17, AC 2)
Proof: `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -E 'test(exact_match_yields_one_observation)'`

**C28** - Any other name or no assignment yields no observation (AGS-18, AC 3)
Proof: `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -E 'test(other_names_yield_none)'`

**C29** - Failed posts are retried at 1, 2, 4, 8 s with the same idempotency key, 5 attempts (AGS-19, AC 4)
Proof: `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -E 'test(retries_with_same_key_at_1_2_4_8)'`

**C30** - An observation carries no image data (AGS-20, AC 5)
Proof: `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -E 'test(observation_carries_no_image)'`

**C31** - `cargo deny` fails when a banned crate is added (AGS-21, AC 1)
Proof: `node scripts/agent/expect-failure.mjs banned -- cargo deny --config apps/agent/src-tauri/deny.toml --manifest-path apps/agent/src-tauri/boundary-fixtures/banned-dep/Cargo.toml check bans`

**C32** - The app's `windows` features stay on the allow-list (AGS-21, AC 1)
Proof: `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="windows features stay on the allow-list" scripts/test/agent-source-rules.test.mjs`

**C33** - Clippy fails on `Command::new` (AGS-22, AC 2)
Proof: `node scripts/agent/expect-failure.mjs disallowed_types -- cargo clippy --manifest-path apps/agent/src-tauri/boundary-fixtures/command-new/Cargo.toml -- -D warnings`

**C34** - An FFI call outside the two adapters fails `unsafe_code` (AGS-22, AC 2)
Proof: `node scripts/agent/expect-failure.mjs unsafe_code -- cargo clippy --manifest-path apps/agent/src-tauri/boundary-fixtures/unsafe-ffi/Cargo.toml -- -D warnings`

**C35** - The agent sends only the four contract request types, each valid against its schema (AGS-23, AC 3)
Proof: `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -E 'test(sends_only_contract_request_types)'`

**C36** - Update checks run at start, every 6 h and right after a 426 (AGS-24, AC 1)
Proof: `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -E 'test(update_checks_at_start_every_6h_and_after_426)'`

**C37** - The updater reads the latest release's `latest.json` with the embedded key (AGS-24, AC 1)
Proof: `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="updater checks the latest release with the embedded key" scripts/test/agent-source-rules.test.mjs`

**C38** - An installed `v0.0.1` restarts as `v0.0.2` once that release exists (AGS-25, AC 2)
Proof: walk - the maintainer's Windows check in the phase review (brief Q4): install `D2RMatchMaking-setup.exe` v0.0.1, publish v0.0.2, see the agent restart as v0.0.2

**C39** - A failed update keeps the version, shows "Update failed — will retry" and checks at the next slot (AGS-26, AC 3)
Proof: `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -E 'test(update_failure_keeps_version_and_retries)'`

**C40** - After a 426 the agent shows "Update required" and sends no API request but the update check (AGS-27, AC 4)
Proof: `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -E 'test(upgrade_required_stops_api_loops)'`

**C41** - release-please keeps the release PR and calls `release-agent.yml` when the agent is released (AGS-28, AC 1)
Proof: `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="release-please calls release-agent only when the agent was released" scripts/test/release-workflows.test.mjs`

**C42** - `release-agent.yml` builds on a pushed `agent-v*` tag (and by call or dispatch) and publishes `latest.json` and `D2RMatchMaking-setup.exe` (AGS-28, AC 2)
Proof: `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="release-agent builds on tag push, call and dispatch" scripts/test/release-workflows.test.mjs`

**C43** - The first release after the maintainer's merge publishes the installer under the fixed name (AGS-28, AC 2)
Proof: walk - after the phase review, the release page of `agent-v0.0.1` lists `latest.json`, `D2RMatchMaking-setup.exe` and `SHA256SUMS` (queued in `.specs/phases/F0/review.md`)

**C44** - SignPath signs only when enabled; unsigned otherwise (AGS-29, AC 3)
Proof: `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="SignPath signing runs only when enabled" scripts/test/release-workflows.test.mjs`

**C45** - The site shows the SmartScreen note next to "Download the agent" in English and pt-BR (AGS-30, AC 4)
Proof: `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptance exec playwright test --grep "@AGS-30"`

**C46** - `en` and `pt-BR` of the agent hold the same keys (AGS-31, AC 1)
Proof: `pnpm --filter @d2rmm/agent exec vitest run src -t "agent en and pt-BR hold the same keys"`

**C47** - ESLint reports a literal string in an agent component (AGS-31, AC 1)
Proof: `pnpm --filter @d2rmm/config exec vitest run test/rules.test.ts -t "reports a literal string in an agent component"`

**C48** - The agent window follows the Windows display language (AGS-32, AC 2)
Proof: `pnpm --filter @d2rmm/agent exec vitest run src -t "follows the Windows display language"`

**C49** - The pairing view renders "Código de pareamento" in pt-BR (AGS-32, AC 2)
Proof: `pnpm --filter @d2rmm/agent exec vitest run src -t "pairing view in pt-BR"`

**C50** - A build without `fixture-read` rejects `--read-fixture` with exit code 2 (AGS-33, AC 6)
Proof: `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent -E 'test(flag_rejected_without_feature)'`

**C51** - No release path can enable `fixture-read` (AGS-33, AC 6)
Proof: `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="fixture-read cannot reach a release build" scripts/test/release-workflows.test.mjs`

**C52** - After two unused codes the agent pauses and "Get a new code" requests one code (AGS-34, AC 7)
Proof: `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -E 'test(pauses_after_two_unused_codes)'`

**C53** - Pairing success resets the unused-code count (AGS-34, AC 7)
Proof: `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -E 'test(pairing_success_resets_the_unused_count)'`

**C54** - A 429 on the code request waits `Retry-After` (60 min without it) and offers no new code meanwhile (AGS-35, AC 8)
Proof: `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -E 'test(waits_retry_after_on_429)'`

**C55** - `Retry-After` is clamped to [1 s, 60 min] (AGS-35, AC 8)
Proof: `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -E 'test(retry_after_is_clamped)'`

---

## Handoff

The feature's live state, written as it happens - a compaction gives no warning.

**Settled mid-build:** the maintainer confirmed the `# not-scenario` exemptions ("Ponto 2: A", 2026-10-30)
**Dispatched:** execute-batch-4 again (T26–T27) to a fresh feature-worker, 2026-10-31. Batch 1 done: T1–T8 (f58ecec, d250ad3, e26a081, 5eae324, 4d3123c, bc3b06f, 69ff9ed, 661142f). Batch 2 done: T9–T13 (cdd577b, d1d17b4, 3cfe186, 846be89, 9e3a946 + 40bcf2e). Batch 3 done: T14–T20 (4d99122, e143c3c, de99709, 0ebb89a, ce9375e, 146d9f3, 7554734). Batch 4 so far: T21 e0a940a, T22 377e962, T23 63b1bfa, T24 1167762 + ed6dd2d, T25 646a772; fixes 3a935d5 (AD-072), 5104db2 (ledger dedupe, cherry-picked to phase/F0 as 290c1cf)
**Walked:** none
**Replanned (execute-batch-1):** T6 stopped at failure 1/3 of `gate:agent-skeleton/T6`: cargo-deny 0.20.2 takes `--config` before `check`, not after (`error: unexpected argument '--config' found`). The T6 gate and the matching proof in `## Checks` now pass `--config` first (AD-063); the tasks gate re-ran. T1–T5 done (f58ecec, d250ad3, e26a081, 5eae324, 4d3123c); the four fixtures are written, uncommitted; T6–T8 then passed in a second dispatch of execute-batch-1

**Unblocked (execute-batch-4, escalated 2026-10-31):** T22, unit `gate:agent-skeleton/T22`, 2/3 failures, last retry kept. The Windows-target clippy gate cannot run on this macOS host: `reqwest` → `rustls` → `aws-lc-sys` 0.47 compiles C for `x86_64-pc-windows-msvc` and no Windows C headers (`stdlib.h`, `windows.h`) or MSVC sysroot exist here. T23–T33 depend on T22 in a chain, and observability-e2e and load-baseline depend on agent-skeleton, so the phase waits for the maintainer. T22 code (keyring token store) is written, uncommitted, never compiled for Windows; `apps/agent/fixtures/fonts/` (OFL Source Sans 3, for T24) is untracked. Maintainer chose Docker (2026-10-31): T22–T24 Windows gates replanned to `node scripts/agent/win-check.mjs` (AD-071); maintainer accepted the Microsoft SDK licence and reset `gate:agent-skeleton/T22` (2026-10-31)

**T26 (2026-10-31):** gate 1/3 (`serde_json` needed as a normal dependency by `generate_context!` once `plugins.updater` exists; fix written, not gated). The previous worker session exhausted its hook denials (3/3, a `cd … &&` chained before the wrapper) and stopped. T26 code is uncommitted. The pubkey test is a `node:test` `todo` (pending, not passing, as T26 says) and its Done-when box stays open until the maintainer's updater key pair arrives (escalation "updater key pair")
