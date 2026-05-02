#!/bin/bash
# ============================================================
# BianinhoBridge — First Run Setup (Mac/Linux)
# Corre no Mac após instalação do DMG
# ============================================================

set -e

BINHO_BASE="${BINHO_BASE:-$HOME/Library/ApplicationSupport/AionUI}"
VENV_DIR="$BINHO_BASE/bianinho-venv"
CONFIG_DIR="$HOME/.hermes/config"
SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

VERDE='\033[0;32m'; AMARELO='\033[1;33m'; AZUL='\033[0;34m'; VERMELHO='\033[0;31m'; RESET='\033[0m'

info()    { echo -e "${AZUL}[INFO]${RESET}  $*"; }
success() { echo -e "${VERDE}[OK]${RESET}   $*"; }
warn()    { echo -e "${AMARELO}[WARN]${RESET} $*"; }
error()   { echo -e "${VERMELHO}[ERROR]${RESET} $*"; exit 1; }

header() {
    echo ""
    echo "=============================================="
    echo "  BianinhoBridge — Primeiro Setup"
    echo "=============================================="
    echo ""
}

# ── Verificar requisitos ─────────────────────────────────
check_requirements() {
    info "A verificar requisitos..."
    local missing=()
    if ! command -v python3 &>/dev/null; then
        missing+=("python3")
    fi
    if ! command -v git &>/dev/null; then
        missing+=("git")
    fi
    if ! command -v curl &>/dev/null; then
        missing+=("curl")
    fi
    if [ ${#missing[@]} -ne 0 ]; then
        error "Faltam: ${missing[*]}. Instala pelo Homebrew."
    fi
    success "Requisitos OK"
}

# ── Criar directorias ────────────────────────────────────
create_dirs() {
    info "A criar directorias..."
    mkdir -p "$BINHO_BASE"
    mkdir -p "$CONFIG_DIR"
    mkdir -p "$BINHO_BASE/logs"
    success "Directorias criadas"
}

# ── Criar venv ───────────────────────────────────────────
setup_venv() {
    info "A criar ambiente Python..."
    python3 -m venv "$VENV_DIR" || error "Falha ao criar venv"
    "$VENV_DIR/bin/pip" install --upgrade pip -q
    "$VENV_DIR/bin/pip" install requests paho-mqtt psutil lancedb -q
    "$VENV_DIR/bin/pip" install fastapi uvicorn -q
    success "Python venv configurado"
}

# ── Setup knowledge base ───────────────────────────────────
setup_kb() {
    local kb_dir="$BINHO_BASE/knowledge_db"
    
    if [ -d "$kb_dir" ] && [ "$(ls -A "$kb_dir")" ]; then
        info "Knowledge base já existe — a saltar."
        return
    fi
    
    echo ""
    echo "----------------------------------------------"
    echo "  Knowledge Base"
    echo "----------------------------------------------"
    echo ""
    echo "A knowledge base contém todo o contexto do"
    echo "Bianinho (Método TEN, livros, SAC, etc.)"
    echo ""
    echo "Tamanho: ~600MB (descomprimido ~1.1GB)"
    echo ""
    echo "Escolhe como obter a KB:"
    echo ""
    echo "  1) Descarregar do servidor Linux"
    echo "     (precisas de ter o servidor a correr)"
    echo ""
    echo "  2) Importar de ficheiro .tar.gz"
    echo "     (se já tens o ficheiro no Mac)"
    echo ""
    echo "  3) Saltar por agora"
    echo "     (podes configurar depois)"
    echo ""
    read -p "Opção [1]: " opt
    opt="${opt:-1}"
    
    case "$opt" in
        1)
            setup_kb_from_server
            ;;
        2)
            setup_kb_from_file
            ;;
        *)
            warn "A saltar KB setup. Podes correr 'bianinho-setup-kb' depois."
            ;;
    esac
}

# ── Descarregar KB do servidor ────────────────────────────
setup_kb_from_server() {
    echo ""
    read -p "IP do servidor [192.168.1.100]: " server_ip
    server_ip="${server_ip:-192.168.1.100}"
    
    read -p "Porta do servidor [8877]: " server_port
    server_port="${server_port:-8877}"
    
    info "A testar ligação a $server_ip:$server_port..."
    
    if ! curl -sf --connect-timeout 5 "http://$server_ip:$server_port/" > /dev/null 2>&1; then
        error "Não consegui conectar ao servidor."
        echo ""
        echo "  No servidor, executa:"
        echo "  bash ~/repos/aionui-custom/scripts/serve-kb.sh both"
        echo ""
        echo "  Depois tenta outra vez."
        return 1
    fi
    
    info "Ligação OK. A descarregar knowledge base..."
    
    mkdir -p "$BINHO_BASE/knowledge_db"
    
    local temp_file="/tmp/bianinho-kb-mac.tar.gz"
    
    if curl -f --progress-bar \
        -o "$temp_file" \
        "http://$server_ip:$server_port/download"; then
        info "A extrair..."
        tar -xzf "$temp_file" -C "$BINHO_BASE/knowledge_db/"
        rm -f "$temp_file"
        success "Knowledge base instalada!"
    else
        error "Falha ao descarregar KB."
        return 1
    fi
}

