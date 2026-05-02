#!/bin/bash
# BianinhoAgent — Hermes Launcher
# Called by BianinhoBridge or manually to start Hermes Agent

set -e

APP_SUPPORT="${HOME}/Library/ApplicationSupport/AionUI"
BINHO_BASE="${BINHO_BASE:-$APP_SUPPORT}"
VENV_DIR="$BINHO_BASE/venv"
HERMES_SOURCE="$BINHO_BASE/hermes"
CONFIG_DIR="$HOME/.hermes/config"

log() {
    echo "[$(date '+%H:%M:%S')] [Hermes] $*"
}

# Activate venv
if [ -f "$VENV_DIR/bin/activate" ]; then
    source "$VENV_DIR/bin/activate"
else
    log "ERRO: venv não encontrada em $VENV_DIR"
    log "Corre: bash \"$BINHO_BASE/bianinho/setup-complete.sh\""
    exit 1
fi

# Set Python path
if [ -d "$HERMES_SOURCE/src" ]; then
    export PYTHONPATH="$HERMES_SOURCE/src:$PYTHONPATH"
fi

# Check config
if [ ! -f "$CONFIG_DIR/hermes.config.yaml" ]; then
    log "Config não encontrada. A criar..."
    mkdir -p "$CONFIG_DIR"
    cat > "$CONFIG_DIR/hermes.config.yaml" << EOF
model:
  provider: minimax
  model: mini-max-01-mini

knowledge_base:
  path: $BINHO_BASE/knowledge_db

skills:
  path: $BINHO_BASE/skills

server:
  host: 127.0.0.1
  port: 18743
EOF
fi

# Load API key from .env
if [ -f "$CONFIG_DIR/.env" ]; then
    export $(grep -v '^#' "$CONFIG_DIR/.env" | xargs)
fi

log "A iniciar Hermes Agent..."
log "venv: $VENV_DIR"
log "KB: $BINHO_BASE/knowledge_db"
log "Skills: $BINHO_BASE/skills"

# Start Hermes
cd "$HERMES_SOURCE"
exec python3 -m hermes_agent.cli serve \
    --config "$CONFIG_DIR/hermes.config.yaml" \
    --host 127.0.0.1 \
    --port 18743
