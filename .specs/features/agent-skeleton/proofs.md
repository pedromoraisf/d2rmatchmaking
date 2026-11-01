# agent-skeleton proofs

**HEAD**: 0d7f699
**Tree**: clean
**Result**: 71 pass, 0 fail; mutations 41 killed, 0 not

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
| C52   | `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml --workspace -E 'test(pauses_after_t` | 2             | -      | pass          |
| C53   | `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml --workspace -E 'test(pairing_succes` | 1             | -      | pass          |
| C54   | `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml --workspace -E 'test(waits_retry_af` | 1             | -      | pass          |
| C55   | `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml --workspace -E 'test(retry_after_is` | 1             | -      | pass          |
| C56   | `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml --workspace -E 'test(minutes_left_r` | 3             | -      | pass          |
| C57   | `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml --workspace -E 'test(unauthorized_o` | 4             | -      | pass          |
| C58   | `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml --workspace -E 'test(unauthorized_o` | 1             | -      | pass          |
| C59   | `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml --workspace -E 'test(game_running_m` | 1             | -      | pass          |
| C60   | `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml --workspace -E 'test(reconnect_back` | 2             | -      | pass          |
| C61   | `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml --workspace -E 'test(observation_4x` | 1             | -      | pass          |
| C62   | `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml --workspace -E 'test(waits_sixty_mi` | 1             | -      | pass          |
| C63   | `cargo nextest run --locked --manifest-path apps/agent/src-tauri/Cargo.toml --workspace -E 'test(retries_code_r` | 1             | -      | pass          |
| C64   | `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="deny.toml bans every crate o` | 2             | -      | pass          |
| C65   | `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="clippy.toml disallows every ` | 2             | -      | pass          |
| C66   | `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="the tag must be an ancestor ` | 1             | -      | pass          |
| C67   | `node --test --test-reporter=./scripts/lib/count-reporter.mjs --test-name-pattern="the fixture-read guard greps` | 1             | -      | pass          |
| Build | `pnpm --filter @d2rmm/agent build`                                                                               | -             | -      | pass          |
| Build | `cargo clippy --locked --manifest-path apps/agent/src-tauri/Cargo.toml --all-targets -- -D warnings`             | -             | -      | pass          |
| Build | `pnpm typecheck`                                                                                                 | -             | -      | pass          |
| Build | `pnpm lint`                                                                                                      | -             | -      | pass          |

## Mutations

