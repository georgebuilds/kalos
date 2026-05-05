# Kalos

Kalos is an open-source, self-hosted coding agent orchestrator. You give it a task via REST API, it runs an AI agent loop (clone repo → branch → write code → commit → open PR), and hands you back a pull request URL. Optionally, it can also review PRs and retry failed CI automatically.

---

## How it works

1. You `POST /tasks` with a repo and a description of what you want done
2. Kalos queues the task and dispatches an agent when a slot is free
3. The agent clones the repo, runs an AI loop (Vercel AI SDK + your LLM of choice), commits the work, and opens a PR
4. The task status and logs are available via the API in real time
5. Optionally: Kalos reviews the PR via webhook, and re-queues a fix task if CI fails

---

## Stack

- **Runtime:** Bun everywhere — orchestrator, agent, Dockerfiles
- **HTTP:** Hono with `Bun.serve`
- **Database:** `bun:sqlite` — raw SQL, WAL mode, no ORM
- **Agent loop:** Vercel AI SDK (`generateText` + tools, `maxSteps`)
- **LLM:** configurable — supports `anthropic`, `openrouter`, `gradient`, `venice`, `ollama`
- **GitHub:** `@octokit/rest`, GitHub App auth via hand-rolled JWT
- **Docker:** hand-rolled Unix socket client — used only when `EXECUTOR=docker`
- **Monorepo:** npm workspaces — `packages/orchestrator` + `packages/agent`

---

## Self-hosting

There are two deployment paths. Both require a GitHub App and an LLM API key. The difference is how agent tasks are executed.

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

`EXECUTOR=process` runs the agent as a child process on the same machine as the orchestrator. No Docker daemon needed, so you can deploy to any platform that runs a persistent Bun process.

**Works on:** Railway, Fly.io, Render, any VPS, your laptop.

**Requirements:** persistent disk for the SQLite database (`DATABASE_URL`). Most PaaS platforms offer this as a volume or persistent storage option.

