# budget-v2 proofs

**HEAD**: 7cbb9b0
**Tree**: clean
**Result**: 29 pass, 0 fail; mutations 70 killed, 0 not

| Check | Proof                                                                                                            | Ran           | Passed | Result |
| ----- | ---------------------------------------------------------------------------------------------------------------- | ------------- | ------ | ------ |
| C1    | `node --test scripts/test/env-signatures.test.mjs`                                                               | count unknown | -      | pass   |
| C2    | `node --test scripts/test/budget.test.mjs`                                                                       | count unknown | -      | pass   |
| C3    | `node --test --test-name-pattern "Docker failure" --test-name-pattern "killed command" --test-name-pattern "sto` | count unknown | -      | pass   |
| C4    | `node --test --test-name-pattern "rerun" --test-name-pattern "empty commit" --test-name-pattern "runs after a c` | count unknown | -      | pass   |
| C5    | `node --test --test-name-pattern "full output" scripts/test/attempt-cli.test.mjs`                                | count unknown | -      | pass   |
| C6    | `node --test --test-name-pattern "reset" --test-name-pattern "needs a reason" --test-name-pattern "unit option"` | count unknown | -      | pass   |
| C7    | `node --test .claude/hooks/test/budget-rules.test.mjs`                                                           | count unknown | -      | pass   |
| C8    | `node --test --test-name-pattern "red stop" .claude/hooks/test/budget-rules.test.mjs`                            | count unknown | -      | pass   |
| C9    | `node --test scripts/test/retry-budget-docs.test.mjs`                                                            | count unknown | -      | pass   |
| C10   | `pnpm exec turbo run test:acceptance -- --grep @BUD-`                                                            | 57            | -      | pass   |
| C11   | `pnpm test:harness`                                                                                              | 1             | -      | pass   |
| C12   | `pnpm contracts:check`                                                                                           | count unknown | -      | pass   |
| C13   | `node --test --test-name-pattern "isUnchangedRerun" scripts/test/budget.test.mjs`                                | count unknown | -      | pass   |
| C14   | `node --test --test-name-pattern "hidden behind another wrapper call" .claude/hooks/test/budget-rules.test.mjs`  | count unknown | -      | pass   |
| C15   | `node --test --test-name-pattern "2>&1" .claude/hooks/test/budget-rules.test.mjs`                                | count unknown | -      | pass   |
| C16   | `node --test --test-name-pattern "a covered branch not started touches nothing" .claude/hooks/test/guard.test.m` | count unknown | -      | pass   |
| C17   | `node --test --test-name-pattern "exists only on the remote" --test-name-pattern "git cannot answer" --test-nam` | count unknown | -      | pass   |
| C18   | `node --test --test-name-pattern "however the wrapper is spelled" .claude/hooks/test/budget-rules.test.mjs`      | count unknown | -      | pass   |
| C19   | `node --test --test-name-pattern "blocks at the fourth machine failure in total" scripts/test/budget.test.mjs`   | count unknown | -      | pass   |
| C20   | `node --test --test-name-pattern "at most two red stops uncounted per session" .claude/hooks/test/budget-rules.` | count unknown | -      | pass   |
| C21   | `node --test --test-name-pattern "a merge keeps the uncounted stops" --test-name-pattern "a merge keeps the lar` | count unknown | -      | pass   |
| C22   | `node --test --test-name-pattern "a subagent of an unknown session counts its red stops" .claude/hooks/test/bud` | count unknown | -      | pass   |
| C23   | `node --test --test-name-pattern "only a reset clears the machine-failure total" scripts/test/budget.test.mjs`   | count unknown | -      | pass   |
| C24   | `node --test --test-name-pattern "a reset is judged through quotes, escapes, case and hidden code" .claude/hook` | count unknown | -      | pass   |
| C25   | `node --test --test-name-pattern "the guard reads both the local and the remote head" .claude/hooks/test/guard.` | count unknown | -      | pass   |
| C26   | `node --test --test-name-pattern "a reset is judged when the word itself is hidden" --test-name-pattern "a rese` | count unknown | -      | pass   |
| Build | `pnpm lint`                                                                                                      | -             | -      | pass   |
| Build | `pnpm typecheck`                                                                                                 | -             | -      | pass   |
| Build | `pnpm test:harness`                                                                                              | -             | -      | pass   |

## Mutations

