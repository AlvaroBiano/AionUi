#!/bin/bash
# ============================================================
# BianinhoAgent — Setup Completo para Mac (DMG Post-Install)
# Este script corre após instalar o DMG — configura tudo local
# ============================================================

set -e

APP_SUPPORT="${HOME}/Library/ApplicationSupport/AionUI"
BINHO_BASE="$APP_SUPPORT"
CONFIG_DIR="$HOME/.hermes/config"
VENV_DIR="$BINHO_BASE/venv"
RESOURCE_DIR="$APP_SUPPORT/bianinho"  # Extracted by app on first launch

# Cores
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

# ── Verificar bundle ───────────────────────────────────────
check_bundle() {
    info "A verificar instalação..."

    # After app extracts resources, they are in ~/Library/ApplicationSupport/AionUI/
    if [ ! -d "$RESOURCE_DIR" ]; then
        error "Directorio bianinho não encontrado em $RESOURCE_DIR"
        echo "  Abre o AionUI.app uma vez para extrair os recursos."
        echo "  Ou executa manualmente:"
        echo "  bash /Applications/AionUI.app/Contents/Resources/bianinho/setup-complete.sh"
        return 1
    fi
    if [ ! -f "$RESOURCE_DIR/bianinho_bridge.py" ]; then
        error "BianinhoBridge não encontrado."
        return 1
    fi
    success "Instalação OK"
}

# ── Criar venv com lancedb ─────────────────────────────────
setup_venv() {
    info "A criar ambiente Python (~5-10min)..."

    if [ -d "$VENV_DIR" ]; then
        info "venv já existe — a usar existente."
        return
    fi

    python3 -m venv "$VENV_DIR" || error "Falha ao criar venv"
    "$VENV_DIR/bin/pip" install --upgrade pip -q

    info "A instalar packages (lancedb, paho-mqtt, psutil)..."
    "$VENV_DIR/bin/pip" install lancedb paho-mqtt psutil requests -q

    local size=$(du -sh "$VENV_DIR" | cut -f1)
    success "venv criado: $size"
}

# ── Setup knowledge base ───────────────────────────────────
setup_kb() {
    local kb_dir="$BINHO_BASE/knowledge_db"

    if [ -d "$kb_dir" ] && [ "$(ls -A "$kb_dir" 2>/dev/null)" ]; then
        local count=$(ls "$kb_dir" | wc -l | tr -d ' ')
        info "Knowledge base já existe ($count ficheiros)."
        return
    fi

    echo ""
    echo "----------------------------------------------"
    echo "  Knowledge Base (~1.1GB)"
    echo "----------------------------------------------"
    echo ""
    echo "A KB contém todo o contexto do Bianinho."
    echo "Escolhe como obter:"
    echo ""
    echo "  1) Descarregar do servidor Linux"
    echo "     (precisa do IP do servidor a correr)"
    echo ""
    echo "  2) Importar de ficheiro .tar.gz"
    echo "     (se tens o ficheiro no Mac)"
    echo ""
    echo "  3) Saltar por agora"
    echo "     (podes configurar depois)"
    echo ""
    read -p "Opção [1]: " opt
    opt="${opt:-1}"

    case "$opt" in
        2)
            read -p "Caminho do ficheiro .tar.gz: " kb_file
            if [ -f "$kb_file" ]; then
                mkdir -p "$kb_dir"
                info "A extrair KB..."
                tar -xzf "$kb_file" -C "$kb_dir/"
                success "KB extraída!"
            else
                error "Ficheiro não encontrado: $kb_file"
            fi
            ;;
        1|*)
            setup_kb_from_server
            ;;
    esac
}

