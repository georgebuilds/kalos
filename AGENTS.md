# Kalos — Agent Guide

Kalos is an autonomous coding agent system. It accepts tasks (REST or MCP), spins up isolated execution contexts (per-task Docker container or per-task host process), runs **Claude Code in headless mode** inside that context to resolve the task, and opens a pull request with the result.

## Repository layout

```
packages/
  orchestrator/   HTTP server + task queue + DB + REST + MCP server
  agent/          Per-task wrapper that primes mise, spawns Claude Code, commits, opens the PR
  shared/         Cross-package model registry (the only shared module)
```

## Stack

| Package | Orchestrator | Agent |
|---|---|---|
| Runtime | Node 22 (run via `tsx`) | Node 22 (run via `tsx`) |
| `hono` + `@hono/node-server` | HTTP server | — |
| `better-sqlite3` | Raw SQL via prepared statements | — |
| `@octokit/rest` | GitHub API (hand-rolled JWT auth) | GitHub API (PR creation) |
| `ulid` | Task ID generation | — |
| `@modelcontextprotocol/sdk` | MCP server | — |
| `@anthropic-ai/claude-code` | — | Spawned via `claude -p ...` per task |
| `vitest` | Tests | Tests |

Node-everywhere — no Bun, no Vercel AI SDK, no provider mux. Claude Code is the agent loop.

## Database

SQLite via `better-sqlite3` (synchronous, prepared statements). Schema is created on startup with `CREATE TABLE IF NOT EXISTS`. WAL mode is enabled on open.

**Durability note**: `PRAGMA synchronous = NORMAL` with WAL means the last committed transaction can be lost on an OS crash (but not a process crash). This is an intentional trade-off for a self-hosted orchestrator. Do not raise it to `FULL` without benchmarking write throughput; do not drop it to `OFF`.

Tables: `settings` (k/v), `tasks`, `task_logs`, `pr_reviews`, `webhook_deliveries`, `repo_settings` (per-repo model overrides). Helper functions exported from `packages/orchestrator/src/db/index.ts`:
- `insertTask`, `getTask`, `updateTask`, `getPendingTasks`, `getRunningTasks`, `getRecentTasksFiltered`
- `insertLog`, `getLogsForTask`, `getLogsForTaskSince`, `appendLogs`
- `getSetting`, `setSetting`, `getDefaultModelId`, `setDefaultModelId`
- `getRepoSettings`, `setRepoModelId`, `clearRepoSettings`, `listRepoSettings`

## Models

The model registry lives at [`packages/shared/src/models/index.ts`](packages/shared/src/models/index.ts) and is the single source of truth across packages. Six anthropic models — current + previous generation in each tier (opus, sonnet, haiku). Each entry has `{ id, label, slug, tier, current }`. The `slug` is what we pass to `claude --model`.

Resolution at task dispatch (highest precedence wins):
1. `tasks.model_id` — per-task override (POST `/tasks { modelId }`)
2. `repo_settings.model_id` — per-repo override (PUT `/repos/:owner/:repo/settings`)
3. `settings.default_model_id` — global default (set by wizard or PUT `/settings/default_model`)
4. `FALLBACK_MODEL_ID` — registry fallback (`sonnet-4.6`)

## Docker

Hand-rolled client in `packages/orchestrator/src/docker/client.ts` — communicates with the Docker daemon over the Unix socket (`DOCKER_SOCKET` env, default `/var/run/docker.sock`) using `node:http`'s `socketPath` option. No third-party Docker SDK.

## Git (agent)

Git operations in the agent use `node:child_process.spawnSync` directly — no `simple-git` or other wrapper.

## Validation

REST route handlers use plain TypeScript validation functions that throw on bad input (no Zod). The MCP server uses Zod (a transitive dependency via `@modelcontextprotocol/sdk`) only for MCP tool input schemas.

## Conventions

**Commit messages**: Start with an emoji, a space, then a terse description in the imperative, present tense. Example: `✨ add user authentication flow`

