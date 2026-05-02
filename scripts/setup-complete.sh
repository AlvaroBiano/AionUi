#!/bin/bash
# ============================================================
# BianinhoAgent — Setup Completo no Mac
# After bundle extraction, run this to configure everything
# ============================================================

set -e

BINHO_BASE="${BINHO_BASE:-$HOME/Library/ApplicationSupport/AionUI}"
CONFIG_DIR="$HOME/.hermes/config"
VERDE='\033[0;32m'; AMARELO='\033[1;33m'; AZUL='\033[0;34m'; VERMELHO='\033[0;31m'; RESET='\033[0m'

info()    { echo -e "${AZUL}[INFO]${RESET}  $*"; }
success() { echo -e "${VERDE}[OK]${RESET}   $*"; }
warn()    { echo -e "${AMARELO}[WARN]${RESET} $*"; }
error()   { echo -e "${VERMELHO}[ERROR]${RESET} $*"; exit 1; }

header() {
    echo ""
    echo "=============================================="
    echo "  BianinhoAgent — Setup Completo"
    echo "=============================================="
}

check_bundle() {
    info "A verificar bundle..."
    local required=(
        "$BINHO_BASE/hermes"
        "$BINHO_BASE/venv"
        "$BINHO_BASE/knowledge_db"
        "$BINHO_BASE/skills"
    )
    for item in "${required[@]}"; do
        if [ ! -d "$item" ]; then
            error "Falta: $item"
            echo ""
            echo "  Extraíste o bundle para $BINHO_BASE?"
            echo "  tar -xzf ~/Downloads/bianinho-lean.tar.gz \\"
            echo "    -C $BINHO_BASE/parent/"
            return 1
        fi
    done
    success "Bundle completo OK"
}

setup_config() {
    info "A configurar..."
    mkdir -p "$CONFIG_DIR"

    # API Key
    if [ ! -f "$CONFIG_DIR/.env" ]; then
        echo ""
        echo -e "${AMARELO}Preciso da tua MiniMax API Key:${RESET}"
        echo "Obtém em: https://platform.minimaxi.com"
        read -p "API Key: " api_key
        if [ -n "$api_key" ]; then
            echo "MINIMAX_API_KEY=$api_key" > "$CONFIG_DIR/.env"
            chmod 600 "$CONFIG_DIR/.env"
            success "API key guardada"
        else
            warn "API key não configurada"
        fi
    fi

    # Hermes config
    if [ ! -f "$CONFIG_DIR/hermes.config.yaml" ]; then
        cat > "$CONFIG_DIR/hermes.config.yaml" << 'EOF'
# Hermes Agent Config
model:
  provider: minimax
  model: mini-max-01-mini
  api_key: ${MINIMAX_API_KEY}

knowledge_base:
  path: ~/Library/ApplicationSupport/AionUI/knowledge_db

skills:
  path: ~/Library/ApplicationSupport/AionUI/skills

server:
  host: 127.0.0.1
  port: 18743
EOF
        success "Config Hermes criada"
    fi

    # Bridge secret
    if [ ! -f "$CONFIG_DIR/bridge_secret.key" ]; then
        python3 -c "import secrets; print(secrets.hex(32))" > "$CONFIG_DIR/bridge_secret.key"
        chmod 600 "$CONFIG_DIR/bridge_secret.key"
        success "Bridge secret criado"
    fi
}

start_hermes() {
    info "A iniciar Hermes Agent..."
    mkdir -p "$BINHO_BASE/logs"

    # Start bridge
    nohup python3 "$BINHO_BASE/bianinho_bridge.py" \
        > "$BINHO_BASE/logs/bridge.log" 2>&1 &
    BRIDGE_PID=$!
    echo $BRIDGE_PID > "$BINHO_BASE/bridge.pid"
    success "Bridge iniciado (PID $BRIDGE_PID)"

    sleep 1

    # Start Hermes
    nohup bash "$BINHO_BASE/bin/hermes" \
        --config "$CONFIG_DIR/hermes.config.yaml" \
        > "$BINHO_BASE/logs/hermes.log" 2>&1 &
    HERMES_PID=$!
    echo $HERMES_PID > "$BINHO_BASE/hermes.pid"
    success "Hermes iniciado (PID $HERMES_PID)"
}

verify() {
    info "A verificar..."
    sleep 2

    if curl -sf --unix-socket /tmp/bridge.sock http://localhost/ping 2>/dev/null | grep -q ok; then
        success "Bridge a funcionar"
    else
        warn "Bridge não respondeu — verifica os logs"
        echo "  Logs: tail -f $BINHO_BASE/logs/bridge.log"
    fi

    local kb_files=$(ls "$BINHO_BASE/knowledge_db/" 2>/dev/null | wc -l | tr -d ' ')
    local skills_count=$(ls "$BINHO_BASE/skills/" 2>/dev/null | wc -l | tr -d ' ')
    echo ""
    info "Resumo:"
    echo "  KB: $kb_files ficheiros"
    echo "  Skills: $skills_count skills"
    echo "  Hermes PID: $(cat $BINHO_BASE/hermes.pid 2>/dev/null || echo 'N/A')"
    echo "  Bridge PID: $(cat $BINHO_BASE/bridge.pid 2>/dev/null || echo 'N/A')"
}

final_msg() {
    echo ""
    echo "=============================================="
    success "Setup completo!"
    echo ""
    echo "  BianinhoAgent a funcionar localmente."
    echo "  Sem servidor — 100% offline."
    echo ""
    echo "  Para usar:"
    echo "  1. Abre o AionUI: cd $BINHO_BASE/../ && open AionUI.app"
    echo "  2. Ou inicia só o BianinhoBridge standalone"
    echo ""
    echo "  Logs:"
    echo "  $BINHO_BASE/logs/bridge.log"
    echo "  $BINHO_BASE/logs/hermes.log"
    echo "=============================================="
}

main() {
    header
    if ! check_bundle; then
        echo ""
        echo "O bundle não está completo."
        echo ""
        echo "1. Descarrega o bundle do servidor:"
        echo "   curl -o ~/Downloads/bianinho-lean.tar.gz \\"
        echo "     http://IP_SERVIDOR:8878/download"
        echo ""
        echo "2. Extrai:"
        echo "   tar -xzf ~/Downloads/bianinho-lean.tar.gz \\"
        echo "     -C ~/Library/ApplicationSupport/"
        echo ""
        echo "3. Corre este script outra vez:"
        echo "   bash ~/AionUI-Bianinho/scripts/setup-complete.sh"
        return 1
    fi
    setup_config
    start_hermes
    verify
    final_msg
}

main "$@"