# ── Descarregar KB do servidor ────────────────────────────
setup_kb_from_server() {
    echo ""
    read -p "IP do servidor [192.168.1.100]: " server_ip
    server_ip="${server_ip:-192.168.1.100}"

    read -p "Porta do servidor [8878]: " server_port
    server_port="${server_port:-8878}"

    info "A testar ligação..."
    if ! curl -sf --connect-timeout 5 "http://$server_ip:$server_port/" > /dev/null 2>&1; then
        error "Não consegui conectar ao servidor."
        echo ""
        echo "  No servidor, executa:"
        echo "  cd ~/repos/aionui-custom"
        echo "  bash scripts/export-lean-bundle.sh both"
        echo ""
        echo "  Depois tenta outra vez."
        return 1
    fi

    info "Ligação OK. A descarregar knowledge base (~500MB, ~5min)..."

    mkdir -p "$BINHO_BASE/knowledge_db"
    local temp_file="/tmp/bianinho-kb-download.tar.gz"

    if curl -f --progress-bar \
        -o "$temp_file" \
        "http://$server_ip:$server_port/download"; then

        info "A extrair KB (1.1GB)..."
        tar -xzf "$temp_file" -C "$BINHO_BASE/knowledge_db/"
        rm -f "$temp_file"

        local count=$(ls "$BINHO_BASE/knowledge_db" | wc -l | tr -d ' ')
        success "KB instalada! ($count ficheiros)"
    else
        error "Falha ao descarregar KB."
        return 1
    fi
}

# ── Setup Hermes source ───────────────────────────────────
setup_hermes() {
    local hermes_dir="$BINHO_BASE/hermes"
    if [ -d "$hermes_dir" ] && [ "$(ls -A "$hermes_dir" 2>/dev/null)" ]; then
        info "Hermes source já existe."
        return
    fi

    info "A configurar Hermes Agent source..."

    # After app extraction: hermes source is at $BINHO_BASE/hermes (copied from hermes-source/)
    # The app already copies it via extractBianinhoResources()
    if [ -d "$hermes_dir" ]; then
        success "Hermes source encontrado."
    elif [ -d "$RESOURCE_DIR/hermes-source" ]; then
        cp -r "$RESOURCE_DIR/hermes-source" "$hermes_dir"
        success "Hermes source instalado."
    else
        warn "Hermes source não encontrado — a criar estrutura mínima."
        mkdir -p "$hermes_dir"
    fi
}

# ── Setup skills ─────────────────────────────────────────
setup_skills() {
    local skills_dir="$BINHO_BASE/skills"
    if [ -d "$skills_dir" ] && [ "$(ls -A "$skills_dir" 2>/dev/null)" ]; then
        local count=$(ls "$skills_dir" | wc -l | tr -d ' ')
        info "Skills já existem ($count)."
        return
    fi

    echo ""
    echo "----------------------------------------------"
    echo "  Skills (~16MB)"
    echo "----------------------------------------------"
    echo ""
    echo "Queres descarregar as skills do servidor?"
    echo "(70+ skills do Bianinho)"
    echo ""
    read -p "Descarregar skills? [Y/n]: " resp
    resp="${resp:-Y}"
    if [ "$resp" = "n" ] || [ "$resp" = "N" ]; then
        warn "A saltar. Podes descarregar depois."
        return
    fi

    read -p "IP do servidor [192.168.1.100]: " server_ip
    server_ip="${server_ip:-192.168.1.100}"

    info "A descarregar skills..."
    mkdir -p "$skills_dir"

    # Skills are small enough to just serve directly
    if curl -sf --connect-timeout 5 "http://$server_ip:8878/" > /dev/null 2>&1; then
        curl -f --progress-bar \
            -o "/tmp/bianinho-skills.tar.gz" \
            "http://$server_ip:8878/skills.tar.gz" 2>/dev/null || \
        warn "Skills não disponíveis no servidor — a saltar."
    fi
}

# ── Configurar API key ───────────────────────────────────
setup_api_key() {
    if [ -f "$CONFIG_DIR/.env" ] && grep -q "MINIMAX_API_KEY" "$CONFIG_DIR/.env" 2>/dev/null; then
        info "API key já configurada."
        return
    fi

    echo ""
    echo "----------------------------------------------"
    echo "  MiniMax API Key"
    echo "----------------------------------------------"
    echo ""
    echo "Precisas de uma API key da MiniMax."
    echo "Obtém gratuitamente em: https://platform.minimaxi.com"
    echo ""
    read -p "API Key: " api_key

    if [ -n "$api_key" ]; then
        mkdir -p "$CONFIG_DIR"
        echo "MINIMAX_API_KEY=$api_key" > "$CONFIG_DIR/.env"
        chmod 600 "$CONFIG_DIR/.env"
        success "API key guardada."
    else
        warn "API key não configurada. Podes adicionar depois:"
        echo "  nano $CONFIG_DIR/.env"
    fi
}

