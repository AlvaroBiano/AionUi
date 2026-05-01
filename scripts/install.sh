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
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

info()    { echo -e "${BLUE}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}   $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

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
    success "Repositorio clonado"
  else
    error "Falha ao clonar. Verifica a ligaçao à internet."
  fi
}

install_venv() {
  info "A configurar ambiente Python..."
  local venv_dir="$INSTALL_DIR/bianinho-venv"

  python3 -m venv "$venv_dir" || error "Falha ao criar venv"

  if [ "$PLATFORM" = "Darwin" ]; then
    "$venv_dir/bin/pip" install --upgrade pip --quiet 2>/dev/null
    "$venv_dir/bin/pip" install requests paho-mqtt psutil --quiet 2>/dev/null
  else
    "$venv_dir/bin/pip" install --upgrade pip --quiet
    "$venv_dir/bin/pip" install requests paho-mqtt psutil --quiet
  fi

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

  npm run build 2>&1 | tail -10 || {
    warn "Build inicial falhou — a tentar correções..."
    npm run build 2>&1 | tail -10 || error "Build falhou"
  }

  success "Aplicação construída"
}

create_launcher() {
  info "A criar script de arranque..."
  local script="$HOME/bin/aionui-bianinho"
  mkdir -p "$HOME/bin"

  cat > "$script" << 'LAUNCHER'
#!/bin/bash
cd "$(dirname "$0")/../AionUI-Bianinho"
source ./bianinho-venv/bin/activate
electron .
LAUNCHER

  chmod +x "$script"
  success "Script de arranque criado em ~/bin/aionui-bianinho"
}

final_msg() {
  echo ""
  echo "=============================================="
  success "Instalação concluída!"
  echo ""
  echo "  Para iniciar: ~/bin/aionui-bianinho"
  echo "  Ou: cd $INSTALL_DIR && electron ."
  echo ""
  echo "  Primeira execução: vai abrir o ecrã de login"
  echo "  (username: admin, senha: admin)"
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
final_msg
