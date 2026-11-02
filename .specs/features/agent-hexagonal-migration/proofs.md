# agent-hexagonal-migration proofs

**HEAD**: dfad98d
**Tree**: clean
**Result**: 35 pass, 0 fail; mutations 0 killed, 0 not

| Check | Proof                                                                                                            | Ran           | Passed | Result |
| ----- | ---------------------------------------------------------------------------------------------------------------- | ------------- | ------ | ------ |
| C1    | `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="domain depends only on std t` | 1             | -      | pass   |
| C2    | `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="core depends on the domain a` | 1             | -      | pass   |
| C3    | `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="contract types stay out of t` | 1             | -      | pass   |
| C4    | `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="domain clippy.toml repeats t` | 1             | -      | pass   |
| C5    | `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="each architecture rule fails` | 1             | -      | pass   |
| C6    | `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="AGENTS.md and the cursor rul` | 1             | -      | pass   |
| C7    | `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent-domain --lib -E 'tes` | 1             | -      | pass   |
| C8    | `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent-domain --lib -E 'tes` | 1             | -      | pass   |
| C9    | `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent-domain --lib -E 'tes` | 1             | -      | pass   |
| C10   | `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent-domain --lib -E 'tes` | 1             | -      | pass   |
| C11   | `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent-domain --lib -E 'tes` | 1             | -      | pass   |
| C12   | `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent-domain --lib -E 'tes` | 1             | -      | pass   |
| C13   | `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent-domain --lib -E 'tes` | 1             | -      | pass   |
| C14   | `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="domain reads no clock or ran` | 1             | -      | pass   |
| C15   | `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent-domain --lib -E 'tes` | 1             | -      | pass   |
| C16   | `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="application reaches the API ` | 1             | -      | pass   |
| C17   | `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent-adapters --lib -E 't` | 1             | -      | pass   |
| C18   | `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="no struct in core holds more` | 1             | -      | pass   |
| C19   | `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent-adapters -E 'test(lo` | 1             | -      | pass   |
| C20   | `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="only the app crate builds ad` | 1             | -      | pass   |
| C21   | `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="core tests use in-memory fak` | 1             | -      | pass   |
| C22   | `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="moved tests keep every asser` | 1             | -      | pass   |
| C23   | `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent-adapters -E 'test(ev` | 1             | -      | pass   |
| C24   | `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent-core --lib -E 'test(` | 2             | -      | pass   |
| C25   | `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent-adapters -E 'test(un` | 1             | -      | pass   |
| C26   | `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="clippy.toml disallows every ` | 1             | -      | pass   |
| C27   | `node scripts/agent/win-check.mjs`                                                                               | count unknown | -      | pass   |
| C28   | `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="the nightly mutation run cov` | 1             | -      | pass   |
| C29   | `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="a mutation run without the d` | 1             | -      | pass   |
| C30   | `node scripts/mutation-scope-check.mjs`                                                                          | count unknown | -      | pass   |
| C31   | `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="mutation rule modules list m` | 1             | -      | pass   |
| C32   | `cargo mutants --manifest-path apps/agent/src-tauri/Cargo.toml --package d2rmm-agent-domain --cargo-arg=--locke` | count unknown | -      | pass   |
| Build | `cargo clippy --locked --manifest-path apps/agent/src-tauri/Cargo.toml --workspace --all-targets -- -D warnings` | -             | -      | pass   |
| Build | `pnpm typecheck`                                                                                                 | -             | -      | pass   |
| Build | `pnpm lint`                                                                                                      | -             | -      | pass   |
