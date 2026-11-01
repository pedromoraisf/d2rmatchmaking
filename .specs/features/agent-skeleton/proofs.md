# agent-skeleton proofs

**HEAD**: dee64c7
**Tree**: clean
**Result**: 59 pass, 0 fail; mutations 0 killed, 0 not

| Check | Proof                                                                                                            | Ran           | Passed | Result        |
| ----- | ---------------------------------------------------------------------------------------------------------------- | ------------- | ------ | ------------- |
| C1    | `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="core has no tauri dependency` | 1             | -      | pass          |
| C2    | `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="the agent job runs fmt, clip` | 1             | -      | pass          |
| C3    | `walk - the maintainer pushes after the phase review; the PR checks page shows agent green (queued in .specs/ph` | -             | -      | pass (Walked) |
| C4    | `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml --workspace -E 'test(contracts_are_` | 1             | -      | pass          |
| C5    | `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml --workspace -E 'test(version_comes_` | 1             | -      | pass          |
| C6    | `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml --workspace -E 'test(shows_code_wit` | 1             | -      | pass          |
| C7    | `pnpm --filter @d2rmm/agent exec vitest run src -t "pairing view shows the code and the minutes left"`           | 1             | -      | pass          |
| C8    | `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml --workspace -E 'test(claims_every_t` | 2             | -      | pass          |
| C9    | `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml --workspace -E 'test(stores_token_a` | 1             | -      | pass          |
| C10   | `walk - the CI agent job log on windows-latest shows keyring_round_trip passed`                                  | -             | -      | pass (Walked) |
| C11   | `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml --workspace -E 'test(new_code_after` | 1             | -      | pass          |
| C12   | `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml --workspace -E 'test(unauthorized_d` | 1             | -      | pass          |
| C13   | `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml --workspace -E 'test(no_secret_in_l` | 1             | -      | pass          |
| C14   | `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml --workspace -E 'test(secret_fields_` | 1             | -      | pass          |
| C15   | `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml --workspace -E 'test(heartbeat_ever` | 1             | -      | pass          |
| C16   | `walk - the CI agent job log shows toolhelp_lists_the_current_process passed and the toolhelp-read and unsafe-f` | -             | -      | pass (Walked) |
| C17   | `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml --workspace -E 'test(heartbeat_fail` | 1             | -      | pass          |
| C18   | `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml --workspace -E 'test(every_request_` | 1             | -      | pass          |
| C19   | `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml --workspace -E 'test(loop_spans_are` | 1             | -      | pass          |
| C20   | `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml --workspace -E 'test(fetches_assign` | 1             | -      | pass          |
| C21   | `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml --workspace -E 'test(reconnect_back` | 1             | -      | pass          |
| C22   | `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml --workspace -E 'test(latest_room_as` | 1             | -      | pass          |
| C23   | `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml --workspace -E 'test(unknown_or_inv` | 1             | -      | pass          |
| C24   | `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="unsafe is allowed only in th` | 1             | -      | pass          |
| C25   | `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml --workspace -E 'test(reads_first_li` | 1             | -      | pass          |
| C26   | `walk - the CI agent job log on windows-latest shows ocr_reads_the_reference_image passed`                       | -             | -      | pass (Walked) |
| C27   | `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml --workspace -E 'test(exact_match_yi` | 1             | -      | pass          |
| C28   | `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml --workspace -E 'test(other_names_yi` | 1             | -      | pass          |
| C29   | `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml --workspace -E 'test(retries_with_s` | 1             | -      | pass          |
| C30   | `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml --workspace -E 'test(observation_ca` | 1             | -      | pass          |
| C31   | `node scripts/agent/expect-failure.mjs banned -- cargo deny --config apps/agent/src-tauri/deny.toml --manifest-` | count unknown | -      | pass          |
| C32   | `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="windows features stay on the` | 1             | -      | pass          |
| C33   | `node scripts/agent/expect-failure.mjs disallowed_types -- cargo clippy --manifest-path apps/agent/src-tauri/bo` | count unknown | -      | pass          |
| C34   | `node scripts/agent/expect-failure.mjs unsafe_code -- cargo clippy --manifest-path apps/agent/src-tauri/boundar` | count unknown | -      | pass          |
| C35   | `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml --workspace -E 'test(sends_only_con` | 1             | -      | pass          |
| C36   | `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml --workspace -E 'test(update_checks_` | 1             | -      | pass          |
| C37   | `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="updater checks the latest re` | 1             | -      | pass          |
| C38   | `walk - the maintainer's Windows check in the phase review (brief Q4): install D2RMatchMaking-setup.exe v0.0.1,` | -             | -      | pass (Walked) |
| C39   | `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml --workspace -E 'test(update_failure` | 1             | -      | pass          |
| C40   | `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml --workspace -E 'test(upgrade_requir` | 1             | -      | pass          |
| C41   | `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="release-please calls release` | 1             | -      | pass          |
| C42   | `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="release-agent builds on tag ` | 1             | -      | pass          |
| C43   | `walk - after the phase review, the release page of agent-v0.0.1 lists latest.json, D2RMatchMaking-setup.exe an` | -             | -      | pass (Walked) |
| C44   | `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="SignPath signing runs only w` | 1             | -      | pass          |
| C45   | `pnpm --filter @d2rmm/web build && pnpm --filter @d2rmm/acceptance exec bddgen && pnpm --filter @d2rmm/acceptan` | 2             | -      | pass          |
| C46   | `pnpm --filter @d2rmm/agent exec vitest run src -t "agent en and pt-BR hold the same keys"`                      | 1             | -      | pass          |
| C47   | `pnpm --filter @d2rmm/config exec vitest run test/rules.test.ts -t "reports a literal string in an agent compon` | 1             | -      | pass          |
| C48   | `pnpm --filter @d2rmm/agent exec vitest run src -t "follows the Windows display language"`                       | 1             | -      | pass          |
| C49   | `pnpm --filter @d2rmm/agent exec vitest run src -t "pairing view in pt-BR"`                                      | 1             | -      | pass          |
| C50   | `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml -p d2rmm-agent -E 'test(flag_reject` | 1             | -      | pass          |
| C51   | `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="fixture-read cannot reach a ` | 1             | -      | pass          |
| C52   | `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml --workspace -E 'test(pauses_after_t` | 1             | -      | pass          |
| C53   | `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml --workspace -E 'test(pairing_succes` | 1             | -      | pass          |
| C54   | `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml --workspace -E 'test(waits_retry_af` | 1             | -      | pass          |
| C55   | `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml --workspace -E 'test(retry_after_is` | 1             | -      | pass          |
| Build | `pnpm --filter @d2rmm/agent build`                                                                               | -             | -      | pass          |
| Build | `cargo clippy --locked --manifest-path apps/agent/src-tauri/Cargo.toml --all-targets -- -D warnings`             | -             | -      | pass          |
| Build | `pnpm typecheck`                                                                                                 | -             | -      | pass          |
| Build | `pnpm lint`                                                                                                      | -             | -      | pass          |