**Runtime**: Node 22 everywhere — orchestrator, agent container, and Dockerfiles. TypeScript runs via `tsx` (no compile step). Use `better-sqlite3` for DB, `node:child_process` for subprocesses, `@hono/node-server` for HTTP. Avoid Bun-isms.

## Agent loop

The agent process ([`packages/agent/src/index.ts`](packages/agent/src/index.ts)) is a thin wrapper around Claude Code:

1. Load required env (`TASK_ID`, `TASK_DESCRIPTION`, `REPO`, `BASE_BRANCH`, `NEW_BRANCH`, `KALOS_MODEL_ID`)
2. Load secrets (from `/run/secrets/agent.json` if present, else env)
3. Resolve the kalos model id → claude slug via the shared registry
4. Clone repo, create branch, prime mise (`installToolchain`)
5. Snapshot HEAD SHA
6. Spawn `claude -p "<task description>" --model <slug> --output-format stream-json --dangerously-skip-permissions --verbose` with cwd = workspace and a stripped env (only `ANTHROPIC_API_KEY`, `PATH`, `HOME`, etc.)
7. Stream Claude's stream-json events to the orchestrator log via stdout
8. After Claude exits cleanly: commit any leftover uncommitted changes, compare HEAD to the snapshot, push if there are commits, open the PR
9. Print `PR_URL=<url>` (or `PR_URL=` for empty) so the orchestrator can capture it

The wrapper does **not** define any tools — Claude Code provides its own (Bash, Read, Edit, etc.). The wrapper just frames the run.

## Cancellation

`packages/orchestrator/src/queue/worker.ts` exposes `cancelTask(taskId)`. Marks the task `cancelled` first (so monitorTask doesn't overwrite the status when the executor's `wait()` resolves with exitCode -1), then asks the executor to tear down. Pending tasks are marked `cancelled` immediately without dispatch.

Task statuses: `pending` → `running` → `completed | failed | cancelled`.

## API

### REST

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/tasks` | Create a task. Body: `{ repo, description, baseBranch?, modelId? }` → `{ id }` |
| `GET` | `/tasks` | List recent. Query: `?status=pending,running&limit=50` (status is comma-separated) |
| `GET` | `/tasks/:id` | Full task object |
| `POST` | `/tasks/:id/cancel` | Cancel pending or running task. 409 if already terminal. |
| `GET` | `/tasks/:id/logs` | SSE stream of log events |
| `GET` | `/models` | Registry entries |
| `GET` | `/settings/default_model` | Current global default |
| `PUT` | `/settings/default_model` | Body: `{ modelId }` |
| `GET` | `/repos` | All repos with overrides |
| `GET` | `/repos/:owner/:repo/settings` | Per-repo overrides |
| `PUT` | `/repos/:owner/:repo/settings` | Body: `{ modelId }` (or `{ modelId: null }` to clear) |
| `DELETE` | `/repos/:owner/:repo/settings` | Drop the row entirely |
| `POST` | `/webhooks/github` | GitHub webhook (signed) |
| `GET` | `/health` | Liveness probe |

### Webhook events

- `pull_request` (opened, synchronize) — triggers automatic PR review (uses Anthropic Messages API directly with the global default model)
- `check_run` (completed, conclusion: failure / timed_out / action_required) — fires when CI fails on a `kalos/task-*` branch. If the originating task has fewer than `CI_FIX_MAX_ATTEMPTS` retries, a new task is queued with the CI failure output appended to the description. The new agent checks out the existing branch and pushes a fix.

GitHub App permissions:
- Contents → Read & Write
- Pull requests → Read & Write
- Metadata → Read-only
- Checks → Read-only (required for CI follow-through)

Webhook events to subscribe:
- Pull request
- Check run

## MCP Server

Kalos exposes its task management as an MCP server via Streamable HTTP (spec `2025-03-26`).

**Endpoints**:

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/mcp` | Send JSON-RPC requests (tool calls, initialization) |
| `GET` | `/mcp` | Open an SSE stream to receive server-initiated messages |
| `DELETE` | `/mcp` | Tear down a session (returns 200; stateless server ignores session ID) |

