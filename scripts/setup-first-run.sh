#!/bin/bash
# ============================================================
# BianinhoBridge — First Run Setup
# Executa uma vez após instalação para configurar ambiente
# ============================================================

set -e

# ── Paths ──────────────────────────────────────────────────
BINHO_BASE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPTS_DIR="$(dirname "${BASH_SOURCE[0]}")"
HOME_DIR="$HOME"

# ── Cores ──────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; CYAN='\033[0;36m'; NC='\033[0m'

# ── Logging ────────────────────────────────────────────────
LOG_FILE="$BINHO_BASE/logs/setup-first-run.log"
mkdir -p "$(dirname "$LOG_FILE")"

log() {
    local level="$1"; shift
    local msg="$*"
    local ts=$(date '+%Y-%m-%d %H:%M:%S')
    echo -e "[$ts] [$level] $msg" | tee -a "$LOG_FILE"
}

info()    { log "INFO" "$*"; echo -e "${BLUE}[INFO]${NC}  $*"; }
success() { log "OK" "$*"; echo -e "${GREEN}[OK]${NC}   $*"; }
warn()    { log "WARN" "$*"; echo -e "${YELLOW}[WARN]${NC} $*"; }
error()   { log "ERROR" "$*"; echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

header() {
    echo ""
    echo "=============================================="
    echo "  BianinhoBridge — First Run Setup"
    echo "=============================================="
    echo ""
}

# ── Check Requirements ─────────────────────────────────────
check_requirements() {
    info "A verificar requisitos do sistema..."

    local missing=()

    # Python 3.10+
    if ! command -v python3 &>/dev/null; then
        missing+=("python3")
    else
        local py_ver=$(python3 --version 2>&1 | cut -d' ' -f2 | cut -d'.' -f1,2)
        local py_major=$(echo "$py_ver" | cut -d'.' -f1)
        local py_minor=$(echo "$py_ver" | cut -d'.' -f2)
        if [ "$py_major" -lt 3 ] || ([ "$py_major" -eq 3 ] && [ "$py_minor" -lt 10 ]); then
            warn "Python 3.10+ recomendado. Tens $py_ver."
        fi
    fi

    # Required Python modules
    if ! python3 -c "import lancedb" 2>/dev/null; then
        missing+=("lancedb")
    fi
    if ! python3 -c "import paho.mqtt" 2>/dev/null; then
        missing+=("paho-mqtt")
    fi
    if ! python3 -c "import requests" 2>/dev/null; then
        missing+=("requests")
    fi
    if ! python3 -c "import psutil" 2>/dev/null; then
        missing+=("psutil")
    fi

    if [ ${#missing[@]} -ne 0 ]; then
        error "Faltam dependências: ${missing[*]}"
    fi

    # Git
    if ! command -v git &>/dev/null; then
        missing+=("git")
    fi

    # Node.js (optional - for Electron)
    if ! command -v node &>/dev/null; then
        warn "Node.js não encontrado — algumas funcionalidades podem não estar disponíveis."
    fi

    if [ ${#missing[@]} -ne 0 ]; then
        error "Faltam dependências críticas: ${missing[*]}"
    fi

    success "Requisitos OK"
}

# ── Create Directory Structure ─────────────────────────────
create_dirs() {
    info "A criar estrutura de directórios..."

    local dirs=(
        "$HOME/.hermes"
        "$HOME/.hermes/config"
        "$HOME/.hermes/backups"
        "$HOME/.hermes/sessions"
        "$HOME/.hermes/cron"
        "$HOME/KnowledgeBase"
        "$HOME/KnowledgeBase/knowledge_db"
        "$HOME/KnowledgeBase/archives"
        "$BINHO_BASE/logs"
        "$BINHO_BASE/data"
        "$BINHO_BASE/venv"
    )

    for dir in "${dirs[@]}"; do
        mkdir -p "$dir"
        success "Created: $dir"
    done

    success "Estrutura de directórios criada"
}

# ── Setup Python venv ───────────────────────────────────────
setup_venv() {
    info "A configurar ambiente Python virtual..."

    local venv_dir="$BINHO_BASE/venv"

    if [ -d "$venv_dir" ]; then
        warn "venv já existe em $venv_dir — a usar existente"
    else
        python3 -m venv "$venv_dir" || error "Falha ao criar venv"
        success "venv criado em $venv_dir"
    fi

    info "A instalar dependências Python..."
    "$venv_dir/bin/pip" install --upgrade pip --quiet || error "pip upgrade falhou"
    "$venv_dir/bin/pip" install lancedb paho-mqtt requests psutil --quiet || error "pip install falhou"

    success "Ambiente Python configurado"
}

# ── Setup Hermes Bridge ─────────────────────────────────────
setup_bridge() {
    info "A configurar BianinhoBridge..."

    # Generate bridge secret
    local secret_file="$HOME/.hermes/config/bridge_secret.key"
    if [ ! -f "$secret_file" ]; then
        python3 -c "
import os
from pathlib import Path
secret_file = Path('$secret_file')
secret_file.parent.mkdir(parents=True, exist_ok=True)
secret = os.urandom(32)
secret_file.write_bytes(secret)
os.chmod(secret_file, 0o600)
print('Bridge secret generated')
" || error "Falha ao gerar bridge secret"
        success "Bridge secret gerado"
    else
        success "Bridge secret já existe"
    fi

    # Test bridge import
    if "$BINHO_BASE/venv/bin/python" -c "import bianinho_bridge" 2>/dev/null; then
        success "BianinhoBridge module OK"
    else
        # Add scripts to PYTHONPATH
        cat > "$BINHO_BASE/venv/lib/python*/site-packages/bianinho_bridge.pth" << EOF
$SCRIPTS_DIR
EOF
        success "PYTHONPATH configurado"
    fi
}

# ── Setup RAG Database ─────────────────────────────────────
setup_rag() {
    info "A configurar RAG knowledge base..."

    local rag_dir="$HOME/KnowledgeBase/knowledge_db"

    # Create RAG directory if not exists
    mkdir -p "$rag_dir"

    # Initialize LanceDB if not exists
    if [ ! -f "$rag_dir/_metadata" ]; then
        "$BINHO_BASE/venv/bin/python" << EOF
import lancedb
from pathlib import Path

rag_dir = Path("$rag_dir")
db = lancedb.connect(str(rag_dir / ".lancedb"))

# Create default tables schema
try:
    db.create_table("documents", schema={
        "id": "string",
        "content": "string",
        "category": "string",
        "access_level": "string",
        "created_at": "timestamp",
        "updated_at": "timestamp",
    })
    print("RAG tables initialized")
except Exception as e:
    print(f"RAG already exists or error: {e}")

# Create metadata
import json
metadata = {"version": "1.0", "initialized": True, "timestamp": "$(date -Iseconds)"}
(rag_dir / "_metadata").write_text(json.dumps(metadata))
print("RAG metadata created")
EOF
        success "RAG database inicializada"
    else
        success "RAG database já configurada"
    fi
}

# ── Setup Cron Jobs ────────────────────────────────────────
setup_cron() {
    info "A configurar tarefas cron..."

    local cron_dir="$HOME/.hermes/cron"
    mkdir -p "$cron_dir"

    # Create default cron jobs config
    if [ ! -f "$cron_dir/jobs.json" ]; then
        cat > "$cron_dir/jobs.json" << 'EOF'
{
  "jobs": [],
  "version": "1.0",
  "created_at": null
}
EOF
        success "Cron jobs config criado"
    else
        success "Cron jobs config já existe"
    fi
}

# ── Setup Config Files ─────────────────────────────────────
setup_config() {
    info "A configurar ficheiros de configuração..."

    local config_dir="$HOME/.hermes/config"

    # Main config
    if [ ! -f "$config_dir/bridge.conf" ]; then
        cat > "$config_dir/bridge.conf" << 'EOF'
# BianinhoBridge Configuration
BRIDGE_PORT=18743
MAX_RETRIES=2
RETRY_DELAY=300
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW=60
LOG_LEVEL=INFO
EOF
        success "bridge.conf criado"
    else
        success "bridge.conf já existe"
    fi

    # Environment defaults
    if [ ! -f "$config_dir/env.defaults" ]; then
        cat > "$config_dir/env.defaults" << 'EOF'
# Default environment variables
HERMES_MODE=production
LOG_LEVEL=info
ENABLE_AUTO_BACKUP=true
BACKUP_RETENTION_DAYS=30
EOF
        success "env.defaults criado"
    else
        success "env.defaults já existe"
    fi
}

# ── Create Launcher Scripts ────────────────────────────────
create_launchers() {
    info "A criar scripts de arranque..."

    local bin_dir="$HOME/bin"
    mkdir -p "$bin_dir"

    # Main bridge launcher
    cat > "$bin_dir/bianinho-bridge" << 'LAUNCHER'
#!/bin/bash
cd "$(dirname "$0")/../repos/aionui-custom"
source ./venv/bin/activate
exec python3 scripts/bianinho_bridge.py 18743
LAUNCHER
    chmod +x "$bin_dir/bianinho-bridge"
    success "Launcher criado: ~/bin/bianinho-bridge"

    # KB export launcher
    cat > "$bin_dir/bianinho-kb-export" << 'LAUNCHER'
#!/bin/bash
cd "$(dirname "$0")/../repos/aionui-custom/scripts"
source ../venv/bin/activate
exec python3 server-export-kb.sh
LAUNCHER
    chmod +x "$bin_dir/bianinho-kb-export"
    success "Launcher criado: ~/bin/bianinho-kb-export"

    # KB archive launcher
    cat > "$bin_dir/bianinho-kb-archive" << 'LAUNCHER'
#!/bin/bash
cd "$(dirname "$0")/../repos/aionui-custom/scripts"
source ../venv/bin/activate
exec python3 create-kb-archive.sh
LAUNCHER
    chmod +x "$bin_dir/bianinho-kb-archive"
    success "Launcher criado: ~/bin/bianinho-kb-archive"
}

# ── Verify Installation ────────────────────────────────────
verify() {
    info "A verificar instalação..."

    local errors=0

    # Check venv
    if [ ! -d "$BINHO_BASE/venv" ]; then
        error "venv não encontrado"
        ((errors++))
    fi

    # Check hermes dir
    if [ ! -d "$HOME/.hermes" ]; then
        error ".hermes não encontrado"
        ((errors++))
    fi

    # Check RAG dir
    if [ ! -d "$HOME/KnowledgeBase" ]; then
        error "KnowledgeBase não encontrada"
        ((errors++))
    fi

    # Check bridge script
    if [ ! -f "$SCRIPTS_DIR/bianinho_bridge.py" ]; then
        error "bianinho_bridge.py não encontrado"
        ((errors++))
    fi

    # Test Python imports
    if ! "$BINHO_BASE/venv/bin/python" -c "import lancedb, paho.mqtt, requests, psutil" 2>/dev/null; then
        warn "Alguns módulos Python podem não estar instalados corretamente"
    fi

    if [ $errors -eq 0 ]; then
        success "Verificação completa — tudo OK"
        return 0
    else
        error "Verificação falhou com $errors erros"
        return 1
    fi
}

# ── Final Message ─────────────────────────────────────────
final_msg() {
    echo ""
    echo "=============================================="
    success "First Run Setup concluído!"
    echo ""
    echo "  Próximos passos:"
    echo "  1. Iniciar bridge: ~/bin/bianinho-bridge"
    echo "  2. Exportar KB: ~/bin/bianinho-kb-export"
    echo "  3. Criar arquivo KB: ~/bin/bianinho-kb-archive"
    echo ""
    echo "  Documentação: $BINHO_BASE/scripts/bianinho-bridge-README.md"
    echo "=============================================="
}

# ── Main ───────────────────────────────────────────────────
main() {
    header

    check_requirements
    create_dirs
    setup_venv
    setup_bridge
    setup_rag
    setup_cron
    setup_config
    create_launchers
    verify

    final_msg
}

main "$@"
