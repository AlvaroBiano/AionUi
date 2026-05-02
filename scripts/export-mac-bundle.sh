#!/bin/bash
# ============================================================
# BianinhoAgent — Lean Server para Mac (FIRST-RUN DOWNLOAD)
# Este script corre no SERVIDOR para exportar Hermes + KB para o Mac
# ============================================================

set -e

# Paths no servidor
HERMES_SOURCE="$HOME/repos/aionui-hermes-ten"
KB_SOURCE="$HOME/KnowledgeBase/knowledge_db"
VENV_SOURCE="$HOME/.hermes/hermes-agent/venv"
ARCHIVE_DIR="/tmp/bianinho-mac-bundle"
ARCHIVE_FILE="/tmp/bianinho-mac-full.tar.gz"
PORT=8878

VERDE='\033[0;32m'; AMARELO='\033[1;33m'; AZUL='\033[0;34m'; VERMELHO='\033[0;31m'; RESET='\033[0m'

info()    { echo -e "${AZUL}[INFO]${RESET}  $*"; }
success() { echo -e "${VERDE}[OK]${RESET}   $*"; }
warn()    { echo -e "${AMARELO}[WARN]${RESET} $*"; }
error()   { echo -e "${VERMELHO}[ERROR]${RESET} $*"; exit 1; }

header() {
    echo ""
    echo "=============================================="
    echo "  BianinhoAgent — Exportar para Mac"
    echo "=============================================="
}

check_prereqs() {
    info "A verificar pré-requisitos..."
    if [ ! -d "$HERMES_SOURCE" ]; then error "Hermes não encontrado: $HERMES_SOURCE"; fi
    if [ ! -d "$KB_SOURCE" ]; then error "KB não encontrada: $KB_SOURCE"; fi
    if [ ! -d "$VENV_SOURCE" ]; then error "venv não encontrada: $VENV_SOURCE"; fi
    success "Pré-requisitos OK"
}

create_bundle() {
    info "A criar bundle para Mac..."
    rm -rf "$ARCHIVE_DIR" "$ARCHIVE_FILE"
    mkdir -p "$ARCHIVE_DIR"

    # Hermes source (sem node_modules, sem __pycache__, sem .git)
    info "A copiar Hermes Agent..."
    mkdir -p "$ARCHIVE_DIR/hermes"
    rsync -a --exclude='node_modules' --exclude='.git' --exclude='__pycache__' \
        --exclude='*.pyc' --exclude='.venv' \
        "$HERMES_SOURCE/" "$ARCHIVE_DIR/hermes/"

    # Hermes venv (Python packages apenas)
    info "A copiar Python venv (~1.8GB)..."
    mkdir -p "$ARCHIVE_DIR/venv"
    rsync -a --exclude='__pycache__' --exclude='*.pyc' \
        "$VENV_SOURCE/" "$ARCHIVE_DIR/venv/"

    # Knowledge base
    info "A copiar Knowledge Base (~1.1GB)..."
    mkdir -p "$ARCHIVE_DIR/knowledge_db"
    rsync -a "$KB_SOURCE/" "$ARCHIVE_DIR/knowledge_db/"

    # Skills
    if [ -d "$HOME/.hermes/skills" ]; then
        info "A copiar Skills..."
        mkdir -p "$ARCHIVE_DIR/skills"
        rsync -a "$HOME/.hermes/skills/" "$ARCHIVE_DIR/skills/"
    fi

    # Config (sem API keys)
    if [ -d "$HOME/.hermes/config" ]; then
        mkdir -p "$ARCHIVE_DIR/config"
        cp -n "$HOME/.hermes/config/"*.key "$ARCHIVE_DIR/config/" 2>/dev/null || true
        cp -n "$HOME/.hermes/config/"*.conf "$ARCHIVE_DIR/config/" 2>/dev/null || true
    fi

    local size=$(du -sh "$ARCHIVE_DIR" | cut -f1)
    info "Bundle criado: $size"

    # Comprimir
    info "A comprimir (~10min)..."
    tar -czf "$ARCHIVE_FILE" -C "$ARCHIVE_DIR" . 2>&1

    local size_compressed=$(du -sh "$ARCHIVE_FILE" | cut -f1)
    local md5=$(md5sum "$ARCHIVE_FILE" | cut -d' ' -f1)

    rm -rf "$ARCHIVE_DIR"

    success "Bundle criado: $ARCHIVE_FILE"
    echo "  Tamanho comprimido: $size_compressed"
    echo "  MD5: $md5"
    echo ""
    echo "  Para transferir para o Mac:"
    echo "  scp $ARCHIVE_FILE macbook@IP:/tmp/"
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
    echo "  No Mac, executa no terminal:"
    echo "  curl -o ~/Downloads/bianinho-mac-full.tar.gz \\"
    echo "    http://$ip_local:$PORT/download"
    echo ""
    echo "  Ou abre no browser:"
    echo "  http://$ip_local:$PORT"
    echo ""
    echo "  Depois extrai com:"
    echo "  tar -xzf ~/Downloads/bianinho-mac-full.tar.gz \\"
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
    echo "  bundle    Cria o archive (Hermes + venv + KB + skills)"
    echo "  serve     Inicia servidor HTTP para download no Mac"
    echo "  both      Cria bundle E serve"
    echo ""
    echo "O bundle completo inclui:"
    echo "  - Hermes Agent (código fonte)"
    echo "  - Python venv (~1.8GB, packages principais)"
    echo "  - Knowledge Base (~1.1GB, 65k chunks)"
    echo "  - Skills (70+ skills do Bianinho)"
    echo ""
    echo "Tamanho total comprimido: ~400-600MB"
}

case "${1:-both}" in
    bundle) create_bundle ;;
    serve)  serve_http ;;
    both)
        check_prereqs
        create_bundle
        echo ""
        read -p "Bundle criado. Iniciar servidor HTTP? [Y/n] " resp
        if [ "$resp" != "n" ] && [ "$resp" != "N" ]; then
            serve_http
        fi
        ;;
    *) show_help ;;
esac
