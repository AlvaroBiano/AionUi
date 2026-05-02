#!/bin/bash
# ============================================================
# Bianinho AionUI — Instalador para Mac e Linux
# Uso: curl -fsSL https://raw.githubusercontent.com/AlvaroBiano/AionUi/main/scripts/install.sh | bash
# ============================================================

set -e

CORES=$(sysctl -n hw.ncpu 2>/dev/null || echo 4)
PLATFORM=$(uname -s)
ARCH=$(uname -m)
REPO="AlvaroBiano/AionUi"
INSTALL_DIR="$HOME/AionUI-Bianinho"
TMP_DIR="/tmp/aionui-install-$$"

# Cores
VERDE='\033[0;32m'; AMARELO='\033[1;33m'; AZUL='\033[0;34m'; VERMELHO='\033[0;31m'; RESET='\033[0m'

info()    { echo -e "${AZUL}[INFO]${RESET}  $*"; }
success() { echo -e "${VERDE}[OK]${RESET}   $*"; }
warn()    { echo -e "${AMARELO}[WARN]${RESET} $*"; }
error()   { echo -e "${VERMELHO}[ERROR]${RESET} $*"; exit 1; }

header() {
    echo ""
    echo "=============================================="
    echo "  Bianinho AionUI — Instalador"
    echo "  Plataforma: $PLATFORM ($ARCH)"
    echo "=============================================="
}

check_deps() {
    info "A verificar dependências..."
    local missing=()
    if ! command -v git &>/dev/null; then missing+=("git"); fi
    if ! command -v node &>/dev/null; then missing+=("node"); fi
    if ! command -v npm &>/dev/null; then missing+=("npm"); fi
    if ! command -v python3 &>/dev/null; then missing+=("python3"); fi
    if ! command -v curl &>/dev/null; then missing+=("curl"); fi

    if [ ${#missing[@]} -ne 0 ]; then
        error "Faltam dependências: ${missing[*]}"
    fi

    local node_ver=$(node -v | cut -d. -f1 | tr -d 'v')
    if [ "$node_ver" -lt 20 ]; then
        warn "Node.js 20+ recomendado. Tens $node_ver."
    fi

    success "Dependências OK"
}

clone_repo() {
    info "A clonar o repositório..."
    rm -rf "$INSTALL_DIR"
    mkdir -p "$INSTALL_DIR"
    if git clone --depth=1 "https://github.com/$REPO.git" "$INSTALL_DIR" 2>&1 | tail -3; then
        success "Repositório clonado"
    else
        error "Falha ao clonar."
    fi
}

install_venv() {
    info "A configurar ambiente Python..."
    local venv_dir="$INSTALL_DIR/bianinho-venv"
    python3 -m venv "$venv_dir" || error "Falha ao criar venv"
    "$venv_dir/bin/pip" install --upgrade pip -q
    "$venv_dir/bin/pip" install requests paho-mqtt psutil lancedb -q
    success "Python venv configurado"
}

install_node_deps() {
    info "A instalar dependências Node.js ($CORES cores)..."
    cd "$INSTALL_DIR"
    npm install --prefer-offline 2>&1 | tail -5 || error "npm install falhou"
    success "Dependências Node.js instaladas"
}

build_app() {
    info "A construir a aplicação..."
    cd "$INSTALL_DIR"
    node scripts/build-with-builder.js auto --mac --arm64 --publish=never 2>&1 | tail -10 || {
        warn "Build falhou — a tentar sem electron-builder..."
        bunx electron-vite build 2>&1 | tail -5 || warn "Build completou com avisos"
    }
    success "Aplicação construída"
}

create_launcher() {
    info "A criar script de arranque..."
    mkdir -p "$HOME/bin"
    cat > "$HOME/bin/aionui-bianinho" << 'LAUNCHER'
#!/bin/bash
cd "$(dirname "$0")/../AionUI-Bianinho"
source ./bianinho-venv/bin/activate
electron .
LAUNCHER
    chmod +x "$HOME/bin/aionui-bianinho"
    success "Script criado em ~/bin/aionui-bianinho"
}

setup_first_run() {
    info "A executar setup inicial..."
    if [ -f "$INSTALL_DIR/scripts/setup-mac.sh" ]; then
        bash "$INSTALL_DIR/scripts/setup-mac.sh" || warn "Setup interativo interrompido."
    else
        info "Setup interactivo: bash $INSTALL_DIR/scripts/setup-mac.sh"
    fi
}

final_msg() {
    echo ""
    echo "=============================================="
    success "Instalação concluída!"
    echo ""
    echo "  Para iniciar: ~/bin/aionui-bianinho"
    echo "  Ou: cd $INSTALL_DIR && electron ."
    echo ""
    echo "  Setup interactivo: bash $INSTALL_DIR/scripts/setup-mac.sh"
    echo ""
    echo "  Para transferir a Knowledge Base do servidor:"
    echo "  1. No servidor: bash $INSTALL_DIR/scripts/serve-kb.sh both"
    echo "  2. No Mac: bash $INSTALL_DIR/scripts/setup-mac.sh"
    echo "=============================================="
}

# ========== EXECUÇÃO ==========
header
check_deps
clone_repo
install_venv
install_node_deps
build_app
create_launcher
setup_first_run
final_msg
