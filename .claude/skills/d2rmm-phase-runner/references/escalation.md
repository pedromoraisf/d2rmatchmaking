# Escalations

An escalation is the **only** reason to interrupt the maintainer during a phase. Everything else is decided, recorded
and reviewed at the end. Most escalations are enforced by `.claude/hooks/gate.mjs` as a permission prompt ("ask");
the runner must also stop on its own for the ones a hook cannot see.

| Escalation | Enforced by | What the runner does |
| --- | --- | --- |
| `git push`, PR merge, merge into `main` | gate (ask) | Never initiates during the run; listed in review.md |
| Deploy (Cloudflare, Render), release, tag | gate (ask) | Same |
| Production database (Neon prod URL) | gate (deny) | Never |
| Creating or changing secrets | gate (ask) | Lists the secret name and where it is needed |
| Changing an accepted ADR | gate (ask) | Writes a new ADR "Proposed" that supersedes it and asks |
| Deleting / skipping / weakening tests | gate (ask / deny `.only`) | Fixes the code instead |
| Loosening the quality baseline | gate (deny) | Fixes the regression |
| Loosening a sensor (lint, depcruise, Stryker thresholds, CI steps) | gate (ask) + reviewers | Fixes the code instead |
| Editing the hooks or `.claude/settings.json` | gate (ask, always) | Explains why |
| Product gray area with no conservative default | runner | Asks one precise question with options |
| Blocked feature that blocks the rest of the phase | runner | Summarises the blocker, attempts and options |
| Anything that costs money (paid plan, domain, paid API) | runner | Asks |

How to ask: one message, the decision, 2–4 options with the consequence of each, the runner's recommendation first.
Record the answer in the file it belongs to in the same turn (TLC rule).