| Mutation                                                                                                  | Location                                 | Killed |
| --------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ------ |
| unchanged rerun ignores the command                                                                       | `scripts/lib/budget.mjs:196`             | yes    |
| env-blocked needs four instead of three                                                                   | `scripts/lib/budget.mjs:171`             | yes    |
| a test-failure marker no longer wins over a signature                                                     | `scripts/lib/env-signatures.mjs:63`      | yes    |
| gate allows a second orchestrator reset                                                                   | `.claude/hooks/lib/budget-rules.mjs:95`  | yes    |
| red stop uncounted when only some failures are the machine                                                | `.claude/hooks/lib/budget-rules.mjs:405` | yes    |
| wrapper allows a second orchestrator reset                                                                | `scripts/attempt.mjs:249`                | yes    |
| unresolved covered branch touches nothing even when the phase branch does not resolve (rewritten for T25) | `.claude/hooks/lib/guard.mjs:92`         | yes    |
| proofOf ignores origin/<branch> as a head (rewritten for T25)                                             | `.claude/hooks/lib/guard.mjs:70`         | yes    |
| any commit beyond the phase counts as touching a covered branch (rewritten for T25)                       | `.claude/hooks/lib/guard.mjs:96`         | yes    |
| a ref holding some unproven commits passes as subset of the proven head                                   | `.claude/hooks/lib/guard.mjs:105`        | yes    |
| any redirection target is ignored as a write, not only /dev/null                                          | `.claude/hooks/lib/gate-rules.mjs:368`   | yes    |
| only the first wrapper call is read for a reset (rewritten for T24)                                       | `.claude/hooks/lib/budget-rules.mjs:140` | yes    |
| a third red stop of a session is still left uncounted (BUD-31 cap one too high)                           | `.claude/hooks/lib/budget-rules.mjs:408` | yes    |
| a red stop with no session id is left uncounted (BUD-31)                                                  | `.claude/hooks/lib/budget-rules.mjs:407` | yes    |
| a subagent of an unknown session (unknown-session#agent) is treated as a named session                    | `.claude/hooks/lib/budget-rules.mjs:403` | yes    |
| env-blocked needs a fifth machine failure in total instead of the fourth (BUD-30)                         | `scripts/lib/budget.mjs:171`             | yes    |
| ENV_TOTAL_TO_BLOCK is five                                                                                | `scripts/lib/budget.mjs:19`              | yes    |
| a pass clears the machine-failure total (BUD-30, AD-172)                                                  | `scripts/lib/budget.mjs:109`             | yes    |
| the environment total counts counted failures too                                                         | `scripts/lib/budget.mjs:109`             | yes    |
| the uncounted red stops are pooled across sessions instead of per session                                 | `scripts/lib/budget.mjs:213`             | yes    |
| mergeLedgers drops the uncounted red stops (a merge resets a session's cap)                               | `scripts/lib/budget.mjs:408`             | yes    |
| a pass clears the total a merge carried in (AD-172)                                                       | `scripts/lib/budget.mjs:168`             | yes    |
| a merge drops the total carried from the other copy (BUD-30)                                              | `scripts/lib/budget.mjs:431`             | yes    |
| the total ignores the carried environment failures                                                        | `scripts/lib/budget.mjs:117`             | yes    |
| the reset check no longer removes backslashes (T24)                                                       | `.claude/hooks/lib/budget-rules.mjs:105` | yes    |
| the reset check no longer removes single quotes (T24)                                                     | `.claude/hooks/lib/budget-rules.mjs:105` | yes    |
| the reset check no longer removes double quotes (T24)                                                     | `.claude/hooks/lib/budget-rules.mjs:105` | yes    |
| the wrapper name is matched case-sensitively (T24)                                                        | `.claude/hooks/lib/budget-rules.mjs:44`  | yes    |
| a program name with $ is no longer an expansion (T24)                                                     | `.claude/hooks/lib/budget-rules.mjs:106` | yes    |
| a program name with * is no longer a glob (T24)                                                           | `.claude/hooks/lib/budget-rules.mjs:106` | yes    |
| a program name with ? is no longer a glob (T24)                                                           | `.claude/hooks/lib/budget-rules.mjs:106` | yes    |
| a program name with a backtick is no longer an expansion (T24)                                            | `.claude/hooks/lib/budget-rules.mjs:106` | yes    |
| a program name with [ is no longer a glob (T24)                                                           | `.claude/hooks/lib/budget-rules.mjs:106` | yes    |
| an expanded program asks even without the word reset (T24)                                                | `.claude/hooks/lib/budget-rules.mjs:128` | yes    |
| a dynamic script path counts without a runner before it (T30)                                             | `.claude/hooks/lib/budget-rules.mjs:133` | yes    |
| environment assignments before the program are not skipped (T24)                                          | `.claude/hooks/lib/budget-rules.mjs:124` | yes    |
| a reset is not looked for in the commands a shell hides (T24)                                             | `.claude/hooks/lib/budget-rules.mjs:147` | yes    |
| inline code naming the budget modules is matched case-sensitively (T24)                                   | `.claude/hooks/lib/gate-rules.mjs:166`   | yes    |
| inline code is not stripped of + before the module name is matched (T24)                                  | `.claude/hooks/lib/gate-rules.mjs:166`   | yes    |
| inline code is not stripped of whitespace before the module name is matched (T24)                         | `.claude/hooks/lib/gate-rules.mjs:166`   | yes    |
| inline code is not stripped of backslashes before the module name is matched (T24)                        | `.claude/hooks/lib/gate-rules.mjs:166`   | yes    |
| inline code naming ledger-store.mjs no longer asks (T24)                                                  | `.claude/hooks/lib/gate-rules.mjs:166`   | yes    |
| inline code naming attempt.mjs no longer asks (T24)                                                       | `.claude/hooks/lib/gate-rules.mjs:166`   | yes    |
| inline code naming budget.mjs no longer asks (T24)                                                        | `.claude/hooks/lib/gate-rules.mjs:166`   | yes    |
| a branch touches the covered branch only when it shares a commit with both heads (T25 union)              | `.claude/hooks/lib/guard.mjs:96`         | yes    |
| the covered commits ignore origin when the local branch exists (T25 union)                                | `.claude/hooks/lib/guard.mjs:91`         | yes    |
| the covered commits ignore the local branch when origin exists (T25 union)                                | `.claude/hooks/lib/guard.mjs:91`         | yes    |
| touches fails closed only when every covered list fails, not when one does (T25)                          | `.claude/hooks/lib/guard.mjs:95`         | yes    |
| proof is due at origin when local contains it (T25 larger head)                                           | `.claude/hooks/lib/guard.mjs:73`         | yes    |
| proof is due at local when origin contains it (T25 larger head)                                           | `.claude/hooks/lib/guard.mjs:74`         | yes    |
| diverged local and origin heads are not denied, the local one is taken (T25)                              | `.claude/hooks/lib/guard.mjs:75`         | yes    |
| proofOf ignores the diverged heads (T25)                                                                  | `.claude/hooks/lib/guard.mjs:114`        | yes    |
| the diverged reason names the wrong branch (T25)                                                          | `.claude/hooks/lib/guard.mjs:132`        | yes    |
| a wrapper call whose first word expands is no longer a possible reset (T26 a)                             | `.claude/hooks/lib/budget-rules.mjs:141` | yes    |
| any word after the wrapper file name is read as a reset, status included (T26 a)                          | `.claude/hooks/lib/budget-rules.mjs:141` | yes    |
| the reset word is matched case-sensitively (T26 a)                                                        | `.claude/hooks/lib/budget-rules.mjs:141` | yes    |
| WRAPPER_ANY captures only a plain word, so $(echo reset) is not seen (T26 a)                              | `.claude/hooks/lib/budget-rules.mjs:44`  | yes    |
| a brace in an argument no longer counts as expanding (T26, T30)                                           | `.claude/hooks/lib/budget-rules.mjs:46`  | yes    |
| the dynamic script path itself counts as its own expanding argument (T30)                                 | `.claude/hooks/lib/budget-rules.mjs:134` | yes    |
| node is no longer a runner word (T30)                                                                     | `.claude/hooks/lib/budget-rules.mjs:113` | yes    |
| an expanding argument alone no longer makes rule (b) ask (T26 b)                                          | `.claude/hooks/lib/budget-rules.mjs:128` | yes    |
| the word reset alone no longer makes rule (b) ask (T26 b)                                                 | `.claude/hooks/lib/budget-rules.mjs:128` | yes    |
| a dynamic require( is no longer asked (T26)                                                               | `.claude/hooks/lib/gate-rules.mjs:172`   | yes    |
| a dynamic import( is no longer asked (T26)                                                                | `.claude/hooks/lib/gate-rules.mjs:172`   | yes    |
| every import( or require( asks, a plain literal too (T26)                                                 | `.claude/hooks/lib/gate-rules.mjs:172`   | yes    |
| a ? glob no longer counts as expanding (T30)                                                              | `.claude/hooks/lib/budget-rules.mjs:46`  | yes    |
| a ~ no longer counts as expanding (T30)                                                                   | `.claude/hooks/lib/budget-rules.mjs:46`  | yes    |
| a * glob no longer counts as expanding (T30)                                                              | `.claude/hooks/lib/budget-rules.mjs:46`  | yes    |
| a wrapper word that expands is no longer a possible reset (T30)                                           | `.claude/hooks/lib/budget-rules.mjs:141` | yes    |
| a dynamic script path behind a runner is no longer judged (T30)                                           | `.claude/hooks/lib/budget-rules.mjs:132` | yes    |
