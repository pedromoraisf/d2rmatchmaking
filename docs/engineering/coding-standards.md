# Coding standards

## TypeScript

- `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`; ESM; no `any`; no `enum` (string-literal unions).
- Expected failures: `Result<T, E>` from the shared kernel. Exceptions only for bugs and infrastructure faults.
- Value objects validate in a static `create` and are immutable. Aggregates expose intent-named methods that return events.
- Ports are interfaces in `application/ports.ts`; adapters implement them; `main/` wires them.
- Time and ids come from `Clock` and `IdGenerator` ports (ULID).
- Boundary validation with Zod schemas from `packages/contracts`; never trust request bodies or agent payloads.
- Files kebab-case, one exported concept per file, tests next to the code (`*.test.ts`).

## React

- Function components, TanStack Query for server state, no global store unless proven necessary.
- Every string through i18n (`en` source, `pt-BR`); accessible names on every control; AA contrast.

## Rust (agent)

- Workspace crates separate capture, OCR, fusion, transport and UI bridge; dependency direction enforced by crate deps.
- `clippy -D warnings`, `rustfmt`, `thiserror`, no `unwrap()` outside tests, `unsafe` only at the capture FFI boundary
  with a `// SAFETY:` comment.

## Commits

Conventional Commits, scope = app or module: `feat(matchmaking): widen ELO band with wait time`. One commit per TLC task.
