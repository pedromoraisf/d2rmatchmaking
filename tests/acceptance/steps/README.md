# Step definitions

- One file per bounded context: `identity.steps.ts`, `agents.steps.ts`, `matchmaking.steps.ts`,
  `lobby-room.steps.ts`, `ranking.steps.ts`. Import `Given/When/Then` from `../fixtures`.
- Steps speak the ubiquitous language (`docs/domain/glossary.md`) and describe what a player or the agent does and
  sees — never CSS selectors, URLs or internal ids in the `.feature` text. In code, locate by role and accessible
  name (`page.getByRole(...)`), which also keeps NFR-13 honest.
- Reuse before adding: a near-duplicate step is a smell; parameterize with Cucumber expressions (`{string}`, `{int}`).
- The agent is simulated through its public HTTP contract (pairing, heartbeat, observations) with recorded payloads;
  OCR and capture are covered by the agent's own Rust tests with image fixtures.
- Assertions are on observable outcomes (what the site shows, what the API returns, which SSE event arrives), with
  explicit time limits when the spec states one (e.g. NFR-01's 2 seconds).
