#!/usr/bin/env bash
# Kalos interactive setup script.
# Run this on a fresh Ubuntu 24.04 droplet after cloning the repo.
# Usage: bash deploy/setup.sh

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${CYAN}==>${NC} $*"; }
ok()    { echo -e "${GREEN}✓${NC} $*"; }
warn()  { echo -e "${YELLOW}!${NC} $*"; }
die()   { echo -e "${RED}✗ $*${NC}"; exit 1; }
prompt() { local __var=$1 __msg=$2 __default=${3:-};
  echo -en "${CYAN}?${NC} ${__msg}"; [[ -n $__default ]] && echo -en " [${__default}]";
  echo -en ": "; read -r "${__var}";
  [[ -z "${!__var}" && -n $__default ]] && printf -v "$__var" '%s' "$__default"; }
prompt_secret() { local __var=$1 __msg=$2;
  echo -en "${CYAN}?${NC} ${__msg} (hidden): "; read -rs "${__var}"; echo; }

cd "$(dirname "$0")/.."
REPO_ROOT="$(pwd)"

echo ""
echo -e "${CYAN}╔═══════════════════════════════╗"
echo -e "║        Kalos Setup            ║"
echo -e "╚═══════════════════════════════╝${NC}"
echo ""

# ── Docker ──────────────────────────────────────────────────────────────────
if ! command -v docker &>/dev/null; then
  info "Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  usermod -aG docker "$USER"
  ok "Docker installed"
else
  ok "Docker already installed ($(docker --version))"
fi

# ── Swap ────────────────────────────────────────────────────────────────────
if [[ ! -f /swapfile ]]; then
  info "Creating 2 GB swapfile..."
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  ok "Swap created"
else
  ok "Swap already configured"
fi

# ── PEM file ────────────────────────────────────────────────────────────────
echo ""
info "GitHub App private key"
echo "  Upload your .pem file to this server now if you haven't already:"
echo "  scp ~/Downloads/your-app.pem root@\$(hostname -I | awk '{print \$1}'):${REPO_ROOT}/kalos.pem"
echo ""
read -rp "Press Enter once kalos.pem is in place, or Ctrl-C to abort..."
[[ -f "${REPO_ROOT}/kalos.pem" ]] || die "kalos.pem not found at ${REPO_ROOT}/kalos.pem"
chmod 600 "${REPO_ROOT}/kalos.pem"
ok "kalos.pem found"

# ── Environment ─────────────────────────────────────────────────────────────
echo ""
info "Configure environment"

prompt LLM_PROVIDER  "LLM provider (anthropic / openrouter / ollama)" "anthropic"
prompt LLM_MODEL     "LLM model" "claude-sonnet-4-5"
prompt_secret LLM_API_KEY "LLM API key"

echo ""
prompt GITHUB_APP_ID           "GitHub App ID"
prompt GITHUB_INSTALLATION_ID  "GitHub Installation ID"
prompt_secret GITHUB_WEBHOOK_SECRET "GitHub Webhook secret"

echo ""
prompt MAX_CONCURRENT_TASKS "Max concurrent agent tasks" "2"
prompt_secret KALOS_API_KEY "Kalos API key (leave blank to disable auth)"

cat > "${REPO_ROOT}/.env" <<EOF
PORT=3000

LLM_PROVIDER=${LLM_PROVIDER}
LLM_MODEL=${LLM_MODEL}
LLM_API_KEY=${LLM_API_KEY}

GITHUB_APP_ID=${GITHUB_APP_ID}
GITHUB_APP_PRIVATE_KEY_PATH=/app/kalos.pem
GITHUB_INSTALLATION_ID=${GITHUB_INSTALLATION_ID}
GITHUB_WEBHOOK_SECRET=${GITHUB_WEBHOOK_SECRET}

WORKER_POLL_INTERVAL_MS=2000
MAX_CONCURRENT_TASKS=${MAX_CONCURRENT_TASKS}
TASK_TIMEOUT_MS=600000
CI_FIX_MAX_ATTEMPTS=3

DOCKER_SOCKET=/var/run/docker.sock
AGENT_IMAGE=ghcr.io/georgebuilds/kalos-agent:latest
DATABASE_URL=/app/packages/orchestrator/data/kalos.db
${KALOS_API_KEY:+KALOS_API_KEY=${KALOS_API_KEY}}
EOF

chmod 600 "${REPO_ROOT}/.env"
ok ".env written"

# ── Pull images & start ──────────────────────────────────────────────────────
echo ""
info "Pulling published images..."
docker pull ghcr.io/georgebuilds/kalos-orchestrator:latest
docker pull ghcr.io/georgebuilds/kalos-agent:latest
ok "Images pulled"

info "Starting Kalos..."
docker compose -f "${REPO_ROOT}/deploy/docker-compose.yml" up -d
ok "Kalos is running"

echo ""
echo -e "${GREEN}All done!${NC}"
echo ""
echo "  Health:  curl http://localhost:3000/health"
[[ -n "${KALOS_API_KEY:-}" ]] && \
echo "  Tasks:   curl -H \"Authorization: Bearer ${KALOS_API_KEY}\" http://localhost:3000/tasks"
echo "  Logs:    docker compose -f deploy/docker-compose.yml logs -f"
echo ""
