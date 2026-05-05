# Kalos — Agent Guide

Kalos is an autonomous coding agent system. It listens for GitHub issues, spins up isolated Docker containers, runs an AI agent loop inside each container to resolve the issue, and opens a pull request with the result.

## Repository layout

```
packages/
  orchestrator/   HTTP server + task queue + DB
  agent/          Agent process that runs inside Docker
```

## Stack

| Package | Orchestrator | Agent |
|---|---|---|
| Runtime | Bun | Bun |
| `hono` | HTTP server | — |
| `bun:sqlite` (built-in) | Raw SQL via prepared statements | — |
| `@octokit/rest` | GitHub API (hand-rolled JWT auth) | — |
| `ulid` | Task ID generation | — |
| `ai` + `@ai-sdk/anthropic` | — | Agent loop (Vercel AI SDK) |
| `@modelcontextprotocol/sdk` | MCP server (orchestrator only) | — |

## Database

SQLite via `bun:sqlite` (built-in, no ORM). Schema is created on startup with `CREATE TABLE IF NOT EXISTS`. WAL mode is enabled on open. All DB calls are synchronous.

**Durability note**: `PRAGMA synchronous = NORMAL` with WAL means the last committed transaction can be lost on an OS crash (but not a process crash). This is an intentional trade-off for a self-hosted orchestrator. Do not raise it to `FULL` without benchmarking write throughput; do not drop it to `OFF`.

Tables: `tasks`, `task_logs`. Helper functions exported from `packages/orchestrator/src/db/index.ts`:
- `insertTask`, `getTask`, `updateTask`, `getPendingTasks`, `getRunningTasks`
- `insertLog`, `getLogsForTask`, `getLogsForTaskSince`, `appendLogs`

## Docker

Hand-rolled client in `packages/orchestrator/src/docker/client.ts` — communicates with the Docker daemon over the Unix socket (`DOCKER_SOCKET` env, default `/var/run/docker.sock`) using Bun's native `fetch` with the `unix` option. No third-party Docker SDK.

## Git (agent)

Git operations in the agent use `Bun.spawnSync` directly — no `simple-git` or other wrapper.

## Validation

REST route handlers use plain TypeScript validation functions that throw on bad input (no Zod). The MCP server uses Zod (a transitive dependency via `@modelcontextprotocol/sdk`) only for MCP tool input schemas.

## Conventions

**Commit messages**: Start with an emoji, a space, then a terse description in the imperative, present tense. Example: `✨ add user authentication flow`

**Runtime**: Bun everywhere — orchestrator, agent container, and Dockerfiles.
Use `bun:sqlite` for DB, `Bun.spawnSync` for subprocesses, `Bun.serve` for HTTP.
Avoid importing `node:child_process` or `node:http` — prefer Bun-native equivalents.

## API

### `POST /webhooks/github`
Receives GitHub webhook events. Currently handles:
- `pull_request` (opened, synchronize) — triggers automatic PR review
Requires `GITHUB_WEBHOOK_SECRET` env var. Returns 200 immediately, review posted async.

### `check_run` (completed, conclusion: failure/timed_out/action_required)
Fires when CI fails on a `kalos/task-*` branch. If the originating task has
fewer than `CI_FIX_MAX_ATTEMPTS` retries, a new task is queued with the CI
failure output appended to the description. The new agent checks out the
existing branch and pushes a fix. Requires the GitHub App to have `checks: read`
permission and the webhook to be subscribed to **Check run** events.

GitHub App permissions required for this feature:
- Checks → Read-only (required for CI follow-through)

Webhook events to subscribe:
- Pull requests
- Check runs

## MCP Server

Kalos exposes its task management as an MCP server via Streamable HTTP (spec `2025-03-26`).

**Endpoint**: `POST /mcp` (also `GET /mcp` for SSE, `DELETE /mcp` for session teardown)
**Transport**: Stateless Streamable HTTP — each request creates a fresh transport; no `Mcp-Session-Id` required.
**Auth**: Same `X-Api-Key` header as the REST API. Open when `KALOS_API_KEY` is unset.

### Tools

| Tool | Inputs | Returns |
|---|---|---|
| `create_task` | `repo` (owner/repo), `description`, `baseBranch`? (default: `main`) | `{ id }` |
| `get_task` | `id` | Full task object |
| `list_tasks` | `limit`? (default 20, max 100) | Array of task objects |
| `get_task_logs` | `id`, `since`? (log row ID cursor, default 0) | `{ logs: [{id, line, ts}], nextCursor }` |

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
| `KALOS_API_KEY` | orchestrator | Bearer token for the Kalos REST API |
| `AGENT_IMAGE` | orchestrator | Docker image to run for each task |
| `WORKER_POLL_INTERVAL_MS` | orchestrator | How often the worker polls for pending tasks |
| `MAX_CONCURRENT_TASKS` | orchestrator | Maximum tasks running simultaneously |
| `TASK_TIMEOUT_MS` | orchestrator | Per-task timeout before the container is killed |
| `LLM_API_KEY` | agent | API key for the LLM provider |
| `LLM_PROVIDER` | agent | LLM provider (e.g. `anthropic`, `openai`) |
| `LLM_MODEL` | agent | Model name to use |
| `LLM_BASE_URL` | agent | Base URL override for the LLM API |
| `GITHUB_TOKEN` | agent | GitHub token for git push |
| `REPO` | agent | Repository in `owner/name` format |
| `BASE_BRANCH` | agent | Branch to fork from |
| `NEW_BRANCH` | agent | Branch the agent commits to |
| `TASK_ID` | agent | Task ID for logging |
| `TASK_DESCRIPTION` | agent | Issue/task text passed to the agent |
| `AGENT_WORKSPACE` | agent | Working directory inside the container |
| `CI_FIX_MAX_ATTEMPTS` | orchestrator | Max CI fix retry loops per task (default 3, 0 = disabled) |
| `CHECKOUT_EXISTING_BRANCH` | agent | If 1, check out an existing remote branch instead of creating one |
| `FORCE_PUSH` | agent | If 1, push with --force-with-lease |

## Agent stdout protocol

The agent communicates its result to the orchestrator via a line printed to stdout:

```
PR_URL=https://github.com/owner/repo/pull/123
```

The orchestrator scans the captured stdout for the **last** line matching `PR_URL=<url>` and records it as the task result. The URL must be a valid `github.com/…/pull/<n>` URL with no trailing content. If no valid line is found the task completes without a recorded PR URL.

On `SIGTERM` (timeout or cancellation) the agent emits `PR_URL=` (empty) so the orchestrator still gets a terminal signal rather than hanging.
