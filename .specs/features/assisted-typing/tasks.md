# Assisted typing — Tasks

Spec: `spec.md` · Scenarios: `acceptance.feature` · Branch: `feat/F2-assisted-typing` → `phase/F2`

No design.md (Medium). Where each part goes (hexagonal, ADR 027):

- **Domain** (`apps/agent/src-tauri/domain/src/typing.rs`, new): `TypableName` (a name that passed
  `mm[a-z0-9]+-[0-9]{1,6}`, ≤ 32 characters; the only value the typer accepts, so a confirming key is unrepresentable)
  and `HotkeyChoice` (key, modifiers, the combination rules of AST-01). Pure, no I/O, no clock.
- **Core** (`core/src/fill_name.rs`, new): the use case. Ports added to `core/src/ports.rs`: `KeyTyper` (type one
  character of a `TypableName`), `ForegroundWindow` (is the foreground window D2R's), `ModifierState` (are the hotkey's
  modifiers down). The fill reads the held room and the last screen from `DeviceState`, the clock from the existing
  monotonic clock port, and asks the ports before every character. Fakes live in `core/src/fakes.rs`.
- **View** (`core/src/view.rs`): the window shows the two hotkeys and the last fill outcome.
- **App crate** (`src-tauri/src/`): `adapters/typing.rs` (SendInput, Unicode only), `adapters/foreground.rs` (foreground
  window → process id → `game_process_ids()` of `toolhelp.rs`), `adapters/hotkey_config.rs` (local file), and the
  registration in `app.rs` next to RDY-07's hotkey. Windows-only code is compiled and linted by CI; on Linux only the
  pure parts run.
- **Window UI** (`apps/agent/src/`) and **site hint** (`apps/web/src/features/matchmaking/ReadyCheckOverlay.tsx`).
- **Headless agent** (`adapters/examples/headless.rs`): in-memory fakes for the three ports, driven by the acceptance
  steps; a stdin command `fill` like RDY-07's `hotkey`.

Rules:

- **ADR 010, AGENTS.md rule 5.** Never add a `KeyTyper` method, a virtual key, a modifier, a mouse or clipboard event,
  or a way to type text that is not a `TypableName`. If a task seems to need one, stop and return it.
- Batch 2 starts only after the maintainer approves the sensor exception (AST-09, rule 4). Batch 1 touches no sensor.
- No reading module is touched (rule 14). The tasks never edit `scripts/agent/reading-modules.json`.
- No route, no contract change: the API is not touched, so the API integration suite is not part of any gate.
- `acceptance.feature` is never edited; its steps arrive in the same PR (lessons, 2026-11-11).
- Never commit a screenshot. In a fresh checkout run `pnpm --filter @d2rmm/agent build` once before the first push.
- No mutation in any gate (ADR 029); the nightly covers the new core and domain files.

## Batch 1 — domain, core, view, window, site, headless (no sensor touched)

- [x] T1 — Domain: `TypableName` and `HotkeyChoice` (AST-01, AST-02, AST-06). Unit tests: every name the server can
      generate (each activity × difficulty code × `n` of 1, 12, 999999) passes; `/exit`, uppercase, a space, a trailing
      `-`, an empty `n`, a seventh digit and 33 characters fail; a hotkey with no modifier, with Enter, NumpadEnter, Tab,
      Space or Escape as key, or equal to the other hotkey is refused with its reason. Gate:
      `cargo nextest run --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent-domain --lib && cargo clippy --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent-domain --all-targets -- -D warnings`
- [x] T2 — Core: the ports and `fill_name` (AST-02, AST-03, AST-04, AST-05, AST-07). With fakes: types exactly the name;
      nothing with no room; nothing when the name fails `TypableName`; nothing when another window has focus; stops after
      the character that lost focus; refuses on in-game and automap screens read within 5 s, allows an older or unknown
      read; waits for modifiers up to 1 s and then refuses; a press during a fill stops it; a press within 2 s of the end
      is ignored; stops when the room is dropped. Time comes from the paused clock, never a real wait. Gate:
      `cargo nextest run --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent-core --lib && cargo clippy --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent-core --all-targets -- -D warnings`
- [x] T3 — Core view: hotkeys and the last fill outcome in `AgentView` (AST-01, AST-08); the outcome is a closed enum
      (`typed`, `stopped`, `no-room`, `no-focus`, `game-running`, `keys-held`, `refused`) and carries no text. Unit tests
      on the view's JSON. Gate:
      `cargo nextest run --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent-core --lib`
- [x] T4 — Core: one span event per fill with the outcome and no name, text or key (AST-10). Unit tests with the
      in-memory exporter, including that no attribute value equals the game name. Gate:
      `cargo nextest run --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent-core --lib`
- [x] T5 — Window UI: both hotkeys with a field to change each, the refusal reason, and the fill status line, with the
      "press Enter in the game" reminder, in English and pt-BR (AST-01, AST-08, AST-10). Component tests. Gate:
      `pnpm --filter @d2rmm/agent exec vitest run && pnpm --filter @d2rmm/agent lint`
- [x] T6 — Site: the accept-hotkey hint says Ctrl+Shift+A by default and that the agent can change it, in English and
      pt-BR (AST-10). Update `ReadyCheckOverlay.test.tsx` for the new text, never loosen another assertion. Gate:
      `pnpm --filter @d2rmm/web exec vitest run src/features/matchmaking && pnpm --filter @d2rmm/web lint`
