# agent-ops: local Hub operations agents run without Oscar

Oscar, 1 Oct 2026: agents should release, restart and merge the LOCAL Hub (vacsoserver, reached over
Tailscale) without him relaying commands. Railway/Neon production is out of scope and stays a manual promotion.

Each tool carries its own safety gates, so the permission rule can allow exactly these entry points:

| Tool | Does | Gates |
|---|---|---|
| `release-hub.ps1 --sha master [--execute]` | Releases current vacso-hub master to the local runtime (images, fresh DB dump, compose, built frontend, finalize, checks) | sha == origin/master; merged PR's required checks all green; one release at a time; reviewed env changes applied once; automatic rollback on step 7/8 failure |
| `deploy-bridge.cjs --sha master [--execute]` | Moves PM2 `claude-bridge` (:3939) to a commit | commit on master; bridge tests pass; keeps running env/cwd/interpreter; `/health` must be 200 or it rolls back |
| `wt-unlock.mjs [--execute]` | Clears a stale `.git/wt-registry.lock` | owner PID dead, same host, lock older than 5 min |
| `merge-when-green.sh <owner/repo> <pr>` | Merges when required checks pass, updating the branch when master moves | never `--admin`; stops on failed checks or conflicts |

Every tool defaults to a dry run, refuses to run when `agent-ops/` differs from `origin/main` (an agent
cannot edit a script and then execute it), appends to `%LOCALAPPDATA%\VACSO\agent-ops\audit.jsonl`, and raises
the result to the Hub One Inbox.

## Environment changes

A release copies the live containers' env. To change env, commit `release-env/pending.json`
(`id`, `reason`, `approvedBy`, `changes` as `[flag, value]` pairs using `--env-set`, `--env-set-from`,
`--env-unset`, `--env-assert`). The next release applies it once and records
`%LOCALAPPDATA%\VACSO\agent-ops\applied-env\<id>.json`; later releases skip it. Never put secret values in the
file: use `--env-set-from ... =dotenv:<file>:<KEY>`.

## Permission rules (Oscar's user settings)

```
Bash(powershell.exe -NoProfile -File C:/Users/oscar/Projects/vacso-ops/agent-ops/release-hub.ps1:*)
Bash(node C:/Users/oscar/Projects/vacso-ops/agent-ops/deploy-bridge.cjs:*)
Bash(node C:/Users/oscar/Projects/vacso-ops/agent-ops/wt-unlock.mjs:*)
Bash(bash C:/Users/oscar/Projects/vacso-ops/agent-ops/merge-when-green.sh:*)
```

Pinned release tooling lives in `%LOCALAPPDATA%\VACSO\recovery\reboot-activation-plan-20260923` and is never edited.