# ── Criar config Hermes ───────────────────────────────────
setup_hermes_config() {
    mkdir -p "$CONFIG_DIR"

    if [ ! -f "$CONFIG_DIR/hermes.config.yaml" ]; then
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
        success "Config Hermes criada."
    fi
}

# ── Criar bridge secret ───────────────────────────────────
setup_bridge_secret() {
    mkdir -p "$CONFIG_DIR"

    if [ ! -f "$CONFIG_DIR/bridge_secret.key" ]; then
        python3 -c "import secrets; print(secrets.hex(32))" > "$CONFIG_DIR/bridge_secret.key"
        chmod 600 "$CONFIG_DIR/bridge_secret.key"
        success "Bridge secret criado."
    fi
}

# ── Copiar BianinhoBridge e scripts ──────────────────────
install_bianinho_files() {
    info "A verificar ficheiros Bianinho..."

    # The app already extracted bianinho/ to ~/Library/ApplicationSupport/AionUI/bianinho/
    # Just ensure the bridge is accessible at the expected path
    if [ -f "$RESOURCE_DIR/bianinho_bridge.py" ]; then
        cp "$RESOURCE_DIR/bianinho_bridge.py" "$BINHO_BASE/bianinho_bridge.py"
    fi

    # Create bin directory and hermes launcher
    mkdir -p "$BINHO_BASE/bin"
    if [ -f "$RESOURCE_DIR/hermes-launcher.sh" ]; then
        cp "$RESOURCE_DIR/hermes-launcher.sh" "$BINHO_BASE/bin/hermes"
        chmod +x "$BINHO_BASE/bin/hermes"
    fi

    mkdir -p "$BINHO_BASE/logs"
    success "Ficheiros verificados."
}

# ── Iniciar serviços ─────────────────────────────────────
start_services() {
    info "A iniciar BianinhoBridge..."
    nohup python3 "$BINHO_BASE/bianinho_bridge.py" \
        > "$BINHO_BASE/logs/bridge.log" 2>&1 &
    BRIDGE_PID=$!
    echo $BRIDGE_PID > "$BINHO_BASE/bridge.pid"
    success "Bridge iniciado (PID $BRIDGE_PID)"
}

# ── Verificar ────────────────────────────────────────────
verify() {
    sleep 2
    info "A verificar..."

    if curl -sf --connect-timeout 3 --unix-socket /tmp/bridge.sock http://localhost/ping 2>/dev/null | grep -q ok; then
        success "Bridge a funcionar."
    else
        warn "Bridge não respondeu — verifica os logs."
        echo "  Logs: tail -f $BINHO_BASE/logs/bridge.log"
    fi

    echo ""
    echo "  venv: $([ -d "$VENV_DIR" ] && echo "OK ($(du -sh $VENV_DIR | cut -f1))" || echo "não criado")"
    echo "  KB: $([ -d "$BINHO_BASE/knowledge_db" ] && ls "$BINHO_BASE/knowledge_db" | wc -l | tr -d ' ' || echo "0") ficheiros"
    echo "  Skills: $([ -d "$BINHO_BASE/skills" ] && ls "$BINHO_BASE/skills" | wc -l | tr -d ' ' || echo "0") skills"
}

final_msg() {
    echo ""
    echo "=============================================="
    success "Setup concluído!"
    echo ""
    echo "  BianinhoAgent está a funcionar localmente."
    echo ""
    echo "  Para usar:"
    echo "  Abre o AionUI como qualquer app:"
    echo "  open ~/Applications/AionUI.app"
    echo ""
    echo "  Para reiniciar serviços:"
    echo "  cd $BINHO_BASE && bash bin/hermes"
    echo ""
    echo "  Documentação: $RESOURCE_DIR/SETUP-COMPLETO.md"
    echo "=============================================="
}

# ── Main ────────────────────────────────────────────────
main() {
    header
    check_bundle || exit 1
    setup_venv
    install_bianinho_files
    setup_hermes_config
    setup_bridge_secret
    setup_api_key
    setup_kb
    setup_skills
    setup_hermes
    start_services
    verify
    final_msg
}

main "$@"
