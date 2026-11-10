# Escalations

An escalation is the only reason to interrupt the maintainer between the brief and the review (ADR 029). Push, pull
requests, merges into the phase branch, releases, tags and workflow runs are not escalations (ADR 028 § 1).

| Escalation                                              | Enforced by       | What the runner does                                    |
| ------------------------------------------------------- | ----------------- | ------------------------------------------------------- |
| Production database                                     | gate (deny)       | Never                                                   |
| Creating or changing secrets or variables               | gate (ask)        | Names the secret and where it is needed                 |
| Repository settings, rulesets, environments             | gate (ask)        | Shows the exact change and why                          |
| Editing a sensor or its threshold                       | gate (ask)        | Explains why; never to loosen it                        |
| Changing an accepted ADR                                | runner            | Writes a new ADR "Proposed" that supersedes it and asks |
| Deleting, skipping or weakening a test or scenario      | runner, reviewers | Fixes the code instead                                  |
| A product gray area with no conservative default        | runner            | Asks one precise question with options                  |
| A blocked feature that blocks the rest of the phase     | runner            | Summarises the blocker, the attempts and the options    |
| Anything that costs money (paid plan, domain, paid API) | runner            | Asks                                                    |

How to ask: one message, the decision, 2 to 4 options with the consequence of each, the recommendation first. Record the
answer where it belongs in the same turn, and keep working on what does not depend on it.
