# Engineering constraints

Hard limits the design must respect. A change that breaks one needs an ADR.

## Free-tier budgets (NFR-07)

| Resource           | Limit                                                                | Design consequence                                                                         |
| ------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Render web service | 512 MB RAM, fraction of a CPU, sleeps after 15 min idle, 750 h/month | One instance, in-process worker, in-memory stores; cold start acceptable off-peak          |
| Render egress      | 5 GB/month                                                           | ≤ ~70 KB per player-hour (NFR-14 at 100 players); minimal SSE payloads; adaptive heartbeat |
| Neon               | 1 GB storage, 100 CU-hours, scale-to-zero after 5 min                | No DB write per heartbeat; small pool; observations retained 30 days                       |
| Cloudflare R2      | free tier                                                            | Dispute prints only, 30-day lifecycle                                                      |
| GitHub Actions     | free for public repos                                                | Turborepo `--affected`; mutation incremental on PRs, full nightly                          |
| Grafana Cloud      | free tier quotas                                                     | Head sampling; no high-cardinality attributes                                              |

## Performance

- NFR-01: room state change reaches the site ≤ 2 s after the agent's observation.
- NFR-02: agent < 2% CPU average, no perceptible FPS impact.
- NFR-14: ≥ 100 concurrent players on the main journey, verified by k6.

## Safety and privacy

- ADR 010: the agent's read-only boundary (see SECURITY.md).
- NFR-04/05: capture consent at install; prints only on player action; retention ≤ 30 days.
- NFR-06: agent token revocable and scoped; the agent accepts data, never commands.

## Portability

- NFR-08: changing host touches only `apps/api/src/main/` and workflow files.
