FROM oven/bun:1.2-alpine

RUN apk add --no-cache git

WORKDIR /app

COPY package.json ./
COPY tsconfig.base.json ./
COPY packages/agent/package.json ./packages/agent/
COPY packages/shared/package.json ./packages/shared/

RUN bun install

COPY packages/agent/tsconfig.json ./packages/agent/
COPY packages/agent/src ./packages/agent/
COPY packages/shared/src ./packages/shared/src

RUN mkdir -p /workspace

WORKDIR /app/packages/agent

ENTRYPOINT ["bun", "src/index.ts"]
