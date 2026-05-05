FROM oven/bun:1.2-alpine

WORKDIR /app

COPY package.json ./
COPY tsconfig.base.json ./
COPY packages/orchestrator/package.json ./packages/orchestrator/
COPY packages/agent/package.json ./packages/agent/
COPY packages/shared/package.json ./packages/shared/

RUN bun install

COPY packages/orchestrator/tsconfig.json ./packages/orchestrator/
COPY packages/orchestrator/src ./packages/orchestrator/src
COPY packages/shared/src ./packages/shared/src

WORKDIR /app/packages/orchestrator

EXPOSE 3000

CMD ["bun", "src/index.ts"]
