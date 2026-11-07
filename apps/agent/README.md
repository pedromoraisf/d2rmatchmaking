# D2R Match Making agent

The read-only Windows desktop agent. Architecture: ADR 027. Releases: `docs/engineering/releases.md`.

## Checking the installed version

The agent window does not show its version. On Windows, open Settings → Apps → Installed apps and find `D2RMatchMaking`.

## Checking the self-update

The agent looks for an update when it starts and every 6 hours (AD-049). With an older version installed and a newer
release published, restart the agent, wait a moment, and check the installed version again.
