#!/usr/bin/env bash
# ============================================================
# AionUI × Hermes Agent — Script de Configuração
# Criado por: Bianinho (Hermes Agent)
# Data: 2026-04-30
# ============================================================

set -e

echo "=========================================="
echo "  AionUI × Hermes Agent — Setup"
echo "=========================================="
echo ""

# Cores
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Funções
info() { echo -e "${GREEN}[INFO]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }

# 1. Verificar Hermes Agent
info "Verificando Hermes Agent..."
if command -v hermes &> /dev/null; then
    HERMES_PATH=$(which hermes)
    info "✓ Hermes Agent encontrado: $HERMES_PATH"
else
    error "✗ Hermes Agent não encontrado no PATH"
    error "  Instale primeiro: https://github.com/NousResearch/Hermes-Agent"
    exit 1
fi

# 2. Verificar AionUI
info "Verificando AionUI..."
if command -v aionui &> /dev/null; then
    info "✓ AionUI encontrado"
elif [ -d "/Applications/AionUI.app" ]; then
    info "✓ AionUI encontrado (macOS app)"
elif [ -f "$HOME/AionUI/AionUI" ]; then
    info "✓ AionUI encontrado (Linux)"
else
    warn "⚠ AionUI não encontrado"
    info "  Instale em: https://github.com/iOfficeAI/AionUi/releases"
    info "  Ou via Homebrew: brew install --cask aionui"
fi

# 3. Verificar Node.js
info "Verificando Node.js..."
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    info "✓ Node.js: $NODE_VERSION"
else
    error "✗ Node.js não encontrado"
    exit 1
fi

# 4. Criar diretórios necessários
info "Criando diretórios..."
mkdir -p "$HOME/.aionui"
mkdir -p "$HOME/ten-team-workspace"
mkdir -p "$HOME/.hermes/workspace"
info "✓ Diretórios criados"

# 5. Copiar configuração do Hermes Agent
info "Configurando Hermes Agent para AionUI..."
CONFIG_DIR="$HOME/.aionui/agents"
mkdir -p "$CONFIG_DIR"
cp -n config/hermes-agent.json "$CONFIG_DIR/" 2>/dev/null || true
info "✓ Configuração do Hermes Agent copiada"

# 6. Configurar variáveis de ambiente
info "Configurando variáveis de ambiente..."
ENV_FILE="$HOME/.aionui/env.yaml"
if [ ! -f "$ENV_FILE" ]; then
    cp config/aionui-env.yaml "$ENV_FILE"
    warn "⚠ Variáveis de ambiente copiadas para $ENV_FILE"
    warn "⚠ Edite $ENV_FILE e preencha suas API keys!"
else
    info "✓ Arquivo de ambiente já existe"
fi

# 7. Configurar Team Mode
info "Configurando Team Mode..."
TEAM_DIR="$HOME/.aionui/teams"
mkdir -p "$TEAM_DIR"
cat > "$TEAM_DIR/TEN-Clinical-Team.json" << 'TEAMEOF'
{
  "name": "TEN-Clinical-Team",
  "description": "Equipe para análise de casos do Método TEN",
  "leader": {
    "agent": "gemini",
    "model": "gemini-2.5-pro"
  },
  "teammates": [
    {
      "id": "hermes",
      "agent": "hermes",
      "role": "analyst",
      "description": "Análise TEN + RAG"
    },
    {
      "id": "coder",
      "agent": "claude-code",
      "role": "materials",
      "description": "Geração de materiais"
    }
  ],
  "workspace": "~/ten-team-workspace/"
}
TEAMEOF
info "✓ Team Mode configurado"

# 8. Habilitar skill Method TEN
info "Instalando skill Method TEN..."
SKILL_DIR="$HOME/.aionui/skills"
mkdir -p "$SKILL_DIR"
cp -r .aionui-skills/method-ten "$SKILL_DIR/" 2>/dev/null || true
info "✓ Skill Method TEN instalada"

# 9. Resumo
echo ""
echo "=========================================="
echo "  Setup Completo!"
echo "=========================================="
echo ""
info "Próximos passos:"
echo "  1. Edite ~/.aionui/env.yaml e preencha suas API keys"
echo "  2. Abra o AionUI"
echo "  3. Vá em Settings → Agents → Verifique se Hermes aparece"
echo "  4. Vá em Team Mode → Carregue TEN-Clinical-Team.json"
echo "  5. Teste com: 'Olá, teste a integração com Hermes'"
echo ""
info "Documentação: ./docs/"
echo ""

exit 0
