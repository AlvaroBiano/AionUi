#!/bin/bash
# ============================================================
# AionUI Linux Installation Script
# Álvaro Bianoi — AionUI × Hermes Agent Integration
# ============================================================
#
# Uso:
#   chmod +x install-aionui-linux.sh
#   ./install-aionui-linux.sh
#
# ============================================================

set -e

echo "============================================"
echo " AionUI Linux Installation"
echo " Álvaro Bianoi — Method TEN × AionUI"
echo "============================================"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[INFO]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }

# ============================================================
# 1. Verificar sistema
# ============================================================
log "Verificando sistema..."
log "Distribuição: $(cat /etc/os-release 2>/dev/null | grep PRETTY_NAME | cut -d= -f2 | tr -d '"')"
log "Node: $(node --version 2>/dev/null || echo 'não encontrado')"
log "Bun: $(/home/alvarobiano/.bun/bin/bun --version 2>/dev/null || echo 'não encontrado')"

# ============================================================
# 2. Verificar/build AionUI
# ============================================================
log ""
log "[1/4] Verificando AionUI..."

AIONUI_DIR="/home/alvarobiano/repos/aionui"
AIONUI_SRC="/tmp/aionui-build"

if [ -f "$AIONUI_DIR/AionUi" ]; then
    log "AionUI já instalado: $AIONUI_DIR/AionUi"
else
    log "AionUI não encontrado. Build necessário."
    log "O build do AionUI está no repositório temporário."
    
    if [ -d "$AIONUI_SRC" ]; then
        log "Copiando de $AIONUI_SRC..."
        mkdir -p "$AIONUI_DIR"
        cp -r "$AIONUI_SRC/." "$AIONUI_DIR/"
        chmod +x "$AIONUI_DIR/AionUi"
        log "AionUI copiado!"
    else
        error "AionUI source não encontrado. Execute primeiro:"
        error "  git clone https://github.com/iOfficeAI/AionUi.git /tmp/aionui-build"
        error "  cd /tmp/aionui-build && npm install && npm run dist:linux"
        exit 1
    fi
fi

# ============================================================
# 3. Scripts de arranque
# ============================================================
log ""
log "[2/4] Configurando scripts de arranque..."

START_SCRIPT="$AIONUI_DIR/aionui-start.sh"
STOP_SCRIPT="$AIONUI_DIR/aionui-stop.sh"

if [ -f "$START_SCRIPT" ]; then
    log "Scripts de arranque já existem"
else
    warn "Scripts de arranque não encontrados — criando..."
    cat > "$START_SCRIPT" << 'STARTSCRIPT'
#!/bin/bash
DISPLAY_NUM=99
AIONUI_DIR="/home/alvarobiano/repos/aionui"
PID_FILE="/tmp/aionui.pid"
LOG_FILE="/tmp/aionui.log"
pkill -f "Xvfb :$DISPLAY_NUM" 2>/dev/null || true
sleep 1
Xvfb :$DISPLAY_NUM -screen 0 1920x1080x24 >> "$LOG_FILE" 2>&1 &
XVFB_PID=$!
sleep 2
export DISPLAY=:$DISPLAY_NUM
export ELECTRON_DISABLE_SANDBOX=1
"$AIONUI_DIR/AionUi" --no-sandbox >> "$LOG_FILE" 2>&1 &
AIONUI_PID=$!
sleep 3
echo "$AIONUI_PID" > "$PID_FILE"
echo "$XVFB_PID" >> "$PID_FILE"
log "AionUI started: PID $AIONUI_PID"
STARTSCRIPT
    chmod +x "$START_SCRIPT"
fi

# ============================================================
# 4. Verificar Hermes Agent
# ============================================================
log ""
log "[3/4] Verificando Hermes Agent..."

if command -v hermes &> /dev/null; then
    log "Hermes Agent: $(which hermes)"
else
    warn "Hermes não está no PATH"
fi

if [ -f "/home/alvarobiano/.hermes/hermes-agent/run_agent.py" ]; then
    log "Hermes Agent source: OK"
else
    warn "Hermes Agent source não encontrado"
fi

# ============================================================
# 5. Teste final
# ============================================================
log ""
log "[4/4] Teste final..."

if [ -f "$AIONUI_DIR/AionUi" ]; then
    log "AionUI binary: OK ($AIONUI_DIR/AionUi)"
else
    error "AionUI binary FALTANDO"
    exit 1
fi

log ""
log "============================================"
log " INSTALAÇÃO CONCLUÍDA!"
log "============================================"
log ""
log "Para iniciar:"
log "  $AIONUI_DIR/aionui-start.sh"
log ""
log "Para parar:"
log "  $AIONUI_DIR/aionui-stop.sh"
log ""
log "Para usar Bianinho como custom agent:"
log "  Settings → Agents → Custom Agents → Add"
log "  Usa config: repos/aionui-hermes-ten/scripts/config/custom-agent-hermes.json"
log ""
