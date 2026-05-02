#!/bin/bash
# ============================================================
# BianinhoBridge — Server: Exportar KB e Servir para Mac
# Este script corre no SERVIDOR Linux
# ============================================================

set -e

KB_SOURCE="$HOME/KnowledgeBase/knowledge_db"
ARCHIVE_FILE="/tmp/bianinho-kb-mac.tar.gz"
PORT=8877

VERDE='\033[0;32m'; AMARELO='\033[1;33m'; AZUL='\033[0;34m'; RESET='\033[0m'

info()    { echo -e "${AZUL}[INFO]${RESET}  $*"; }
success() { echo -e "${VERDE}[OK]${RESET}   $*"; }
warn()    { echo -e "${AMARELO}[WARN]${RESET} $*"; }

header() {
    echo ""
    echo "=============================================="
    echo "  BianinhoBridge — Servir KB para Mac"
    echo "=============================================="
    echo ""
}

# ── Criar archive ─────────────────────────────────────────
create_archive() {
    info "A criar archive da knowledge base..."
    
    if [ ! -d "$KB_SOURCE" ]; then
        echo "ERRO: Knowledge base não encontrada em $KB_SOURCE"
        exit 1
    fi
    
    local size_orig=$(du -sh "$KB_SOURCE" | cut -f1)
    info "Tamanho original: $size_orig"
    
    rm -f "$ARCHIVE_FILE"
    
    tar -czf "$ARCHIVE_FILE" -C "$KB_SOURCE" . 2>&1
    
    local size_compressed=$(du -sh "$ARCHIVE_FILE" | cut -f1)
    local md5=$(md5sum "$ARCHIVE_FILE" | cut -d' ' -f1)
    
    success "Archive criado: $ARCHIVE_FILE"
    echo "  Tamanho comprimido: $size_compressed"
    echo "  MD5: $md5"
    echo ""
    echo "  Copia este ficheiro para o Mac via USB ou SCP:"
    echo "  scp $ARCHIVE_FILE macbook@192.168.1.X:/tmp/"
    echo ""
}

# ── Servir via HTTP ───────────────────────────────────────
serve_http() {
    if [ ! -f "$ARCHIVE_FILE" ]; then
        warn "Archive não existe. A criar agora..."
        create_archive
    fi
    
    local ip_local=$(hostname -I | awk '{print $1}')
    
    echo ""
    info "A servir HTTP na porta $PORT..."
    info "IP do servidor: $ip_local"
    echo ""
    echo "  No Mac, abre o browser e vai a:"
    echo "  → http://$ip_local:$PORT/download"
    echo ""
    echo "  Ou no terminal do Mac executa:"
    echo "  curl -o ~/Downloads/bianinho-kb.tar.gz http://$ip_local:$PORT/download"
    echo ""
    echo "  Pressiona Ctrl+C para parar o servidor."
    echo ""
    
    cd /tmp
    python3 -m http.server $PORT --bind 0.0.0.0
}

# ── Mostrar instruções ────────────────────────────────────
show_help() {
    header
    echo "Este script prepara a knowledge base para transferir para o Mac."
    echo ""
    echo "Uso: $0 <comando>"
    echo ""
    echo "Comandos:"
    echo "  archive    Cria o ficheiro .tar.gz da KB (em /tmp/)"
    echo "  serve      Inicia servidor HTTP para download no Mac"
    echo "  both       Cria archive E inicia servidor"
    echo ""
    echo "Fluxo completo:"
    echo "  1. $0 both        (no servidor)"
    echo "  2. No Mac: curl -o ~/Downloads/bianinho-kb.tar.gz \\"
    echo "              http://IP_DO_SERVIDOR:8877/download"
    echo "  3. No Mac: tar -xzf ~/Downloads/bianinho-kb.tar.gz \\"
    echo "              -C ~/Library/ApplicationSupport/AionUI/knowledge_db/"
    echo ""
}

case "${1:-both}" in
    archive)
        create_archive
        ;;
    serve)
        serve_http
        ;;
    both)
        create_archive
        echo ""
        read -p "Arquivo criado. Iniciar servidor HTTP? [Y/n] " resp
        if [ "$resp" != "n" ] && [ "$resp" != "N" ]; then
            serve_http
        fi
        ;;
    *)
        show_help
        ;;
esac
