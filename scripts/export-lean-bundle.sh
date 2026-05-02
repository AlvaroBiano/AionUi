#!/bin/bash
# ============================================================
# BianinhoAgent — Lean Bundle para Mac
# Cria bundle pequeno (~600MB) com Hermes lean + KB
# ============================================================

set -e

# Paths no servidor
HERMES_SOURCE="$HOME/repos/aionui-hermes-ten"
KB_SOURCE="$HOME/KnowledgeBase/knowledge_db"
ARCHIVE_DIR="/tmp/bianinho-lean-bundle"
ARCHIVE_FILE="/tmp/bianinho-lean-mac.tar.gz"
PORT=8878

# Cutsize do venv (módulos realmente necessários)
# requests, paho-mqtt, psutil, lancedb, uvicorn, fastapi, pydantic
LEAN_VENV_SIZE="~200MB"  # estimado

VERDE='\033[0;32m'; AMARELO='\033[1;33m'; AZUL='\033[0;34m'; VERMELHO='\033[0;31m'; RESET='\033[0m'

info()    { echo -e "${AZUL}[INFO]${RESET}  $*"; }
success() { echo -e "${VERDE}[OK]${RESET}   $*"; }
warn()    { echo -e "${AMARELO}[WARN]${RESET} $*"; }
error()   { echo -e "${VERMELHO}[ERROR]${RESET} $*"; exit 1; }

header() {
    echo ""
    echo "=============================================="
    echo "  BianinhoAgent — Lean Bundle para Mac"
    echo "=============================================="
}

check_prereqs() {
    info "A verificar pré-requisitos..."
    if [ ! -d "$HERMES_SOURCE" ]; then error "Hermes não encontrado: $HERMES_SOURCE"; fi
    if [ ! -d "$KB_SOURCE" ]; then error "KB não encontrada: $KB_SOURCE"; fi
    success "Pré-requisitos OK"
}

create_lean_venv() {
    info "A criar venv lean..."
    local lean_venv="$ARCHIVE_DIR/venv"

    python3 -m venv "$lean_venv" || error "Falha ao criar venv"
    "$lean_venv/bin/pip" install --upgrade pip -q
    "$lean_venv/bin/pip" install \
        requests \
        paho-mqtt \
        psutil \
        lancedb \
        fastapi \
        uvicorn \
        pydantic \
        -q

    local size=$(du -sh "$lean_venv" | cut -f1)
    info "venv lean criado: $size"
}

create_bundle() {
    info "A criar lean bundle..."
    rm -rf "$ARCHIVE_DIR" "$ARCHIVE_FILE"
    mkdir -p "$ARCHIVE_DIR"

    # Hermes source (tiny — 1.1MB)
    info "A copiar Hermes source (1.1MB)..."
    mkdir -p "$ARCHIVE_DIR/hermes"
    rsync -a --exclude='node_modules' --exclude='.git' \
        --exclude='__pycache__' --exclude='*.pyc' \
        "$HERMES_SOURCE/" "$ARCHIVE_DIR/hermes/"

    # Lean venv (~200MB vs 1.8GB full)
    info "A criar venv lean (~$LEAN_VENV_SIZE)..."
    create_lean_venv

    # Knowledge base (1.1GB → ~500MB comprimido)
    info "A copiar Knowledge Base (1.1GB)..."
    mkdir -p "$ARCHIVE_DIR/knowledge_db"
    rsync -a "$KB_SOURCE/" "$ARCHIVE_DIR/knowledge_db/"

    # Skills (16MB)
    if [ -d "$HOME/.hermes/skills" ]; then
        info "A copiar Skills (16MB)..."
        mkdir -p "$ARCHIVE_DIR/skills"
        rsync -a "$HOME/.hermes/skills/" "$ARCHIVE_DIR/skills/"
    fi

    # Config template (sem API keys)
    mkdir -p "$ARCHIVE_DIR/config"
    cat > "$ARCHIVE_DIR/config/bridge.conf.example" << 'EOF'
# BianinhoAgent Config
# Copia para ~/.hermes/config/ e preenche

MINIMAX_API_KEY=your_api_key_here
HERMES_PORT=18743
LOG_LEVEL=info
EOF

    # Copy hermes agent entry point
    mkdir -p "$ARCHIVE_DIR/bin"
    cat > "$ARCHIVE_DIR/bin/hermes" << 'HERMES_SCRIPT'
#!/bin/bash
cd "$(dirname "$0")/.."
source ./venv/bin/activate
export PYTHONPATH="$PWD/hermes/src:$PYTHONPATH"
python3 -m hermes_agent.cli "$@"
HERMES_SCRIPT
    chmod +x "$ARCHIVE_DIR/bin/hermes"

    # BianinhoBridge (from the fork)
    if [ -f "$HOME/repos/aionui-custom/scripts/bianinho_bridge.py" ]; then
        cp "$HOME/repos/aionui-custom/scripts/bianinho_bridge.py" "$ARCHIVE_DIR/"
    fi

    local size_uncompressed=$(du -sh "$ARCHIVE_DIR" | cut -f1)
    info "Tamanho descomprimido: $size_uncompressed"

    # Comprimir
    info "A comprimir (~5min para KB)..."
    tar -czf "$ARCHIVE_FILE" -C "$ARCHIVE_DIR" . 2>&1

    local size_compressed=$(du -sh "$ARCHIVE_FILE" | cut -f1)
    local md5=$(md5sum "$ARCHIVE_FILE" | cut -d' ' -f1)

    rm -rf "$ARCHIVE_DIR"

    success "Bundle criado: $ARCHIVE_FILE"
    echo ""
    echo "  Componentes:"
    echo "  • Hermes source: 1.1MB"
    echo "  • venv lean: $LEAN_VENV_SIZE"
    echo "  • Knowledge Base: 1.1GB (→ ~500MB TarGHZip)"
    echo "  • Skills: 16MB"
    echo ""
    echo "  Tamanho final: $size_compressed"
    echo "  MD5: $md5"
    echo ""
}

serve_http() {
    if [ ! -f "$ARCHIVE_FILE" ]; then
        warn "Bundle não existe. A criar..."
        create_bundle
    fi

    local ip_local=$(hostname -I | awk '{print $1}')

    echo ""
    info "A servir HTTP na porta $PORT..."
    info "IP do servidor: $ip_local"
    echo ""
    echo "  No MacBook, executa:"
    echo "  curl -o ~/Downloads/bianinho-lean.tar.gz \\"
    echo "    http://$ip_local:$PORT/download"
    echo ""
    echo "  Ou abre no browser:"
    echo "  http://$ip_local:$PORT"
    echo ""
    echo "  Depois no Mac:"
    echo "  tar -xzf ~/Downloads/bianinho-lean.tar.gz \\"
    echo "    -C ~/Library/ApplicationSupport/AionUI/"
    echo ""
    echo "  Pressiona Ctrl+C para parar."
    echo ""

    cd /tmp
    python3 -m http.server $PORT --bind 0.0.0.0
}

show_help() {
    header
    echo "Uso: $0 <comando>"
    echo ""
    echo "  bundle    Cria o archive lean"
    echo "  serve     Inicia servidor HTTP"
    echo "  both      Cria bundle E serve (default)"
    echo ""
}

case "${1:-both}" in
    bundle) create_bundle ;;
    serve)  serve_http ;;
    both)
        check_prereqs
        create_bundle
        echo ""
        read -p "Iniciar servidor HTTP? [Y/n] " resp
        if [ "$resp" != "n" ] && [ "$resp" != "N" ]; then
            serve_http
        fi
        ;;
    *) show_help ;;
esac
