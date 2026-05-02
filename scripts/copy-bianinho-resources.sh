#!/bin/bash
# BianinhoAgent — Copy bundled resources to Application Support
# This script runs after DMG installation to extract Bianinho files
# Called by the AionUI app on first launch OR can be run manually

set -e

APP_SUPPORT="${HOME}/Library/ApplicationSupport/AionUI"
RESOURCE_DIR="${1:-/Applications/AionUI.app/Contents/Resources}"
BINHO_SOURCE="$RESOURCE_DIR/bianinho"
HERMES_SOURCE="$RESOURCE_DIR/hermes-source"

log() {
    echo "[BIANINHO] $*"
}

log "A extrair recursos do Bianinho..."

# Create Application Support directory
mkdir -p "$APP_SUPPORT"
mkdir -p "$APP_SUPPORT/bianinho"

# Copy BianinhoBridge and scripts
if [ -d "$BINHO_SOURCE" ]; then
    cp -r "$BINHO_SOURCE/"* "$APP_SUPPORT/bianinho/"
    log "Bianinho files copiados."
fi

# Copy Hermes source
if [ -d "$HERMES_SOURCE" ]; then
    mkdir -p "$APP_SUPPORT/hermes"
    cp -r "$HERMES_SOURCE/"* "$APP_SUPPORT/hermes/"
    log "Hermes source copiado."
fi

# Make hermes-launcher.sh executable
if [ -f "$APP_SUPPORT/bianinho/hermes-launcher.sh" ]; then
    chmod +x "$APP_SUPPORT/bianinho/hermes-launcher.sh"
fi

log "Recursos extraídos para $APP_SUPPORT"
log "Agora corre: bash $APP_SUPPORT/bianinho/setup-complete.sh"
