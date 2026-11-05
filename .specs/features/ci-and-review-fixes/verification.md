# CI and Review Fixes verification

**Verdict**: PASS
**Mutations**: 4 - probed the nightly download `if` (CRF-15), `--lib` on the adapters command (CRF-10), the baseline path of `mutation.agent.core` (CRF-04), the site build in `turbo.json` (CRF-01); all 4 killed (`mutate.py`, unit tests only, scope check OK)
**Proofs**: `proofs.md` at de2c13c
**Verifier**: independent sub-agent (author != verifier)

## Findings

None - 4 mutations killed (the first try of the baseline-path mutation against the `agent core score at the baseline path` test survived by design, because that test reads the path from the baseline; the path is pinned by `the agent core source is inside the nightly's report directory`, which kills it). Own examples on `cargoMutantsScore` with a baseline `Success` entry, a `Success`-only list and a `Timeout` outcome gave 33.33, unset and 66.67, as CRF-05 and CRF-08 require.