**Transport**: Stateless Streamable HTTP — each request creates a fresh transport; no `Mcp-Session-Id` required.
**Auth**: Same `X-Api-Key` header as the REST API. The orchestrator refuses to start without `KALOS_API_KEY` (wizard auto-generates one); the only way to run open is `KALOS_ALLOW_OPEN=true`, intended for localhost dev only.

### Tools

| Tool | Inputs | Returns |
|---|---|---|
| `create_task` | `repo` (owner/repo), `description`, `baseBranch?` (default: `main`), `modelId?` | `{ id }` |
| `get_task` | `id` | Full task object |
| `list_tasks` | `limit?` (default 20, max 100), `status?` (array of `pending\|running\|completed\|failed\|cancelled`) | Array of task objects |
| `cancel_task` | `id` | `{ id, status }` — error if task not cancellable |
| `get_task_logs` | `id`, `since?` (log row ID cursor, default 0) | `{ logs: [{id, line, ts}], nextCursor }` |

Pass `status: ["pending", "running"]` to `list_tasks` to get "active jobs".

### Claude Desktop config

```json
{
  "mcpServers": {
    "kalos": {
      "type": "url",
      "url": "http://localhost:3000/mcp",
      "headers": { "X-Api-Key": "your-key-here" }
    }
  }
}
```

## Environment variables

| Variable | Used by | Purpose |
|---|---|---|
| `DATABASE_URL` | orchestrator | SQLite file path (default: `kalos.db`) |
| `PORT` | orchestrator | HTTP port (default: `3000`) |
| `DOCKER_SOCKET` | orchestrator | Docker socket path |
| `GITHUB_APP_ID` | orchestrator | GitHub App ID |
| `GITHUB_APP_PRIVATE_KEY` | orchestrator | GitHub App private key (PEM string) |
| `GITHUB_APP_PRIVATE_KEY_PATH` | orchestrator | Path to PEM file (alternative to above) |
| `GITHUB_INSTALLATION_ID` | orchestrator | GitHub App installation ID |
| `GITHUB_WEBHOOK_SECRET` | orchestrator | Webhook HMAC secret |
| `KALOS_API_KEY` | orchestrator | Bearer token for the Kalos REST API + MCP server. Required — orchestrator refuses to start without it (wizard auto-generates one for new installs) |
| `KALOS_ALLOW_OPEN` | orchestrator | Opt back into open auth when `KALOS_API_KEY` is unset. Localhost dev only |
| `KALOS_WORKSPACE_ROOT` | orchestrator | Per-task clone scratch dir (`EXECUTOR=process` only, default `~/.local/share/kalos/workspaces`) |
| `KALOS_TOOLCHAIN_DIR` | orchestrator | Shared mise data dir (`EXECUTOR=process` only, default `~/.local/share/kalos/mise`) |
| `KALOS_TOOLCHAIN_VOLUME` | orchestrator | Named Docker volume backing the in-container mise cache (`EXECUTOR=docker` only, default `kalos-mise-cache`) |
| `AGENT_IMAGE` | orchestrator | Docker image to run for each task |
| `WORKER_POLL_INTERVAL_MS` | orchestrator | How often the worker polls for pending tasks |
| `MAX_CONCURRENT_TASKS` | orchestrator | Maximum tasks running simultaneously |
| `TASK_TIMEOUT_MS` | orchestrator | Per-task timeout before the container is killed |
| `ANTHROPIC_API_KEY` | orchestrator + agent | Anthropic API key. Orchestrator uses it for PR review; passed to the agent for Claude Code. |
| `GITHUB_TOKEN` | agent | GitHub installation token (orchestrator generates per-task) |
| `REPO` | agent | Repository in `owner/name` format |
| `BASE_BRANCH` | agent | Branch to fork from |
| `NEW_BRANCH` | agent | Branch the agent commits to |
| `TASK_ID` | agent | Task ID for logging |
| `TASK_DESCRIPTION` | agent | Issue/task text passed as Claude Code's `-p` prompt |
| `KALOS_MODEL_ID` | agent | Resolved kalos model id; agent maps to slug via the shared registry |
| `AGENT_WORKSPACE` | agent | Working directory (per-task path on process executor, `/workspace` in docker) |
| `MISE_DATA_DIR` | agent | Shared mise install cache (set by orchestrator on `EXECUTOR=process`) |
| `CI_FIX_MAX_ATTEMPTS` | orchestrator | Max CI fix retry loops per task (default 3, 0 = disabled) |
| `CHECKOUT_EXISTING_BRANCH` | agent | If 1, check out an existing remote branch instead of creating one |
| `FORCE_PUSH` | agent | If 1, push with --force-with-lease |

