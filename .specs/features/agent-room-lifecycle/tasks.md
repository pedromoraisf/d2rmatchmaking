# Agent room lifecycle — Tasks

Spec: `spec.md` · Scenarios: `acceptance.feature` · Branch: `feat/F2-agent-room-lifecycle` → `phase/F2`

Placement (no design.md, Medium). Start the branch from `origin/phase/F2` and cherry-pick `6e67830` from
`origin/fix/agent-drop-expired-room`. That commit adds the work in progress for ARL-01: `StreamItem::RoomEnded`, its
handling in `core/src/follow_stream.rs`, and the SSE parsing in `adapters/src/http/sse.rs`.

Where each part goes:

- The window's room line comes from `core/src/view.rs` (`RoomView`). It gains a confirmed state, set when
  `post_observation` gets a 2xx for the held run and cleared on a new run or a dropped room.
- The strings live in `apps/agent/src/shared/locales/{en,pt-BR}.json`.
- On the site, the dismissal lives in `apps/web/src/features/lobby-room/RoomPanel.tsx` (`localStorage`, keyed by room
  id). The presence re-read on a stream reconnect sits where the site opens its stream.

Rules:

- The agent sends no input to the game (ADR 010).
- `acceptance.feature` is never edited, and no test is weakened.
- In a fresh checkout, run `pnpm --filter @d2rmm/agent build` once before the first push (lessons).

## Batch 1

- [x] T1 — Agent: finish ARL-01 on top of the cherry-picked commit. The adapters parse the room's stage event for
      `expired` and `closed` into `RoomEnded`; core drops only the held room and stops its Party step. Unit tests cover
      both rooms and both stages. Gate:
      `cargo nextest run --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent-core -p d2rmm-agent-adapters --lib && cargo clippy --manifest-path apps/agent/src-tauri/Cargo.toml --all-targets -- -D warnings`
- [x] T2 — Agent: on a stream reconnect or a start, read the assignment again and drop a room the API no longer assigns
      (ARL-02). Unit test with the fake gateway. Gate:
      `cargo nextest run --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent-core --lib`
- [x] T3 — Agent: the confirmed state (ARL-03, ARL-04). Add it to the view model, clear it on a new run and on a drop,
      and show "Room {{gameName}} — presence confirmed" in the window in English and pt-BR. Rust view tests and the
      window component test. Gate:
      `cargo nextest run --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent-core --lib && pnpm --filter @d2rmm/agent exec vitest run`
- [x] T4 — Agent: span events for a dropped assignment (reason `expired`, `closed` or `not-assigned`) and for a confirmed
      run, with no names (ARL-07). Unit tests with the in-memory exporter. Gate:
      `cargo nextest run --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent-core --lib`
- [ ] T5 — Site: remember a dismissed ended room per room id across reloads (ARL-05), with a component test. Gate:
      `pnpm --filter @d2rmm/web exec vitest run src/features/lobby-room && pnpm --filter @d2rmm/web lint`
- [ ] T6 — Site: read the agent's presence again after the stream reconnects, so an online state never outlives 60
      seconds after the last heartbeat (ARL-06). Find why it lingered before fixing it, and write the cause in the
      commit message. Unit or component test. Gate:
      `pnpm --filter @d2rmm/web exec vitest run && pnpm --filter @d2rmm/web lint`
- [ ] T7 — Acceptance steps for the `@ARL-` scenarios, with the headless agent where an agent acts. Gate:
      `pnpm exec turbo run test:acceptance -- --grep @ARL-`
