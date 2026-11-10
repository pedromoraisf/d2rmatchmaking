# Harness Bootstrap verification

**Verdict**: FAIL
**Mutations**: 8 - probed verdict prefix, dirty-tree proof, merge subset, push `-fu`, PR pin, moved head, covered-merge guard, background `'true'` (7 killed, 1 survived)
**Proofs**: `proofs.md` at 5f9c324
**Verifier**: independent sub-agent (author != verifier)

## Findings

| Finding                                                                                                                                                                                                                                                              | Evidence                                                                                                                                                                                     | Fix                                                                                                                                                                                            | Closed  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| The background-review denial of HBS-30 has no unit test for a string `"true"`: the branch is unproved at unit level                                                                                                                                                  | mutation `ti.run_in_background !== true && ti.run_in_background !== 'true'` -> `!== true` in `.claude/hooks/lib/verdicts.mjs:83` survived `node --test .claude/hooks/test/verdicts.test.mjs` | in `verdicts.test.mjs` assert `checkBackgroundReview` denies `run_in_background: 'true'` (or drop the string branch if it cannot occur)                                                        | 8371ad8 |
| `gh release upload` is allowed for any file path that matches `SAFE_FILE`, including `.env`, `apps/api/.env`, `.git/config`: a secret can be published to a public release without a prompt (AGENTS.md rule 6; goal "secrets keep the decisions ADR 028 gives them") | own example, `allowedShape('gh release upload v1 .env')` -> true; `isSafeFile` in `.claude/hooks/lib/delivery.mjs` only rejects `..` and a leading `-`                                       | add a new requirement (HBS-49) and a check: an upload operand whose path has a segment starting with `.env` or equal to `.git` is not an allowed shape (ask); unit test in `delivery.test.mjs` | 93f8e7e |

## Examples nobody named

- `git push origin feat/F0-x --tags`, `-- feat/F0-x`, `-d`, `-fu`, `--force-with-lease=x`, `git tag v1 HEAD~1`, `git tag --force v1`, `curl ... -o /tmp/x`: all correctly not allowed (ask or deny). Holds.
- `gh release upload v1 .env`: allowed (finding above).
- `gh release create v1 --target main` and `gh workflow run ci.yml --ref main` are allowed; the spec's shapes permit them, noted only.

## Assertions looser than their criterion

- HBS-30 is proved only by acceptance scenarios (C4/C12), not by a unit test of the string form (see finding 1).
- No other loose assertion found among the mutated rules: each of the seven killed mutations turned a unit test red.