**Recommended:** install [mise](https://mise.jdx.dev) on the host (`curl https://mise.run | sh`). The agent reads the target repo's `.tool-versions` / `.nvmrc` / `go.mod` / `composer.json` and uses mise to provide the right node/bun/go/php version when running tests. Without mise the agent falls back to whatever interpreters are already on PATH. The runtime cache lives at `KALOS_TOOLCHAIN_DIR` (default `~/.local/share/kalos/mise`) and is shared across tasks.

#### 1. Clone the repo

```bash
git clone https://github.com/georgebuilds/kalos
cd kalos
bun install
```

#### 2. Configure environment

```bash
cp .env.example .env
```

Minimum required:

```env
EXECUTOR=process

LLM_PROVIDER=anthropic
LLM_API_KEY=sk-ant-...

GITHUB_APP_ID=
GITHUB_APP_PRIVATE_KEY_PATH=kalos.pem   # path to the .pem file you downloaded
GITHUB_INSTALLATION_ID=

KALOS_API_KEY=your-secret-key           # protects the REST API
KALOS_TRUST_PROXY=true                  # set this if running behind a reverse proxy
```

Copy your `.pem` file to the location you specified in `GITHUB_APP_PRIVATE_KEY_PATH`.

#### 3. Start the orchestrator

```bash
bun --cwd packages/orchestrator src/index.ts
```

Or with hot reload for development:

```bash
bun --cwd packages/orchestrator --watch src/index.ts
```

#### 4. Verify

```bash
curl http://localhost:3000/health
```

You should get `{"ok":true}`.

**Security note:** with `EXECUTOR=process` the agent shares the orchestrator's OS user and filesystem. Only run tasks from repos and users you trust.

---

### Path B — VPS with Docker

`EXECUTOR=docker` runs each agent inside an isolated Docker container (512 MB RAM cap, `--cap-drop ALL`). Use this for team deployments or when you want stronger isolation.

**Requires:** a Linux VPS with Docker daemon, and the `kalos-agent` image built or pulled.

Pre-built images are published to GHCR at `ghcr.io/georgebuilds/kalos-orchestrator:latest` and `ghcr.io/georgebuilds/kalos-agent:latest`.

The agent image ships with [mise](https://mise.jdx.dev) and pre-seeded copies of node 20/22, bun 1.2, and go 1.23. A named Docker volume (`KALOS_TOOLCHAIN_VOLUME`, default `kalos-mise-cache`) persists the cache across tasks so first-task latency for any new (language, version) pair is paid once. PHP is **not** pre-seeded — its plugin compiles from source — but the build deps are baked in, so the first task that wants `php@8.x` will install it (slow), and every task after will reuse the volume.

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
bun install
cp .env.example .env
# fill in LLM_API_KEY and GitHub App vars
bun --cwd packages/orchestrator --watch src/index.ts
```

Docker is not required for local development — `EXECUTOR=process` is the default.

If you want to test the Docker executor locally:

```bash
make agent-image      # builds kalos-agent:latest
EXECUTOR=docker bun --cwd packages/orchestrator src/index.ts
```

---

## REST API

All task endpoints require the `X-Api-Key` header when `KALOS_API_KEY` is set.

### Create a task

```http
POST /tasks
Content-Type: application/json
X-Api-Key: your-api-key

{
  "repo": "owner/repo",
  "description": "Add input validation to the login form",
  "baseBranch": "main"   // optional, defaults to "main"
}
```

Response:

```json
{ "id": "01HXYZ..." }
```

### List recent tasks

```http
GET /tasks
X-Api-Key: your-api-key
```

### Get a task

```http
GET /tasks/:id
X-Api-Key: your-api-key
```

Task statuses: `pending` → `running` → `completed` | `failed`

Completed tasks include a `prUrl` field with the pull request URL.

### Stream task logs

```http
GET /tasks/:id/logs
X-Api-Key: your-api-key
```

Returns a Server-Sent Events stream. Each event is a JSON object with `line` and `ts`. A final `event: done` is emitted when the task finishes.

```bash
curl -N -H "X-Api-Key: your-key" http://localhost:3000/tasks/01HXYZ.../logs
```

### GitHub webhook

```http
POST /webhooks/github
```

Handles `pull_request` events (triggers automatic PR review) and `check_run` events (triggers CI fix retry). Requires `GITHUB_WEBHOOK_SECRET`.

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `EXECUTOR` | `process` | `process` — agent runs as a child process; `docker` — agent runs in a container |
| `PORT` | `3000` | HTTP port |
| `DATABASE_URL` | `kalos.db` | SQLite file path (must be on persistent storage in PaaS deployments) |
| `KALOS_API_KEY` | — | Bearer token for the REST API. Strongly recommended in production |
| `KALOS_TRUST_PROXY` | `false` | Trust `X-Forwarded-For` for rate limiting — set to `true` behind a reverse proxy |
| `MAX_CONCURRENT_TASKS` | `1` | Max agents running simultaneously |
| `WORKER_POLL_INTERVAL_MS` | `2000` | How often the worker checks for pending tasks |
| `TASK_TIMEOUT_MS` | `600000` | Per-task timeout in ms |
| `CI_FIX_MAX_ATTEMPTS` | `3` | Max CI fix retries per task. Set to `0` to disable |
| `LLM_PROVIDER` | — | LLM backend: `anthropic`, `openrouter`, `gradient`, `venice`, `ollama` |
| `LLM_MODEL` | — | Model name |
| `LLM_API_KEY` | — | API key for the LLM provider |
| `LLM_BASE_URL` | — | Base URL override (required for `ollama`) |
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

---

## Concurrency

Kalos defaults to `MAX_CONCURRENT_TASKS=1` — one agent runs at a time, the rest queue. This is the right default for personal use.

For team or org deployments, increase `MAX_CONCURRENT_TASKS` to match your resources. With `EXECUTOR=docker`, each agent is capped at 512 MB RAM. With `EXECUTOR=process`, agents share the host's memory — size accordingly.

---

## Security

- **`EXECUTOR=process`:** the agent runs as the orchestrator's OS user with access to the host filesystem. Set `KALOS_API_KEY` and only accept tasks from repos you trust. Not suitable for multi-tenant use.
- **`EXECUTOR=docker`:** containers run with `--cap-drop ALL` and a 512 MB memory limit. The only mount is the named toolchain volume (`kalos-mise-cache`) at `/cache/mise` — agents have no access to the host filesystem. Better isolation than process mode, but prompt injection could still exfiltrate data over the network.
- API key auth via `KALOS_API_KEY` (strongly recommended in both cases)
- Webhook payloads validated with HMAC-SHA256 against `GITHUB_WEBHOOK_SECRET`
- Rate limiting on task creation: 20 requests per IP per minute

---

## Development

```bash
# Type check all packages
make typecheck

# Run tests
bun test

# Format
bun run format

# Format check (used in CI)
bun run format:check
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for contribution guidelines and [AGENTS.md](./AGENTS.md) for the full architecture reference.

---

## License

MIT
