FROM oven/bun:1.2-slim

# Build deps cover everything mise might need to compile (PHP especially —
# mise's php plugin builds from source). git/curl/ca-certificates are runtime
# deps used by the agent itself.
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      git curl ca-certificates \
      build-essential pkg-config autoconf bison \
      libssl-dev libreadline-dev libsqlite3-dev libxml2-dev \
      libonig-dev libcurl4-openssl-dev libzip-dev libffi-dev \
      zlib1g-dev libbz2-dev && \
    rm -rf /var/lib/apt/lists/*

# Install mise system-wide so it's on PATH for any user / shell invocation.
RUN curl -fsSL https://mise.run | sh && \
    install -m 0755 /root/.local/bin/mise /usr/local/bin/mise && \
    rm -rf /root/.local/bin

# /cache/mise is the data root. At runtime it's a Docker named volume mounted
# in by the orchestrator — the volume's first-mount init copies the contents
# we seed below into the volume, so subsequent containers reuse the seeds.
ENV MISE_DATA_DIR=/cache/mise
ENV PATH=/cache/mise/shims:${PATH}

# Pre-seed the cheap, fast-to-fetch runtimes. PHP is intentionally not seeded
# — its plugin compiles from source (~5–10 min per minor) and most projects
# don't need it. First task per PHP version pays the install cost; the cache
# volume keeps it for every task after.
RUN mkdir -p /cache/mise && \
    mise install \
      node@22 node@20 \
      bun@1.2 \
      go@1.23 && \
    mise reshim

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