# ── Importar KB de ficheiro ───────────────────────────────
setup_kb_from_file() {
    echo ""
    read -p "Caminho do ficheiro .tar.gz: " kb_file
    
    if [ ! -f "$kb_file" ]; then
        error "Ficheiro não encontrado: $kb_file"
        return 1
    fi
    
    local size=$(du -sh "$kb_file" | cut -f1)
    info "Tamanho: $size"
    
    mkdir -p "$BINHO_BASE/knowledge_db"
    
    info "A extrair..."
    tar -xzf "$kb_file" -C "$BINHO_BASE/knowledge_db/"
    success "Knowledge base extraída!"
}

# ── Configurar API key ───────────────────────────────────
setup_api_key() {
    echo ""
    echo "----------------------------------------------"
    echo "  API Key MiniMax"
    echo "----------------------------------------------"
    echo ""
    echo "Precisas de uma API key da MiniMax para o"
    echo "Bianinho funcionar. Obtém em:"
    echo "  https://platform.minimaxi.com"
    echo ""
    
    if [ -f "$CONFIG_DIR/.env" ] && grep -q "MINIMAX_API_KEY" "$CONFIG_DIR/.env" 2>/dev/null; then
        info "API key já configurada."
        return
    fi
    
    read -p "MiniMax API Key: " api_key
    
    if [ -n "$api_key" ]; then
        mkdir -p "$CONFIG_DIR"
        echo "MINIMAX_API_KEY=$api_key" > "$CONFIG_DIR/.env"
        chmod 600 "$CONFIG_DIR/.env"
        success "API key guardada."
    else
        warn "API key não configurada. Podes adicionar depois em:"
        echo "  $CONFIG_DIR/.env"
    fi
}

# ── Configurar servidor ──────────────────────────────────
setup_server() {
    echo ""
    echo "----------------------------------------------"
    echo "  Ligação ao Servidor (opcional)"
    echo "----------------------------------------------"
    echo ""
    echo "Se tens um servidor Linux com o Hermes a correr,"
    echo "indica o IP para o Bianinho se conectar."
    echo ""
    echo "Se deixares em branco, o Bianinho funciona"
    echo "localmente com a knowledge base do Mac."
    echo ""
    
    read -p "IP do servidor Hermes [deixa em branco=só local]: " server_ip
    
    if [ -n "$server_ip" ]; then
        echo "HERMES_SERVER=$server_ip" >> "$CONFIG_DIR/bridge.conf"
        echo "HERMES_PORT=18743" >> "$CONFIG_DIR/bridge.conf"
        success "Servidor configurado: $server_ip"
    else
        info "Modo local activado."
    fi
}

# ── Criar launcher ───────────────────────────────────────
create_launcher() {
    info "A criar launcher..."
    mkdir -p "$HOME/bin"
    
    cat > "$HOME/bin/bianinho" << 'LAUNCHER'
#!/bin/bash
cd "$(dirname "$0")/../Library/ApplicationSupport/AionUI"
source ./bianinho-venv/bin/activate
python3 -m uvicorn bianinho_server:app --host 127.0.0.1 --port 18743 &
sleep 2
open "http://localhost:18743"
LAUNCHER
    
    chmod +x "$HOME/bin/bianinho"
    success "Launcher criado: ~/bin/bianinho"
}

# ── Final ────────────────────────────────────────────────
final_msg() {
    echo ""
    echo "=============================================="
    success "Setup concluído!"
    echo "=============================================="
    echo ""
    echo "  Para iniciar: ~/bin/bianinho"
    echo "  Ou: cd $BINHO_BASE && open AionUI.app"
    echo ""
    echo "  KB: $([ -d "$BINHO_BASE/knowledge_db" ] && ls "$BINHO_BASE/knowledge_db" | wc -l | tr -d ' ') ficheiros"
    echo ""
}

# ── Main ────────────────────────────────────────────────
main() {
    header
    check_requirements
    create_dirs
    setup_venv
    setup_kb
    setup_api_key
    setup_server
    create_launcher
    final_msg
}

main "$@"
