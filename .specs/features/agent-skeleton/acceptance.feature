# Acceptance scenarios for agent-skeleton (ADR 023). English Gherkin. Executed as-is by tests/acceptance
# (playwright-bdd). The acceptance runner drives the site and the API over HTTP and the browser; it cannot drive the
# Windows desktop agent. So every agent behaviour is proved by the agent's own Rust tests against a contract-faithful
# fake API server (cargo nextest on windows-latest, CI job `agent`), by static tests of the workflows and configuration,
# and by the maintainer's Windows check in the phase review (brief Q4). The real agent against the real API runs end
# to end in observability-e2e. Each line below names the proof.

Feature: The agent is released, pairs and stays inside its limits
  A player downloads the agent, pairs it with a code, keeps it online and up to date; the agent reads the game name
  from a reference image and never touches the game.

  # not-scenario: AGS-01 — workspace layout; proved by the `agent` CI job building both crates and by a Vitest check that the `@d2rmm/agent` UI workspace builds
  # not-scenario: AGS-02 — proved by the `agent` CI job on windows-latest (fmt, clippy -D warnings, nextest)
  # not-scenario: AGS-03 — proved by a Rust test that regenerates the typify output from packages/contracts/json-schema and compares it with the committed file
  # not-scenario: AGS-04 — proved by a test that tauri.conf.json takes its version from apps/agent/package.json and that requests send that version
  # not-scenario: AGS-05 — proved by a Rust test of the pairing flow against the fake API (code shown with its minutes left) and a UI test of the pairing view
  # not-scenario: AGS-06 — proved by a Rust test with a fake clock: claims every 2 s, token stored in the credential-store port, claiming stops, state "Paired"
  # not-scenario: AGS-07 — proved by Rust tests: a 410 claim and a passed expiry each lead to a new code
  # not-scenario: AGS-08 — proved by a Rust test: a 401 on any request deletes the stored token and shows a new code
  # not-scenario: AGS-09 — proved by a Rust test that captures every log line and span attribute of the pairing flow and finds no token, and by a check that the token is written only through the credential-store port
  # not-scenario: AGS-10 — proved by Rust tests: heartbeats 15 s apart on a fake clock, body valid against the heartbeat JSON Schema, `running` follows a fake toolhelp snapshot containing `D2R.exe`; "no handle opened" is proved by the clippy ban on `OpenProcess` (AGS-22) and the `cargo deny` ban on `sysinfo` (AGS-21)
  # not-scenario: AGS-11 — proved by a Rust test: a 503 and a refused connection keep the loop running, show "Can't reach the server", and the next success shows "Connected"
  # not-scenario: AGS-12 — proved by a Rust test that every request to the fake API carries `X-Agent-Version` and a valid W3C `traceparent`
  # not-scenario: AGS-13 — proved by a Rust test: on pairing, start and stream reconnect the agent fetches its assignment and opens the stream with its token
  # not-scenario: AGS-14 — proved by a Rust test: `room.assigned` from the fake stream becomes the current assignment and the latest of two wins
  # not-scenario: AGS-15 — proved by Rust tests: unknown and invalid stream events are ignored, and every stream event type maps only to a state update (set or clear the assignment); the crate-wide clippy bans of AGS-22 forbid starting a process or sending input anywhere
  # not-scenario: AGS-16 — proved by a Windows-only Rust test that reads apps/agent/fixtures/automap-game-name.png and gets `mmbaalh-12`
  # not-scenario: AGS-17 — proved by Rust fusion tests: `mmbaalh-12` and `MMBAALH-12 ` for an expected `mmbaalh-12` yield one observation with the normalised name, room, run, confidence in [0, 1], a new key and the capture time
  # not-scenario: AGS-18 — proved by Rust fusion tests: `mmbaalh-13`, `mmbaalh-1` and no assignment yield no observation
  # not-scenario: AGS-19 — proved by a Rust test against the fake API: 503s are retried with the same idempotency key, 5 attempts at 1, 2, 4, 8 s on a fake clock
  # not-scenario: AGS-20 — proved by a Rust test that the observation body is valid against the observation JSON Schema (no image field) and by the AGS-21 bans on network-capture and upload crates
  # not-scenario: AGS-21 — proved by `cargo deny check bans` in the `agent` CI job, with a fixture crate that adds a banned dependency and fails
  # not-scenario: AGS-22 — proved by clippy `disallowed-methods` / `disallowed-types` in the `agent` CI job, with a fixture that calls `std::process::Command::new` and fails
  # not-scenario: AGS-23 — proved by a Rust test that the API client sends only the four contract request types, each valid against its JSON Schema
  # not-scenario: AGS-24 — proved by a test of tauri.conf.json (updater endpoint and embedded public key) and a Rust test of the update scheduler on a fake clock (start, every 6 h, after a 426)
  # not-scenario: AGS-25 — needs two real releases and a Windows install; proved by the maintainer's Windows check in the phase review (install v0.0.1, see it restart as v0.0.2)
  # not-scenario: AGS-26 — proved by a Rust test of the update step with a fake updater that fails on signature, download and manifest: version kept, "Update failed — will retry" shown, next check scheduled
  # not-scenario: AGS-27 — proved by a Rust test: a 426 from the fake API shows "Update required" and triggers an update check
  # not-scenario: AGS-28 — proved by a static test of release-please.yml and release-agent.yml (triggers, tauri-action on windows-latest, signing secrets, latest.json, the fixed `D2RMatchMaking-setup.exe` asset) and by the first runs after the maintainer's merge
  # not-scenario: AGS-29 — proved by the same static test: the SignPath step runs only when its secrets exist
  # not-scenario: AGS-31 — proved by a UI unit test that the `en` and `pt-BR` files hold the same keys and by an ESLint fixture where a literal JSX string fails
  # not-scenario: AGS-32 — proved by a UI unit test rendering the pairing view with `pt-BR` ("Código de pareamento") and with `fr-FR` (English)
  # not-scenario: AGS-33 — proved by a Rust test that a build without the `fixture-read` feature rejects `--read-fixture`, and by the static workflow test that `release-agent.yml` never enables the feature
  # not-scenario: AGS-34 — proved by a Rust test with a fake clock and fake API: two codes expire unused, the agent shows "Pairing paused" and requests nothing until "Get a new code"
  # not-scenario: AGS-35 — proved by a Rust test: a 429 with `Retry-After: 120` (and one without it, 60 minutes) blocks code requests until that time on a fake clock

  @AGS-30 @web
  Scenario: The site warns that the installer is not code-signed yet
    When a visitor opens the site
    Then the site shows "The installer is not code-signed yet, so Windows SmartScreen may warn you before it runs." next to "Download the agent"

  @AGS-30 @NFR-12 @web
  Scenario: The installer warning follows the browser's language
    Given the browser prefers "pt-BR"
    When a visitor opens the site
    Then the site shows "O instalador ainda não tem assinatura de código, por isso o Windows SmartScreen pode avisar antes de executá-lo." next to "Baixar o agente"