- [x] T7 — Headless agent and acceptance steps: fakes for the three ports, a `fill` stdin command, and
      `tests/acceptance/steps/assisted-typing.steps.ts` for every `@AST-` scenario. Gate:
      `pnpm exec turbo run test:acceptance -- --grep @AST-`

## Batch 2 — Windows adapters and sensors (after the maintainer approves the exception)

- [x] T8 — Sensors (AST-09): add `Win32_UI_Input_KeyboardAndMouse` to the `windows` features and to
      `WINDOWS_FEATURE_ALLOW_LIST`; add the typing adapter to the unsafe adapters with its exact path allow-list
      (`SendInput`, `INPUT`, `INPUT_KEYBOARD`, `KEYBDINPUT`, `KEYEVENTF_UNICODE`, `KEYEVENTF_KEYUP`, `GetAsyncKeyState`,
      `VK_CONTROL`, `VK_SHIFT`, `VK_MENU`); add the source rules (no other file names `SendInput`, `KeyboardAndMouse` or
      `GetAsyncKeyState`; the adapter names no other virtual key, no mouse or hardware input type, no other key-event
      flag) each with a fixture under `scripts/test/fixtures/agent-rules/` it must reject. `clippy.toml` keeps its bans;
      the adapter alone carries a file-level `#![allow(clippy::disallowed_methods)]` (written in T9). `deny.toml` gains no
      crate. Gate: `node --test scripts/test/agent-source-rules.test.mjs`
- [x] T9 — App crate, Windows only: `adapters/typing.rs` (`SendInput`, one down and one up `KEYEVENTF_UNICODE` event
      per character, wVk 0, about 15 ms apart; its pure part builds the event list and is unit-tested everywhere:
      for every name the events are exactly Unicode scan packets for its characters), `adapters/foreground.rs`
      (`GetForegroundWindow` → `GetWindowThreadProcessId` → `game_process_ids()`) and the modifier-state adapter. The
      `windows::` paths stay inside the allow-list of T8. Gate (CI builds the Windows crate):
      `cargo nextest run --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent --lib && cargo clippy --manifest-path apps/agent/src-tauri/Cargo.toml --all-targets -- -D warnings && cargo deny --manifest-path apps/agent/src-tauri/Cargo.toml --locked check`
- [x] T10 — App crate: the hotkey registration for the fill key next to RDY-07's, registered exactly while a room is
      held (`sync_hotkey`'s pattern, tested with the fake registrar), the local `hotkey_config` file and its Tauri
      command in `capabilities/main.json` (one new command, nothing else), and the press handler that runs `fill_name`
      off the main thread (AST-01, AST-07). Gate: same as T9.
- [x] T11 — Docs and the maintainer's check: `apps/agent/README.md` (what typing does and never does, the default
      hotkeys), `docs/engineering/delivery.md` is not touched; the PR description lists the check on the preview channel
      installer: fill the real Game Creator on normal, nightmare and hell names, press Enter by hand, confirm the agent
      never does, and try the refusals (Alt-Tab away, in-game, keys held). Gate:
      `pnpm format:check && pnpm specs:check && pnpm test:harness`

## Batch 3 — copy instead of typing (brief revision 1)

- [x] T12 — Remove the typing: the fill hotkey, `fill_name`, `adapters/typing.rs`, `SendInput`/`GetAsyncKeyState`, the
      `Win32_UI_Input_KeyboardAndMouse` feature and the AST-09 allow-list entries; tighten the source rules (AST-13) with a
      fixture each. Remove the tests that proved the withdrawn requirements together with their requirements (the brief
      revision withdraws them; no other test changes). Keep RDY-07's accept hotkey and AST-08's diagnostics.
      Gate: `pnpm test:harness && CARGO clippy --all-targets -- -D warnings && CARGO nextest run`
- [x] T13 — Core: a `Clipboard` port and `copy_room_name` (AST-11): once per assigned run, only a `TypableName`; unit tests
      with a fake port (copied once, a new run copies once more, a refused name never written, a failed write reported).
      Gate: `CARGO nextest run -p d2rmm-agent-core --lib`
- [ ] T14 — Adapter and sensor (AST-14): one clipboard adapter file, write-only; the source rule with fixtures. If it needs a
      new crate or `windows` feature, the gate asks the maintainer; record the answer in `decisions.md`.
      Gate: `pnpm test:harness && CARGO clippy --all-targets -- -D warnings`
- [x] T15 — Window and view (AST-12, AST-10): the copied line, "copy again", the refusal and failure lines, en and pt-BR;
      the span event per copy. Gate: `pnpm --filter @d2rmm/agent-ui test` and `CARGO nextest run -p d2rmm-agent-core --lib`
- [x] T16 — Headless agent and acceptance steps for the new scenarios (fake clipboard, `copy-again` stdin command); run
      `pnpm exec turbo run test:acceptance -- --grep @AST-`. Gate: that command
- [x] T17 — Docs: `apps/agent/README.md` and the site's host instructions say "paste with Ctrl+V" instead of the hotkey.
      Gate: `pnpm format:check && pnpm specs:check`
