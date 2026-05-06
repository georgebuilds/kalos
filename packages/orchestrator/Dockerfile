FROM node:22-slim

# git + ca-certificates are only used by the orchestrator's startup wizard /
# health checks; nothing in the request path shells out.
RUN apt-get update && \
    apt-get install -y --no-install-recommends git ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
COPY tsconfig.base.json ./
COPY packages/orchestrator/package.json ./packages/orchestrator/
COPY packages/agent/package.json ./packages/agent/
COPY packages/shared/package.json ./packages/shared/

# tsx is a root devDep used as our TS runtime; keep devDependencies so the
# orchestrator can `npx tsx src/index.ts` at boot.
RUN npm install --no-audit --no-fund

COPY packages/orchestrator/tsconfig.json ./packages/orchestrator/
COPY packages/orchestrator/src ./packages/orchestrator/src
COPY packages/shared/src ./packages/shared/src

WORKDIR /app/packages/orchestrator

EXPOSE 3000

CMD ["npx", "tsx", "src/index.ts"]