The default model is **not** an env var — it lives in `settings.default_model_id` in the kalos database. Set it via the wizard (first run) or `PUT /settings/default_model`.

## Toolchain resolution (mise)

Before Claude Code starts, `installToolchain` (in `packages/agent/src/runtime.ts`) reads the cloned workspace's `.tool-versions` (priority) or `.nvmrc` / `.node-version` / `go.mod` / `composer.json` / `package.json#packageManager`, and runs `mise install` with the resolved set. When Claude shells out (its Bash tool), mise's shims on PATH provide the pinned versions.

**Cache locations:**

| Executor | Cache mechanism | Set by |
|---|---|---|
| `process` | host directory at `KALOS_TOOLCHAIN_DIR` (default `~/.local/share/kalos/mise`) | `MISE_DATA_DIR` env var on `spawn` |
| `docker` | named Docker volume `KALOS_TOOLCHAIN_VOLUME` (default `kalos-mise-cache`) bound to `/cache/mise` | `MISE_DATA_DIR=/cache/mise` env var, set in the container |

The agent image (`packages/agent/Dockerfile`, based on `node:22-slim`) ships with mise installed system-wide and pre-seeds node 20/22 and go 1.23 into `/cache/mise`. Claude Code is also installed globally via `npm install -g @anthropic-ai/claude-code`. On the first task ever, Docker's volume init copies the mise seeds into the named volume. Subsequent tasks reuse the volume directly. PHP is intentionally not pre-seeded; first task per PHP version takes a few minutes to compile, then cached. Build deps (`build-essential`, `libssl-dev`, `libonig-dev`, etc.) are in the image so any mise-supported language compiles cleanly.

Mise is optional in the process executor. If `mise` is not on PATH, `installToolchain` and `commandArgs` degrade gracefully and the agent runs against whatever interpreters the host already has. Tests rely on this fallback (`_setMiseAvailability(false)` in `runtime.test.ts`).

## Agent stdout protocol

The agent communicates its result to the orchestrator via a line printed to stdout:

```
PR_URL=https://github.com/owner/repo/pull/123
```

The orchestrator scans the captured stdout for the **last** line matching `PR_URL=<url>` and records it as the task result. The URL must be a valid `github.com/…/pull/<n>` URL with no trailing content. If no valid line is found the task completes without a recorded PR URL.

On `SIGTERM` (timeout or cancellation) the agent emits `PR_URL=` (empty) so the orchestrator still gets a terminal signal rather than hanging.

## Tests

Run `npm test` (vitest) from the repo root. Highlights:

- `packages/orchestrator/src/queue/worker.smoke.test.ts` — end-to-end smoke covering the full POST → dispatch → executor → status writeback path with a stubbed executor (no real claude / git / github calls)
- `packages/orchestrator/src/db/index.test.ts` — real in-memory SQLite, covers schema + helpers
- `packages/orchestrator/src/routes/*.test.ts` — Hono routers with stubbed db / worker
- `packages/agent/src/git.test.ts` — real `git` against a tmp dir
- `packages/agent/src/runtime.test.ts` — toolchain detection
