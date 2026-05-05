# Contributing to Kalos

## Welcome

Kalos is open to contributions! If you're planning a large change, please open an issue first to discuss it — that saves everyone time and avoids duplicate effort.

## Development setup

```bash
git clone https://github.com/georgebuilds/kalos
cd kalos
bun install
cp .env.example .env  # fill in your keys

# Build agent image
make agent-image

# Start orchestrator in dev mode (hot reload)
bun --cwd packages/orchestrator --watch src/index.ts
```

## Project structure

- **`packages/orchestrator`** — HTTP server, task queue, SQLite DB, Docker client, and GitHub webhook handler. Receives events and dispatches agent containers.
- **`packages/agent`** — Agent process that runs inside Docker. Clones the repo, runs the AI loop, commits changes, and opens a pull request.

See `AGENTS.md` for the full architectural context.

## Making changes

- Fork the repo and create a branch from `main`
- Run `make typecheck` before pushing
- Tests: `bun test` from root
- Open a PR — CI must pass before merge

## What we're looking for

- Bug fixes
- New LLM provider support
- Agent tool improvements
- Documentation improvements

## What to discuss first (open an issue)

- New features
- Breaking API changes
- Changes to the agent system prompt

## Code style

- TypeScript strict mode, no `any`
- Prettier defaults (run `bun run format` to auto-fix, `bun run format:check` to verify)
- No new runtime dependencies without discussion
