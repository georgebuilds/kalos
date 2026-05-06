.PHONY: up down build logs agent-image typecheck test cleanup deploy logs-prod

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
	npm run typecheck

test:
	npm test

# Prune log rows + completed task rows older than 30 days. Same retention the
# orchestrator runs at boot via cleanupOldData(); this target is for ops folks
# who want to invoke it manually outside of a restart.
cleanup:
	DATABASE_URL=$${DATABASE_URL:-kalos.db} npx tsx -e " \
	  import('./packages/orchestrator/src/db/index.ts').then(({ cleanupOldData }) => cleanupOldData()); \
	"
