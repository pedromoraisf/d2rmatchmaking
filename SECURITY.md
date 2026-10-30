# Security policy

## Reporting a vulnerability

Please **do not open a public issue**. Use GitHub's private vulnerability reporting
("Security" tab → "Report a vulnerability"). We aim to acknowledge within 72 hours.

## What the desktop agent never does

The agent is the part of this project players install, so its limits are part of the security model (ADR 010):

- never reads or writes game memory, injects code or hooks the renderer;
- never intercepts or modifies network traffic;
- captures only the game window, processes it locally, and sends structured observations — never screenshots,
  unless the player explicitly attaches one to a dispute (retained ≤ 30 days);
- never sends input that confirms an action in-game;
- accepts data from the server, never commands; its token is revocable and scoped to heartbeat, observations and push.

Any change that weakens one of these is a security bug.

## Supported versions

Only the latest agent release receives fixes; the API rejects agents below the minimum version with `426`.
