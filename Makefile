.PHONY: up down build logs agent-image typecheck cleanup deploy logs-prod

up:
	docker compose up --build -d

down:
	docker compose down

build:
	docker compose build

agent-image:
	docker build -t kalos-agent:latest -f packages/agent/Dockerfile .

logs:
	docker compose logs -f orchestrator

deploy:
	docker compose -f deploy/docker-compose.yml up -d

logs-prod:
	docker compose -f deploy/docker-compose.yml logs -f

typecheck:
	bun --cwd packages/shared run typecheck
	bun --cwd packages/orchestrator run typecheck
	bun --cwd packages/agent run typecheck

cleanup:
	DATABASE_URL=$${DATABASE_URL:-kalos.db} bun -e " \
	  const {Database} = await import('bun:sqlite'); \
	  const db = new Database(process.env.DATABASE_URL ?? 'kalos.db'); \
	  const cutoff = Date.now() - 30*24*60*60*1000; \
	  const logs = db.run('DELETE FROM task_logs WHERE ts < ?', [cutoff]); \
	  const tasks = db.run('DELETE FROM tasks WHERE completed_at IS NOT NULL AND completed_at < ?', [cutoff]); \
	  console.log('[cleanup] deleted ' + logs.changes + ' log rows, ' + tasks.changes + ' task rows older than 30 days'); \
	"