| Mutation                                                       | Location                                           | Killed |
| -------------------------------------------------------------- | -------------------------------------------------- | ------ |
| claim interval 2 s -> 3 s                                      | `apps/agent/src-tauri/core/src/pairing.rs:23`      | yes    |
| unused code limit 2 -> 3                                       | `apps/agent/src-tauri/core/src/pairing.rs:29`      | yes    |
| minutes left rounds down instead of up                         | `apps/agent/src-tauri/core/src/pairing.rs:305`     | yes    |
| heartbeat interval 15 s -> 16 s                                | `apps/agent/src-tauri/core/src/heartbeat.rs:20`    | yes    |
| D2R.exe match becomes case sensitive (check-level proof only)  | `apps/agent/src-tauri/core/src/heartbeat.rs:65`    | yes    |
| reconnect cap 60 s -> 120 s                                    | `apps/agent/src-tauri/core/src/stream.rs:27`       | yes    |
| backoff reset boundary >= -> >                                 | `apps/agent/src-tauri/core/src/stream.rs:64`       | yes    |
| observation last retry 8 s -> 16 s                             | `apps/agent/src-tauri/core/src/observations.rs:20` | yes    |
| update check every 12 h                                        | `apps/agent/src-tauri/core/src/updates.rs:20`      | yes    |
| Retry-After cap 60 min -> 120 min                              | `apps/agent/src-tauri/core/src/api_client.rs:25`   | yes    |
| Retry-After floor 1 s -> 0 s                                   | `apps/agent/src-tauri/core/src/api_client.rs:24`   | yes    |
| Authorization header not marked sensitive                      | `apps/agent/src-tauri/core/src/api_client.rs:239`  | yes    |
| 426 no longer blocks the API loops                             | `apps/agent/src-tauri/core/src/context.rs:168`     | yes    |
| 401 keeps the stored token                                     | `apps/agent/src-tauri/core/src/context.rs:124`     | yes    |
| installed update leaves the required flag set                  | `apps/agent/src-tauri/core/src/updates.rs:63`      | yes    |
| fusion no longer trims the read text                           | `apps/agent/src-tauri/core/src/fusion.rs:27`       | yes    |
| fusion matches a prefix (mmbaalh-1) instead of the whole name  | `apps/agent/src-tauri/core/src/fusion.rs:28`       | yes    |
| 429 without Retry-After waits 120 min                          | `apps/agent/src-tauri/core/src/pairing.rs:27`      | yes    |
| unreachable retry 15 s -> 30 s                                 | `apps/agent/src-tauri/core/src/pairing.rs:25`      | yes    |
| 426 no longer triggers an update check                         | `apps/agent/src-tauri/core/src/context.rs:137`     | yes    |
| a 4xx observation answer is retried                            | `apps/agent/src-tauri/core/src/observations.rs:81` | yes    |
| handle_api_error: 401 no longer drops the token                | `apps/agent/src-tauri/core/src/context.rs:144`     | yes    |
| handle_api_error: 426 no longer blocks the loops               | `apps/agent/src-tauri/core/src/context.rs:145`     | yes    |
| handle_api_error: other errors also drop the token             | `apps/agent/src-tauri/core/src/context.rs:146`     | yes    |
| reconnect delay triples instead of doubling                    | `apps/agent/src-tauri/core/src/stream.rs:73`       | yes    |
| a stream open 60 s no longer resets the backoff                | `apps/agent/src-tauri/core/src/stream.rs:65`       | yes    |
| retry delay index shifted by one                               | `apps/agent/src-tauri/core/src/observations.rs:76` | yes    |
| an expired code no longer counts as unused                     | `apps/agent/src-tauri/core/src/pairing.rs:267`     | yes    |
| pause boundary >= -> >                                         | `apps/agent/src-tauri/core/src/pairing.rs:289`     | yes    |
| 429 ignores Retry-After                                        | `apps/agent/src-tauri/core/src/pairing.rs:294`     | yes    |
| installed update shows Required instead of Idle                | `apps/agent/src-tauri/core/src/updates.rs:63`      | yes    |
| up-to-date clears the required flag                            | `apps/agent/src-tauri/core/src/updates.rs:70`      | yes    |
| failed check shows Idle instead of Failed                      | `apps/agent/src-tauri/core/src/updates.rs:76`      | yes    |
| SendInput dropped from the clippy ban list                     | `apps/agent/src-tauri/clippy.toml:15`              | yes    |
| enigo dropped from the cargo-deny ban list                     | `apps/agent/src-tauri/deny.toml:45`                | yes    |
| tag-on-main check reversed                                     | `.github/workflows/release-agent.yml:65`           | yes    |
| fixture-read guard greps a misspelled feature                  | `.github/workflows/release-agent.yml:90`           | yes    |
| unused_after: claim 401 no longer resets the count             | `apps/agent/src-tauri/core/src/pairing.rs:268`     | yes    |
| unused_after_claim_error: a 410 no longer counts as unused     | `apps/agent/src-tauri/core/src/pairing.rs:276`     | yes    |
| unused_after_claim_error: a 401 no longer resets the count     | `apps/agent/src-tauri/core/src/pairing.rs:277`     | yes    |
| unused_after_claim_error: the keep-the-code arm wrongly counts | `apps/agent/src-tauri/core/src/pairing.rs:283`     | yes    |
