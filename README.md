# Kalos

Kalos is an open-source, self-hosted coding agent orchestrator. You give it a task via REST API, it spins up Claude Code against the target repo (clone → branch → write code → commit → open PR), and hands you back a pull request URL. Optionally, it can also review PRs and retry failed CI automatically.

---

## How it works

1. You `POST /tasks` with a repo and a description of what you want done
2. Kalos queues the task and dispatches an agent when a slot is free
3. The agent clones the repo, primes mise, runs `claude -p "<your task>"` headless, then commits, pushes, and opens a PR
4. Task status and logs are available via REST + SSE in real time
5. Optionally: Kalos reviews the PR via webhook, and re-queues a fix task if CI fails

---

## Stack

- **Runtime:** Node 22 everywhere — orchestrator, agent, Dockerfiles. TypeScript runs via `tsx` (no compile step).
- **HTTP:** Hono on `@hono/node-server`
- **Database:** `better-sqlite3` — raw SQL, WAL mode, no ORM
- **Agent loop:** [Claude Code](https://docs.claude.com/en/docs/claude-code/overview) in headless mode (`claude -p ...`). Anthropic-only.
- **Models:** registry of 6 anthropic models in [`packages/shared/src/models/index.ts`](packages/shared/src/models/index.ts) — Opus / Sonnet / Haiku, current + previous gen each
- **GitHub:** `@octokit/rest`, GitHub App auth via hand-rolled JWT
- **Docker:** hand-rolled Unix socket client over `node:http` — used only when `EXECUTOR=docker`
- **MCP:** Streamable HTTP server exposing task management tools to MCP clients (Claude Desktop, etc.)
- **Tests:** vitest
- **Monorepo:** npm workspaces — `packages/orchestrator`, `packages/agent`, `packages/shared`

---

## Self-hosting

There are two deployment paths. Both require a GitHub App and an Anthropic API key. The difference is how agent tasks are executed.

| | PaaS | VPS + Docker |
|---|---|---|
| `EXECUTOR` | `process` (default) | `docker` |
| Docker required | No | Yes |
| Deploy to | Railway, Fly, Render, etc. | Any Linux VPS |
| Isolation | OS process | Docker container |
| On orchestrator restart | Running tasks fail | Running tasks re-attach |

### Step 0 — Create a GitHub App (required for both paths)

Go to **GitHub → Settings → Developer settings → GitHub Apps → New GitHub App** and configure:

- **Homepage URL:** anything (e.g. `http://localhost`)
- **Webhook URL:** your deployment URL + `/webhooks/github` (e.g. `https://kalos.example.com/webhooks/github`) — required only for PR review and CI fix features

**Permissions:**

| Permission | Level | Required for |
|---|---|---|
| Contents | Read & Write | clone, branch, commit, push |
| Pull requests | Read & Write | open and review PRs |
| Metadata | Read-only | repo access |
| Checks | Read-only | CI follow-through |

**Subscribe to events** (only needed for PR review / CI fix):
- Pull request
- Check run

After saving: generate a **private key** (downloads as a `.pem` file), then **install the app** on your account or org. Note the **App ID** (shown on the app settings page) and the **Installation ID** (the number at the end of the install URL: `github.com/settings/installations/XXXXXXX`).

---

### Path A — PaaS deployment (no Docker, recommended for individuals)

`EXECUTOR=process` runs the agent as a child Node process on the same machine as the orchestrator. No Docker daemon needed, so you can deploy to any platform that runs a persistent Node process.

**Works on:** Railway, Fly.io, Render, any VPS, your laptop.

**Requirements:**
- Node 22 on the host. (The orchestrator and agent both run as Node processes; in process mode the agent shares the orchestrator's host.)
- Persistent disk for the SQLite database (`DATABASE_URL`). Most PaaS platforms offer this as a volume.
- Claude Code on PATH: `npm install -g @anthropic-ai/claude-code`. The agent shells out to `claude` for every task.
- Recommended: install [mise](https://mise.jdx.dev) on the host (`curl https://mise.run | sh`). The agent reads the target repo's `.tool-versions` / `.nvmrc` / `go.mod` / `composer.json` and uses mise to provide the right node/go/php version when running tests. Without mise the agent falls back to whatever interpreters are already on PATH. Cache lives at `KALOS_TOOLCHAIN_DIR` (default `~/.local/share/kalos/mise`) and is shared across tasks.

> Process mode means the host carries the full agent toolchain (node, mise, claude code, build-essential for any compiled languages) plus per-task workspace disk. Docker mode keeps the orchestrator host slim — the heavy stuff lives inside the per-task container instead.

#### 1. Clone the repo

```bash
git clone https://github.com/georgebuilds/kalos
cd kalos
npm install
```

#### 2. Run the wizard

```bash
npm run dev:orchestrator
```

The first run drops you into an interactive setup wizard that prompts for your Anthropic key, default model, and GitHub App config, validates each against the live API, and writes the result to `.env` + the kalos database. Re-run the orchestrator after the wizard completes.

If you'd rather skip the wizard, set `setup_complete=true` in the `settings` table and provide these env vars manually:

```env
EXECUTOR=process

ANTHROPIC_API_KEY=sk-ant-...

GITHUB_APP_ID=
GITHUB_APP_PRIVATE_KEY_PATH=kalos.pem   # path to the .pem file you downloaded
GITHUB_INSTALLATION_ID=

KALOS_API_KEY=...                       # required — generate with: openssl rand -hex 32
KALOS_TRUST_PROXY=true                  # set this if running behind a reverse proxy
```

**`KALOS_API_KEY` is required.** The orchestrator refuses to start without it (the wizard auto-generates one for new installs). Set `KALOS_ALLOW_OPEN=true` to opt back into open auth — intended for trusted localhost dev only; do not set in production.

#### 3. Verify

```bash
curl http://localhost:3000/health
```

You should get `{"ok":true}`.

**Security note:** with `EXECUTOR=process` the agent shares the orchestrator's OS user and filesystem. Only run tasks from repos and users you trust.

---

### Path B — VPS with Docker

`EXECUTOR=docker` runs each agent inside an isolated Docker container (512 MB RAM cap, `--cap-drop ALL`). Use this for team deployments or when you want stronger isolation.

**Requires:** a Linux VPS with Docker daemon, and the `kalos-agent` image built or pulled. The agent image already includes Claude Code (`@anthropic-ai/claude-code` installed globally), node 22, and mise.

Pre-built images are published to GHCR at `ghcr.io/georgebuilds/kalos-orchestrator:latest` and `ghcr.io/georgebuilds/kalos-agent:latest`.

The agent image ships with [mise](https://mise.jdx.dev) and pre-seeded copies of node 20/22 and go 1.23. A named Docker volume (`KALOS_TOOLCHAIN_VOLUME`, default `kalos-mise-cache`) persists the cache across tasks so first-task latency for any new (language, version) pair is paid once. PHP is **not** pre-seeded — its plugin compiles from source — but the build deps are baked in, so the first task that wants `php@8.x` will install it (slow), and every task after will reuse the volume.

**Minimum spec:** 1 vCPU / 1 GB RAM / 25 GB disk (a $7/mo Hetzner or DigitalOcean box works fine).

#### 1. Provision the server

SSH into a fresh Ubuntu 24.04 server and run:

```bash
curl -fsSL https://get.docker.com | sh && \
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile && \
  echo '/swapfile none swap sw 0 0' >> /etc/fstab && \
  git clone https://github.com/georgebuilds/kalos.git /opt/kalos && \
  chmod +x /opt/kalos/deploy/setup.sh
```

#### 2. Upload your PEM

From your local machine:

```bash
scp ~/Downloads/your-app.pem root@YOUR_SERVER_IP:/opt/kalos/kalos.pem
```

#### 3. Run the setup script

```bash
bash /opt/kalos/deploy/setup.sh
```

The script walks you through every environment variable interactively, pulls the published images, and starts the stack. Takes about two minutes.

#### 4. Verify

```bash
curl http://localhost:3000/health
```

**Day-to-day commands** (run from `/opt/kalos`):

```bash
make deploy    # pull the latest image and restart
make logs-prod # tail live logs
```

---

## Local development

```bash
git clone https://github.com/georgebuilds/kalos
cd kalos
npm install
npm run dev:orchestrator
```

The first invocation runs the setup wizard. After that, `npm run dev:orchestrator` reloads on file changes via `tsx watch`.

Docker is not required for local development — `EXECUTOR=process` is the default.

If you want to test the Docker executor locally:

```bash
make agent-image      # builds kalos-agent:latest
EXECUTOR=docker npm run dev:orchestrator
```

---

## Dashboard

Visit `http://localhost:3000/` in a browser for a live read-only view of recent tasks, env-var health checks, and the active default model. Same `X-Api-Key` (passed via `?key=` on the URL or the `X-Api-Key` header) — gated by the same auth as the REST API.

---

## REST API

All endpoints require the `X-Api-Key` header. (The orchestrator refuses to start without `KALOS_API_KEY`; the only way to run open is to explicitly set `KALOS_ALLOW_OPEN=true`.)

### Create a task

```http
POST /tasks
Content-Type: application/json
X-Api-Key: your-api-key

{
  "repo": "owner/repo",
  "description": "Add input validation to the login form",
  "baseBranch": "main",        // optional, defaults to "main"
  "modelId": "opus-4.7"        // optional; defaults to repo override → global default
}
```

Response:

```json
{ "id": "01HXYZ..." }
```

### List recent tasks

```http
GET /tasks
GET /tasks?status=pending,running        // filter — comma-separated
GET /tasks?status=running&limit=50
```

### Get a task

```http
GET /tasks/:id
```

Task statuses: `pending` → `running` → `completed` | `failed` | `cancelled`.

Completed tasks include a `prUrl` field with the pull request URL.

### Cancel a task

```http
POST /tasks/:id/cancel
```

Cancels a pending or running task. Returns 409 if the task is already in a terminal state.

### Stream task logs

```http
GET /tasks/:id/logs
```

Returns a Server-Sent Events stream. Each event is a JSON object with `line` and `ts`. A final `event: done` is emitted when the task finishes.

```bash
curl -N -H "X-Api-Key: your-key" http://localhost:3000/tasks/01HXYZ.../logs
```

### Models & defaults

```http
GET /models                              # list registry entries
GET  /settings/default_model
PUT  /settings/default_model             # body: { "modelId": "sonnet-4.6" }
GET  /repos/:owner/:repo/settings        # per-repo override
PUT  /repos/:owner/:repo/settings        # body: { "modelId": "opus-4.7" } or { "modelId": null }
DELETE /repos/:owner/:repo/settings
```

Model precedence at dispatch: per-task `modelId` → per-repo override → global default → registry fallback (`sonnet-4.6`).

### GitHub webhook

```http
POST /webhooks/github
```

Handles `pull_request` events (triggers automatic PR review) and `check_run` events (triggers CI fix retry). Requires `GITHUB_WEBHOOK_SECRET`.

---

## MCP server

Kalos exposes its task management as an MCP server via Streamable HTTP at `/mcp`. Tools: `create_task`, `get_task`, `list_tasks` (with optional `status` filter), `cancel_task`, `get_task_logs`. See [AGENTS.md](./AGENTS.md) for the full schema and a Claude Desktop config snippet.

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `EXECUTOR` | `process` | `process` — agent runs as a child process; `docker` — agent runs in a container |
| `PORT` | `3000` | HTTP port |
| `DATABASE_URL` | `kalos.db` | SQLite file path (must be on persistent storage in PaaS deployments) |
| `KALOS_API_KEY` | — | Bearer token for the REST API + MCP server. **Required** — orchestrator refuses to start without it (wizard auto-generates one) |
| `KALOS_ALLOW_OPEN` | `false` | Opt back into open auth when `KALOS_API_KEY` is unset. Localhost dev only — do not set in production |
| `KALOS_TRUST_PROXY` | `false` | Trust `X-Forwarded-For` for rate limiting — set to `true` behind a reverse proxy |
| `MAX_CONCURRENT_TASKS` | `1` | Max agents running simultaneously |
| `WORKER_POLL_INTERVAL_MS` | `2000` | How often the worker checks for pending tasks |
| `TASK_TIMEOUT_MS` | `600000` | Per-task timeout in ms |
| `CI_FIX_MAX_ATTEMPTS` | `3` | Max CI fix retries per task. Set to `0` to disable |
| `ANTHROPIC_API_KEY` | — | Anthropic API key — passed to Claude Code as the agent loop's auth |
| `GITHUB_APP_ID` | — | GitHub App ID |
| `GITHUB_APP_PRIVATE_KEY_PATH` | `kalos.pem` | Path to the GitHub App private key PEM file |
| `GITHUB_APP_PRIVATE_KEY` | — | Inline PEM string (alternative to path) |
| `GITHUB_INSTALLATION_ID` | — | GitHub App installation ID |
| `GITHUB_WEBHOOK_SECRET` | — | HMAC secret for validating GitHub webhook payloads |
| `KALOS_WORKSPACE_ROOT` | `~/.local/share/kalos/workspaces` | Per-task clone scratch (`EXECUTOR=process` only) |
| `KALOS_TOOLCHAIN_DIR` | `~/.local/share/kalos/mise` | Shared mise data dir for cached runtimes (`EXECUTOR=process` only) |
| `DOCKER_SOCKET` | `/var/run/docker.sock` | Docker daemon socket (`EXECUTOR=docker` only) |
| `AGENT_IMAGE` | `kalos-agent:latest` | Docker image for agent containers (`EXECUTOR=docker` only) |
| `KALOS_TOOLCHAIN_VOLUME` | `kalos-mise-cache` | Docker named volume backing the in-container mise cache (`EXECUTOR=docker` only) |

The default model lives in the kalos database (`settings.default_model_id`), set by the wizard or via `PUT /settings/default_model`.

---

## Concurrency

Kalos defaults to `MAX_CONCURRENT_TASKS=1` — one agent runs at a time, the rest queue. This is the right default for personal use.

For team or org deployments, increase `MAX_CONCURRENT_TASKS` to match your resources. With `EXECUTOR=docker`, each agent is capped at 512 MB RAM. With `EXECUTOR=process`, agents share the host's memory — size accordingly.

---

## Security

- **`EXECUTOR=process`:** the agent runs as the orchestrator's OS user with access to the host filesystem. Set `KALOS_API_KEY` and only accept tasks from repos you trust. Not suitable for multi-tenant use.
- **`EXECUTOR=docker`:** containers run with `--cap-drop ALL` and a 512 MB memory limit. The only mount is the named toolchain volume (`kalos-mise-cache`) at `/cache/mise` — agents have no access to the host filesystem. Better isolation than process mode, but prompt injection could still exfiltrate data over the network.
- The agent strips secrets (`ANTHROPIC_API_KEY`, `GITHUB_TOKEN`) from the env it hands to Claude Code's Bash tool. Claude can't `env | curl` your tokens to a third party.
- API key auth via `KALOS_API_KEY` (strongly recommended in both cases)
- Webhook payloads validated with HMAC-SHA256 against `GITHUB_WEBHOOK_SECRET`
- Rate limiting on task creation: 20 requests per IP per minute

---

## Development

```bash
# Type check all packages
npm run typecheck

# Run tests (vitest)
npm test

# Format
npm run format

# Format check (used in CI)
npm run format:check
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for contribution guidelines and [AGENTS.md](./AGENTS.md) for the full architecture reference.

---

## License

MIT
